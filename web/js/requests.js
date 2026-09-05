/**
 * Demandes des visiteurs : de l'extrait téléchargé à la partition jouable.
 *
 * Le serveur, quand un visiteur colle un lien Spotify ou Apple Music, en tire
 * l'extrait officiel de trente secondes et le dépose dans `tracks/Demandes/`.
 * Il s'arrête là : il n'a ni la puissance ni le bon endroit pour transcrire.
 *
 * C'est donc le navigateur du jukebox qui prend le relais, et il le fait
 * **d'avance** — pendant que le morceau précédent joue encore. Sur un stand,
 * c'est toute la différence : le visiteur envoie son lien, écoute la fin du
 * morceau en cours, et le sien enchaîne sans qu'on ait vu passer les quinze
 * secondes de calcul.
 *
 *   extrait .mp3 ──► décodage ──► Basic Pitch ──► nettoyage ──► .mid ──► serveur
 *                                  (transcribe.js, réseau de Spotify)
 *
 * Si le moteur de transcription n'est pas installé, rien ne casse : le morceau
 * se joue en audio seul, et le piano bouge d'après le niveau sonore — le mode
 * que le jukebox connaît déjà pour un MP3 sans partition.
 */

import {
  engineAvailable,
  fastEngineStatus,
  decodeFile,
  sliceForModel,
  transcribe,
  optimiseForLego,
  notesToMidi,
} from './music/transcribe.js';

/** Un extrait fait trente secondes ; on se garde une marge et pas plus. */
const MAX_SECONDS = 45;

export class RequestPipeline extends EventTarget {
  /**
   * @param {object} options
   * @param {import('./stand.js').Stand} options.stand
   * @param {() => Array} options.getLibrary
   * @param {() => Promise<void>} options.reloadLibrary
   */
  constructor({ stand, getLibrary, reloadLibrary }) {
    super();
    this.stand = stand;
    this.getLibrary = getLibrary;
    this.reloadLibrary = reloadLibrary;

    /** Vrai pendant qu'une transcription tourne : une seule à la fois. */
    this.busy = false;
    /** Morceau en cours de transcription, pour l'affichage. */
    this.current = null;
    /** Avancement, de 0 à 1. */
    this.progress = 0;

    /** Identifiants déjà traités — réussis ou définitivement en échec. */
    this._done = new Set();
    /** Le moteur a-t-il été trouvé ? `null` tant qu'on n'a pas regardé. */
    this._engine = null;
  }

  /**
   * Y a-t-il de quoi transcrire ? Deux moteurs possibles, et il suffit d'un :
   * celui du serveur (`npm run setup-transcriber`, dix fois plus rapide) ou
   * celui du navigateur (`npm run fetch-transcriber`). Vérifié une seule fois.
   */
  async available() {
    this._engine ??= (async () => {
      const [fast, browser] = await Promise.all([
        fastEngineStatus().catch(() => ({ available: false })),
        engineAvailable().catch(() => false),
      ]);
      return Boolean(fast?.available) || Boolean(browser);
    })();
    return this._engine;
  }

  _say(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail: { ...detail, current: this.current, progress: this.progress } }));
  }

  /**
   * Regarde la file et transcrit ce qui doit l'être. Appelable à volonté :
   * si une transcription tourne déjà, l'appel ne fait rien.
   */
  async pump() {
    if (this.busy) return;

    const pending = this.stand.queue.find((entry) => entry.transcribe && !this._done.has(entry.id));
    if (!pending) return;

    this.busy = true;
    this.current = pending;
    this.progress = 0;
    try {
      await this._process(pending);
    } catch (error) {
      this._done.add(pending.id);
      this._say('failed', { message: error.message });
    } finally {
      this.busy = false;
      this.current = null;
      this.progress = 0;
      this._say('idle');
    }
    // La file a pu bouger pendant le calcul : on repasse.
    this.pump();
  }

  async _process(entry) {
    // L'extrait vient d'être écrit sur le disque : la bibliothèque du
    // navigateur date d'avant.
    let track = this.getLibrary().find((item) => item.id === entry.id);
    if (!track) {
      await this.reloadLibrary();
      track = this.getLibrary().find((item) => item.id === entry.id);
    }
    if (!track?.audioUrl) throw new Error('Extrait introuvable sur le disque.');

    if (track.midiUrl) {
      // Déjà transcrit plus tôt dans la journée : rien à refaire.
      this._done.add(entry.id);
      return;
    }

    if (!(await this.available())) {
      this._done.add(entry.id);
      this._say('unavailable');
      return;
    }

    this._say('start', { title: entry.title });

    const response = await fetch(track.audioUrl);
    if (!response.ok) throw new Error('Extrait illisible.');
    const buffer = await decodeFile(await response.blob());
    const mono = await sliceForModel(buffer, 0, Math.min(buffer.duration, MAX_SECONDS));

    const raw = await transcribe(mono, (ratio) => {
      this.progress = ratio;
      this._say('progress');
    });
    // Un extrait de plateforme est un mixage complet — batterie, basse, voix —,
    // pas un piano seul : le réseau y rend des notes bien moins tranchées que
    // sur l'enregistrement d'un instrument. On descend donc le seuil de bruit,
    // sans quoi tout serait rejeté.
    const { notes, dropped } = optimiseForLego(raw, { minAmplitude: 0.12 });
    if (!notes.length) throw new Error('Aucune note reconnue dans cet extrait.');

    const midi = notesToMidi(notes, entry.title);
    await this._upload(entry, midi);

    // La partition existe désormais à côté de l'extrait : la bibliothèque la
    // verra, et le morceau se jouera en « audio + partition ».
    await this.reloadLibrary();
    this._done.add(entry.id);
    this._say('done', { id: entry.id, title: entry.title, notes: notes.length, dropped });
  }

  /** Dépose la partition à côté de l'extrait, dans la même catégorie. */
  async _upload(entry, midi) {
    const slash = entry.id.indexOf('/');
    const category = entry.id.slice(0, slash);
    const name = entry.id.slice(slash + 1);
    const url = `/api/tracks?category=${encodeURIComponent(category)}&name=${encodeURIComponent(name)}&overwrite=1`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { ...this.stand.controlHeaders, 'content-type': 'audio/midi' },
      body: midi,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error ?? 'La partition n’a pas pu être enregistrée.');
    }
  }
}
