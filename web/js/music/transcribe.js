/**
 * Convertisseur audio → MIDI.
 *
 * La transcription elle-même est faite par « basic-pitch », le réseau de
 * Spotify, rapatrié en local par `npm run fetch-transcriber` et exécuté ici
 * dans l'onglet. Ce module l'enveloppe de ce qui manque pour le jukebox :
 * découpe d'un extrait, rééchantillonnage, puis un nettoyage taillé pour le
 * modèle LEGO — c'est cette dernière passe qui fait la différence entre une
 * sortie brute inécoutable et une partition qui pilote proprement le moteur.
 */

import { TPB, buildMidi } from './midi-write.js';

/** Le réseau a été entraîné à cette fréquence : tout doit y être ramené. */
const MODEL_RATE = 22050;
const ENGINE_DIR = '/assets/transcriber';
const LOWEST_KEY = 21;   // la0
const HIGHEST_KEY = 108; // do8

let enginePromise = null;

/**
 * Charge le moteur, une seule fois. Absent, il renvoie une erreur explicite
 * plutôt qu'un échec d'import incompréhensible.
 */
export function loadEngine() {
  enginePromise ??= (async () => {
    try {
      return await import(`${ENGINE_DIR}/index.js`);
    } catch (cause) {
      enginePromise = null; // on pourra réessayer après installation
      throw new Error(
        'Moteur de transcription absent. Lance « npm run fetch-transcriber » ' +
          'une fois, puis recharge la page.',
        { cause }
      );
    }
  })();
  return enginePromise;
}

/** Le moteur est-il installé ? (sans le charger — juste un coup d'œil au modèle) */
export async function engineAvailable() {
  try {
    const response = await fetch(`${ENGINE_DIR}/model/model.json`, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Préparation de l'audio                                              */
/* ------------------------------------------------------------------ */

/** Décode un fichier audio complet, à sa fréquence d'origine. */
export async function decodeFile(file) {
  const bytes = await file.arrayBuffer();
  const context = new AudioContext();
  try {
    return await context.decodeAudioData(bytes);
  } finally {
    context.close();
  }
}

/**
 * Extrait `[start, end]` et le ramène en mono à 22 050 Hz.
 * Le mixage mono et le rééchantillonnage sont faits d'un coup par le graphe.
 */
export async function sliceForModel(buffer, start, end) {
  const from = Math.max(0, Math.min(start, buffer.duration));
  const to = Math.max(from, Math.min(end, buffer.duration));
  const seconds = to - from;
  if (seconds < 0.5) throw new Error('L’extrait choisi est trop court (moins d’une demi-seconde).');

  const context = new OfflineAudioContext(1, Math.ceil(seconds * MODEL_RATE), MODEL_RATE);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start(0, from, seconds);
  return context.startRendering();
}

/* ------------------------------------------------------------------ */
/* Moteur rapide, côté serveur                                         */
/* ------------------------------------------------------------------ */

/**
 * Emballe un extrait mono en WAV 16 bits — le seul format que le pont Python
 * a besoin de savoir lire, et le plus court chemin depuis un AudioBuffer.
 */
export function encodeWav(mono) {
  const samples = mono.getChannelData(0);
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const text = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };

  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);        // taille du bloc de format
  view.setUint16(20, 1, true);         // PCM entier
  view.setUint16(22, 1, true);         // mono
  view.setUint32(24, mono.sampleRate, true);
  view.setUint32(28, mono.sampleRate * 2, true);
  view.setUint16(32, 2, true);         // octets par trame
  view.setUint16(34, 16, true);        // bits par échantillon
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return new Uint8Array(bytes);
}

let fastEngine = null;

/** Le moteur rapide est-il installé sur cette machine ? (demandé une fois) */
export function fastEngineStatus() {
  fastEngine ??= fetch('/api/transcribe')
    .then((response) => (response.ok ? response.json() : { available: false }))
    .catch(() => ({ available: false }));
  return fastEngine;
}

/** Transcription par le serveur. Lève si elle échoue — l'appelant se rabat. */
async function transcribeOnServer(mono) {
  const response = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'content-type': 'audio/wav' },
    body: encodeWav(mono),
  });
  if (!response.ok) throw new Error(`moteur rapide : HTTP ${response.status}`);
  const payload = await response.json();
  return payload.notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
}

/* ------------------------------------------------------------------ */
/* Transcription                                                       */
/* ------------------------------------------------------------------ */

/**
 * @param {AudioBuffer} mono extrait mono à 22 050 Hz
 * @param {(ratio: number) => void} [onProgress] avancement, de 0 à 1
 * @returns {Promise<Array<{midi:number, start:number, duration:number, amplitude:number}>>}
 */
export async function transcribe(mono, onProgress) {
  // Le moteur rapide d'abord : même réseau, mais dix à quinze fois plus vite.
  // S'il manque ou trébuche, le navigateur reprend la main sans rien dire.
  const status = await fastEngineStatus();
  if (status.available) {
    try {
      onProgress?.(0.15);
      const notes = await transcribeOnServer(mono);
      onProgress?.(1);
      return notes;
    } catch {
      /* on continue avec le moteur du navigateur */
    }
  }
  return transcribeInBrowser(mono, onProgress);
}

/** La transcription faite entièrement dans l'onglet, sans rien installer. */
export async function transcribeInBrowser(mono, onProgress) {
  const engine = await loadEngine();
  const model = new engine.BasicPitch(`${ENGINE_DIR}/model/model.json`);

  const frames = [];
  const onsets = [];
  const contours = [];
  await model.evaluateModel(
    mono,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (ratio) => onProgress?.(ratio)
  );

  // Seuils de détection : note présente, attaque franche, 5 trames minimum.
  const raw = engine.noteFramesToTime(
    engine.addPitchBendsToNoteEvents(contours, engine.outputToNotesPoly(frames, onsets, 0.25, 0.25, 5))
  );

  return raw
    .map((note) => ({
      midi: note.pitchMidi,
      start: note.startTimeSeconds,
      duration: note.durationSeconds,
      amplitude: note.amplitude,
    }))
    .sort((a, b) => a.start - b.start || a.midi - b.midi);
}

/* ------------------------------------------------------------------ */
/* Nettoyage pour le piano LEGO                                        */
/* ------------------------------------------------------------------ */

export const LEGO_DEFAULTS = {
  /** En dessous, c'est du bruit de transcription plutôt qu'une note voulue. */
  minAmplitude: 0.3,
  /** Une touche du modèle ne peut pas être frappée plus brièvement. */
  minDuration: 0.08,
  /** Deux notes identiques séparées par moins que ça n'en font qu'une. */
  mergeGap: 0.05,
  /** L'arbre à cames ne rend pas les accords très fournis. */
  maxVoices: 6,
  /** Bornes de nuance, pour éviter les notes inaudibles ou saturées. */
  minVelocity: 0.35,
  maxVelocity: 0.95,
};

/** Replie une note hors clavier dans les 88 touches, par octaves entières. */
function foldIntoKeyboard(midi) {
  let pitch = midi;
  while (pitch < LOWEST_KEY) pitch += 12;
  while (pitch > HIGHEST_KEY) pitch -= 12;
  return pitch;
}

/**
 * Transforme la sortie brute du réseau en quelque chose que le modèle LEGO
 * peut réellement jouer.
 */
export function optimiseForLego(notes, options = {}) {
  const settings = { ...LEGO_DEFAULTS, ...options };
  const dropped = { faible: 0, courte: 0, fondue: 0, polyphonie: 0 };

  // 1. Le bruit de fond : trop faible, ou trop brève pour une touche.
  let kept = [];
  for (const note of notes) {
    if (note.amplitude < settings.minAmplitude) { dropped.faible += 1; continue; }
    if (note.duration < settings.minDuration) { dropped.courte += 1; continue; }
    kept.push({ ...note, midi: foldIntoKeyboard(note.midi) });
  }
  kept.sort((a, b) => a.start - b.start || a.midi - b.midi);

  // 2. Le réseau hache parfois une note tenue en plusieurs morceaux : on recolle.
  const byPitch = new Map();
  const merged = [];
  for (const note of kept) {
    const previous = byPitch.get(note.midi);
    if (previous && note.start - (previous.start + previous.duration) <= settings.mergeGap) {
      previous.duration = note.start + note.duration - previous.start;
      previous.amplitude = Math.max(previous.amplitude, note.amplitude);
      dropped.fondue += 1;
      continue;
    }
    const copy = { ...note };
    byPitch.set(note.midi, copy);
    merged.push(copy);
  }

  // 3. Limitation de la polyphonie : à tout instant, on garde les plus fortes.
  const active = [];
  const final = [];
  for (const note of merged) {
    for (let i = active.length - 1; i >= 0; i -= 1) {
      if (active[i].start + active[i].duration <= note.start) active.splice(i, 1);
    }
    if (active.length >= settings.maxVoices) {
      // La plus faible cède la place — sauf si c'est la nouvelle venue.
      let weakest = active[0];
      for (const other of active) if (other.amplitude < weakest.amplitude) weakest = other;
      if (note.amplitude <= weakest.amplitude) { dropped.polyphonie += 1; continue; }
      weakest.duration = Math.max(settings.minDuration, note.start - weakest.start);
      active.splice(active.indexOf(weakest), 1);
      dropped.polyphonie += 1;
    }
    active.push(note);
    final.push(note);
  }

  // 4. Les nuances, ramenées dans une plage où le moteur réagit.
  const peak = final.reduce((max, note) => Math.max(max, note.amplitude), 0) || 1;
  const span = settings.maxVelocity - settings.minVelocity;
  for (const note of final) {
    note.velocity = settings.minVelocity + span * Math.min(1, note.amplitude / peak);
  }

  // 5. L'extrait commence à zéro, quel que soit le timecode d'origine.
  const offset = final.length ? final[0].start : 0;
  for (const note of final) note.start -= offset;

  return { notes: final, dropped, kept: final.length, before: notes.length };
}

/* ------------------------------------------------------------------ */
/* Sortie MIDI                                                         */
/* ------------------------------------------------------------------ */

/** Tempo d'écriture. Sans battue détectée, on pose les notes à la seconde près. */
const WRITE_BPM = 120;
const TICKS_PER_SECOND = (TPB * WRITE_BPM) / 60;

/**
 * @param {Array<{midi:number,start:number,duration:number,velocity:number}>} notes
 * @returns {Uint8Array} un fichier MIDI standard, prêt à être enregistré
 */
export function notesToMidi(notes, name = 'Conversion') {
  return buildMidi({
    name,
    bpm: WRITE_BPM,
    timeSignature: [4, 4],
    notes: notes.map((note) => ({
      midi: note.midi,
      tick: Math.round(note.start * TICKS_PER_SECOND),
      duration: Math.max(1, Math.round(note.duration * TICKS_PER_SECOND)),
      velocity: note.velocity ?? 0.7,
    })),
  });
}
