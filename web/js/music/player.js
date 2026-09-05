/**
 * Transport du jukebox : charge un morceau, le joue, et expose une horloge
 * commune à l'écran et au moteur du piano.
 *
 * Trois cas de figure, selon les fichiers déposés dans `tracks/` :
 *
 *   MIDI seul         → les notes sont synthétisées ; horloge = contexte audio.
 *   MIDI + audio      → l'audio est joué tel quel, le MIDI ne sert plus qu'à
 *                       piloter les touches et l'affichage ; horloge = <audio>.
 *   audio seul        → aucune partition : la chorégraphie est déduite en direct
 *                       du niveau sonore ; horloge = <audio>.
 */

import { parseMidi } from './midi.js';
import { PianoSampler } from './sampler.js';
import { buildActivityCurve, LiveActivityMeter } from './choreography.js';

/** Fenêtre d'anticipation de l'ordonnanceur de notes (secondes). */
const SCHEDULE_AHEAD = 0.2;

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
    this.activity = null;

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
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 8;
    this.limiter.attack.value = 0.004;
    this.limiter.release.value = 0.18;

    this.master.connect(this.limiter);
    this.limiter.connect(this.analyser);
    this.analyser.connect(this.context.destination);

    this.sampler = new PianoSampler(this.context, { useLocalSamples: this.useLocalSamples });
    this.sampler.connect(this.master);

    this._audioSource = this.context.createMediaElementSource(this.audio);
    this._audioSource.connect(this.master);

    this.liveMeter = new LiveActivityMeter(this.analyser);

    const mode = await this.sampler.load(onSampleProgress);
    this.dispatchEvent(new CustomEvent('samplesloaded', { detail: { mode } }));
    return mode;
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

    if (track.midiUrl) {
      const response = await fetch(track.midiUrl);
      if (!response.ok) throw new Error(`Impossible de lire ${track.midiUrl} (HTTP ${response.status}).`);
      this.midi = parseMidi(await response.arrayBuffer());
      this.activity = buildActivityCurve(this.midi);
    }

    if (track.audioUrl) {
      this.mode = this.midi ? 'audio+midi' : 'audio';
      await this._loadAudio(track.audioUrl);
      this.duration = Number.isFinite(this.audio.duration) ? this.audio.duration : this.midi?.duration ?? 0;
      if (!this.midi) this.activity = this.liveMeter;
    } else {
      this.mode = 'midi';
      this.audio.removeAttribute('src');
      this.duration = this.midi?.duration ?? 0;
    }

    this.dispatchEvent(new CustomEvent('loaded', { detail: { track, mode: this.mode, midi: this.midi } }));
    return this;
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
