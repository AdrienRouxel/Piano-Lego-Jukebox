/**
 * Transport du jukebox : charge un morceau, le joue, et expose une horloge
 * commune à l'écran et au moteur du piano.
 *
 * Trois cas de figure, selon les fichiers déposés dans `tracks/` :
 *
 *   MIDI seul         → les notes sont synthétisées ; horloge = contexte audio.
 *   MIDI + audio      → la partition l'emporte : c'est un piano qu'on est venu
 *                       écouter, pas un extrait de plateforme. L'enregistrement
 *                       reste chargé, et `setSource('audio')` bascule dessus
 *                       sans recharger ; horloge = <audio> dans ce cas.
 *   audio seul        → aucune partition : la chorégraphie est déduite en direct
 *                       du niveau sonore ; horloge = <audio>.
 */

import { parseMidi } from './midi.js';
import { PianoSampler } from './sampler.js';
import { buildActivityCurve, LiveActivityMeter } from './choreography.js';

/** Fenêtre d'anticipation de l'ordonnanceur de notes (secondes). */
const SCHEDULE_AHEAD = 0.2;

/** Do central : la frontière entre les deux mains, et entre les deux pianos. */
const SPLIT_PITCH = 60;

export class Player extends EventTarget {
  constructor({ useLocalSamples = false } = {}) {
    super();
    this.useLocalSamples = useLocalSamples;
    this.context = null;
    this.sampler = null;
    this.master = null;
    this.analyser = null;

    this.track = null;
    this.midi = null;
    this.mode = 'midi'; // midi | audio | audio+midi
    /**
     * Quand un morceau a les deux, ce qu'on entend : « midi » (la partition
     * synthétisée) ou « audio » (l'enregistrement d'origine). Remis à « midi »
     * à chaque morceau : la bascule est un écart, pas un réglage.
     */
    this.preferred = 'midi';
    this.activity = null;
    /**
     * Les deux moitiés de la partition, pour le mode « deux pianos ».
     * La frontière tombe au do central : c'est là que les deux mains se
     * séparent dans l'écriture pianistique courante.
     */
    this.activityLow = null;
    this.activityHigh = null;

    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.crossOrigin = 'anonymous';
    this._audioSource = null;

    this.isPlaying = false;
    this.duration = 0;
    this._startedAt = 0; // instant du contexte audio correspondant à offset
    this._offset = 0; // position dans le morceau au moment du démarrage
    this._scheduleIndex = 0;
    this._scheduler = null;
    this._sounding = [];
    this._vizIndex = 0;
    this._vizTime = 0;

    /** Compteurs de l'ordonnanceur, lus par le mode geek. */
    this.stats = {
      schedulerTicks: 0,
      notesScheduled: 0, // notes confiées au sampler depuis le chargement
      notesDropped: 0, // notes arrivées trop tard pour être programmées
      lastBatch: 0,
      clockOrigin: null, // [contexte audio, performance.now()] au démarrage
    };

    this.audio.addEventListener('ended', () => this._onEnded());
  }

  /* ---------------------------------------------------------------- */
  /* Initialisation                                                   */
  /* ---------------------------------------------------------------- */

  /** À appeler depuis un geste utilisateur : les navigateurs l'exigent. */
  async init(onSampleProgress) {
    if (this.context) {
      if (this.context.state === 'suspended') await this.context.resume();
      return this.sampler.mode;
    }

    this.context = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.context.createGain();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.4;

    // Un piano peut empiler dix notes : sans limiteur, les accords saturent.
    this.limiter = this.context.createDynamicsCompressor();

    // Coupe-bas, et rattrapage de niveau après le limiteur : les deux servent
    // au profil « hall » et restent transparents le reste du temps.
    this.lowCut = this.context.createBiquadFilter();
    this.lowCut.type = 'highpass';
    this.makeup = this.context.createGain();

    this.master.connect(this.lowCut);
    this.lowCut.connect(this.limiter);
    this.limiter.connect(this.makeup);
    this.makeup.connect(this.analyser);
    this.analyser.connect(this.context.destination);
    this.audioProfile = 'salle';
    this.setAudioProfile(this.audioProfile);

    this.sampler = new PianoSampler(this.context, { useLocalSamples: this.useLocalSamples });
    this.sampler.connect(this.master);

    this._audioSource = this.context.createMediaElementSource(this.audio);
    this._audioSource.connect(this.master);

    this.liveMeter = new LiveActivityMeter(this.analyser);

    const mode = await this.sampler.load(onSampleProgress);
    this.dispatchEvent(new CustomEvent('samplesloaded', { detail: { mode } }));
    return mode;
  }

  /**
   * Deux façons de sonner, selon l'endroit.
   *
   *   salle — le rendu naturel : on entend les nuances, la dynamique d'un
   *           piano est respectée. C'est ce qu'on veut dans une salle de cours ;
   *   hall  — dans un hall d'exposition, la dynamique est l'ennemie : tout ce
   *           qui est doux disparaît sous le bruit de fond. On coupe donc les
   *           graves qui ne font qu'embrouiller, on comprime beaucoup plus
   *           fort, et on rattrape le niveau. Le morceau perd en finesse ce
   *           qu'il gagne en portée — c'est un compromis assumé.
   *
   * @param {'salle'|'hall'} name
   */
  setAudioProfile(name) {
    if (!this.context) return;
    const hall = name === 'hall';
    this.audioProfile = hall ? 'hall' : 'salle';
    const at = this.context.currentTime;
    const glide = 0.08;

    this.lowCut.frequency.setTargetAtTime(hall ? 95 : 20, at, glide);
    this.limiter.threshold.setTargetAtTime(hall ? -22 : -8, at, glide);
    this.limiter.knee.setTargetAtTime(hall ? 3 : 6, at, glide);
    this.limiter.ratio.setTargetAtTime(hall ? 12 : 8, at, glide);
    this.limiter.attack.setTargetAtTime(hall ? 0.002 : 0.004, at, glide);
    this.limiter.release.setTargetAtTime(hall ? 0.12 : 0.18, at, glide);
    // +5 dB environ : de quoi rendre au signal ce que la compression lui a pris.
    this.makeup.gain.setTargetAtTime(hall ? 1.8 : 1, at, glide);
  }

  set volume(value) {
    if (this.master) this.master.gain.setTargetAtTime(value, this.context.currentTime, 0.02);
    this.audio.volume = 1;
  }

  /* ---------------------------------------------------------------- */
  /* Chargement d'un morceau                                          */
  /* ---------------------------------------------------------------- */

  async load(track) {
    this.stop();
    this.track = track;
    this.midi = null;
    this.activity = null;
    this.activityLow = null;
    this.activityHigh = null;

    if (track.midiUrl) {
      const response = await fetch(track.midiUrl);
      if (!response.ok) throw new Error(`Impossible de lire ${track.midiUrl} (HTTP ${response.status}).`);
      this.midi = parseMidi(await response.arrayBuffer());
      this.activity = buildActivityCurve(this.midi);
      this.activityLow = buildActivityCurve(this.midi, { to: SPLIT_PITCH - 1 });
      this.activityHigh = buildActivityCurve(this.midi, { from: SPLIT_PITCH });
    }

    // Un nouveau morceau repart de la partition, même si le précédent était
    // écouté en enregistrement.
    this.preferred = 'midi';

    if (track.audioUrl) {
      // L'enregistrement est chargé dans tous les cas : c'est ce qui permet à
      // `setSource()` de basculer plus tard sans refaire un aller-retour.
      await this._loadAudio(track.audioUrl);
    } else {
      this.audio.removeAttribute('src');
    }

    if (this.midi) {
      this.mode = 'midi';
      this.duration = this.midi.duration;
    } else if (track.audioUrl) {
      this.mode = 'audio';
      this.duration = Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
      this.activity = this.liveMeter;
    } else {
      this.mode = 'midi';
      this.duration = 0;
    }

    this.dispatchEvent(new CustomEvent('loaded', { detail: { track, mode: this.mode, midi: this.midi } }));
    return this;
  }

  /**
   * Décharge le morceau en cours : plus rien à jouer, plus rien à afficher.
   * Utile quand le fichier disparaît du disque sous les pieds du lecteur.
   */
  unload() {
    this.stop();
    this.track = null;
    this.midi = null;
    this.activity = null;
    this.activityLow = null;
    this.activityHigh = null;
    this.duration = 0;
    this.mode = 'midi';
    this.preferred = 'midi';
    this.audio.removeAttribute('src');
    this.dispatchEvent(new CustomEvent('unloaded', {}));
  }

  /** Le morceau en cours a-t-il les deux sources, donc un choix à offrir ? */
  get hasBothSources() {
    return Boolean(this.midi && this.track?.audioUrl);
  }

  /**
   * Bascule entre la partition synthétisée et l'enregistrement d'origine, à la
   * même seconde et sans recharger quoi que ce soit. Sans effet si le morceau
   * n'a qu'une source : il n'y a alors rien à choisir.
   *
   * @param {'midi'|'audio'} kind
   * @returns {string} le mode effectif après bascule
   */
  setSource(kind) {
    const want = kind === 'audio' ? 'audio' : 'midi';
    this.preferred = want;
    if (!this.hasBothSources) return this.mode;

    const next = want === 'audio' ? 'audio+midi' : 'midi';
    if (next === this.mode) return this.mode;

    // La position se lit avec l'ancien mode, et s'écrit avec le nouveau :
    // l'ordre des trois lignes qui suivent n'est pas indifférent.
    const position = this.currentTime;
    const wasPlaying = this.isPlaying;
    if (wasPlaying) this.pause();

    this.mode = next;
    this.duration =
      next === 'midi'
        ? this.midi.duration
        : Number.isFinite(this.audio.duration)
          ? this.audio.duration
          : this.midi.duration;

    this._offset = Math.max(0, Math.min(this.duration, position));
    this._resetSchedule(this._offset);
    if (next !== 'midi') {
      try {
        this.audio.currentTime = this._offset;
      } catch { /* source pas encore prête : `play()` repositionnera */ }
    }

    this.dispatchEvent(new CustomEvent('source', { detail: { mode: this.mode, source: want } }));
    if (wasPlaying) this.play();
    return this.mode;
  }

  _loadAudio(url) {
    return new Promise((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('Fichier audio illisible par le navigateur.'));
      };
      const cleanup = () => {
        this.audio.removeEventListener('loadedmetadata', onReady);
        this.audio.removeEventListener('error', onError);
      };
      this.audio.addEventListener('loadedmetadata', onReady);
      this.audio.addEventListener('error', onError);
      this.audio.src = url;
      this.audio.load();
    });
  }

  /* ---------------------------------------------------------------- */
  /* Lecture                                                          */
  /* ---------------------------------------------------------------- */

  get currentTime() {
    if (this.mode !== 'midi') return this.audio.currentTime;
    if (!this.isPlaying) return this._offset;
    return this._offset + (this.context.currentTime - this._startedAt);
  }

  async play() {
    if (this.isPlaying || !this.track) return;
    if (this.context?.state === 'suspended') await this.context.resume();

    this.stats.clockOrigin = [this.context.currentTime, performance.now()];

    if (this.mode === 'midi') {
      this._startedAt = this.context.currentTime + 0.06; // petit coussin de démarrage
      this._resetSchedule(this._offset);
      this._scheduler = setInterval(() => this._scheduleNotes(), 25);
    } else {
      this.audio.currentTime = this._offset;
      await this.audio.play();
    }

    this.isPlaying = true;
    this.dispatchEvent(new CustomEvent('play', { detail: { track: this.track } }));
    this._watchEnd();
  }

  pause() {
    if (!this.isPlaying) return;
    this._offset = this.currentTime;
    this._teardownPlayback();
    this.isPlaying = false;
    this.dispatchEvent(new CustomEvent('pause', { detail: { time: this._offset } }));
  }

  stop() {
    const wasPlaying = this.isPlaying;
    this._teardownPlayback();
    this.isPlaying = false;
    this._offset = 0;
    if (this.mode !== 'midi') {
      try {
        this.audio.currentTime = 0;
      } catch { /* pas encore de source */ }
    }
    this._resetSchedule(0);
    if (wasPlaying) this.dispatchEvent(new CustomEvent('stop', {}));
  }

  seek(time) {
    const target = Math.max(0, Math.min(this.duration || 0, time));
    const wasPlaying = this.isPlaying;
    if (wasPlaying) this.pause();
    this._offset = target;
    this._resetSchedule(target);
    if (this.mode !== 'midi') this.audio.currentTime = target;
    this.dispatchEvent(new CustomEvent('seek', { detail: { time: target } }));
    if (wasPlaying) this.play();
  }

  _teardownPlayback() {
    if (this._scheduler) clearInterval(this._scheduler);
    this._scheduler = null;
    if (this._endWatcher) clearInterval(this._endWatcher);
    this._endWatcher = null;
    this.sampler?.allNotesOff();
    if (this.mode !== 'midi') this.audio.pause();
  }

  _watchEnd() {
    if (this.mode !== 'midi') return; // <audio> émet déjà « ended »
    this._endWatcher = setInterval(() => {
      if (this.currentTime >= this.duration + 0.6) this._onEnded();
    }, 120);
  }

  _onEnded() {
    if (!this.isPlaying) return;
    this._teardownPlayback();
    this.isPlaying = false;
    this._offset = 0;
    this._resetSchedule(0);
    this.dispatchEvent(new CustomEvent('ended', { detail: { track: this.track } }));
  }

  /* ---------------------------------------------------------------- */
  /* Ordonnancement des notes                                         */
  /* ---------------------------------------------------------------- */

  _resetSchedule(time) {
    const notes = this.midi?.notes ?? [];
    this._scheduleIndex = lowerBound(notes, time);
    this._vizIndex = this._scheduleIndex;
    this._vizTime = time;
    this._sounding = [];
  }

  _scheduleNotes() {
    if (this.mode !== 'midi' || !this.midi) return;
    const notes = this.midi.notes;
    const horizon = this.currentTime + SCHEDULE_AHEAD;
    this.stats.schedulerTicks += 1;
    let batch = 0;
    while (this._scheduleIndex < notes.length && notes[this._scheduleIndex].time <= horizon) {
      const note = notes[this._scheduleIndex];
      this._scheduleIndex += 1;
      if (note.isDrum) continue; // un piano ne joue pas la batterie
      const when = this._startedAt + (note.time - this._offset);
      if (when < this.context.currentTime - 0.05) {
        this.stats.notesDropped += 1;
        continue; // trop tard, on saute
      }
      this.sampler.noteOn(note.midi, note.velocity, Math.max(when, this.context.currentTime), note.duration);
      batch += 1;
    }
    this.stats.lastBatch = batch;
    this.stats.notesScheduled += batch;
  }

  /**
   * Écart entre l'horloge du matériel audio et celle du système, en
   * millisecondes, depuis le début de la lecture. Les deux quartz ne battent
   * jamais exactement au même rythme : c'est cette dérive qu'on mesure ici.
   */
  get clockDriftMs() {
    if (!this.stats.clockOrigin || !this.context) return 0;
    const [audio0, perf0] = this.stats.clockOrigin;
    return (this.context.currentTime - audio0) * 1000 - (performance.now() - perf0);
  }

  /** Fenêtre d'anticipation de l'ordonnanceur, en secondes. */
  get scheduleAhead() {
    return SCHEDULE_AHEAD;
  }

  /**
   * Notes actuellement en train de sonner, pour l'affichage du clavier.
   * @returns {Array<{midi:number, velocity:number}>}
   */
  soundingNotes(time = this.currentTime) {
    const notes = this.midi?.notes;
    if (!notes) return [];
    // Un saut en arrière (recherche manuelle) invalide le curseur d'affichage.
    if (time < this._vizTime - 0.05) {
      this._vizIndex = lowerBound(notes, time);
      this._sounding = [];
    }
    this._vizTime = time;
    while (this._vizIndex < notes.length && notes[this._vizIndex].time <= time) {
      this._sounding.push(notes[this._vizIndex]);
      this._vizIndex += 1;
    }
    this._sounding = this._sounding.filter((note) => note.time + note.duration > time - 0.05);
    // La batterie (canal 10) n'est ni jouée ni affichée : ce n'est pas un piano.
    return this._sounding.filter((note) => !note.isDrum);
  }
}

/** Index de la première note dont l'instant est ≥ time (recherche dichotomique). */
function lowerBound(notes, time) {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (notes[mid].time < time) low = mid + 1;
    else high = mid;
  }
  return low;
}
