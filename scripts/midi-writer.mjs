/**
 * Grammaire d'écriture des partitions : une petite couche au-dessus de
 * l'encodeur MIDI, pour poser des notes en noires plutôt qu'en impulsions.
 *
 * L'encodage lui-même vit dans `web/js/music/midi-write.js`, partagé avec le
 * convertisseur MP3 du navigateur.
 */

import { TPB, buildMidi } from '../web/js/music/midi-write.js';

export { TPB, buildMidi };

/* ------------------------------------------------------------------ */
/* Grammaire d'écriture                                                */
/* ------------------------------------------------------------------ */

const NOTE_NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** « C4 », « F#3 », « Bb5 » → numéro MIDI (C4 = 60). */
export function midi(name) {
  const match = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!match) throw new Error(`Note illisible : ${name}`);
  const [, letter, accidental, octave] = match;
  const offset = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  return NOTE_NAMES[letter] + offset + (Number(octave) + 1) * 12;
}

/** Transpose un nom de note d'un nombre de demi-tons. */
export function shift(pitch, semitones) {
  return (typeof pitch === 'number' ? pitch : midi(pitch)) + semitones;
}

export class Score {
  constructor(name, bpm, timeSignature = [4, 4]) {
    this.name = name;
    this.bpm = bpm;
    this.timeSignature = timeSignature;
    this.notes = [];
  }

  /**
   * @param {string|number|Array<string|number>} pitch une note ou un accord
   * @param {number} at   position, en noires depuis le début
   * @param {number} length durée, en noires
   */
  add(pitch, at, length, velocity = 0.72) {
    for (const p of [].concat(pitch)) {
      if (p === null || p === undefined) continue;
      this.notes.push({
        tick: Math.round(at * TPB),
        duration: Math.max(1, Math.round(length * TPB) - 6),
        midi: typeof p === 'number' ? p : midi(p),
        velocity,
      });
    }
    return this;
  }

  /** Suite de notes de durée égale, jouées l'une après l'autre. `null` = silence. */
  sequence(pitches, at, length, velocity = 0.72) {
    pitches.forEach((pitch, i) => this.add(pitch, at + i * length, length, velocity));
    return this;
  }

  /**
   * Mélodie rythmée : une liste de `[hauteur, durée]`, jouée à la file.
   * `null` en hauteur = silence de la durée indiquée.
   * @returns {number} la position atteinte après le dernier événement
   */
  melody(pairs, at, velocity = 0.72) {
    let cursor = at;
    for (const [pitch, length] of pairs) {
      this.add(pitch, cursor, length, velocity);
      cursor += length;
    }
    return cursor;
  }

  /** Basse d'Alberti (grave–aigu–médium–aigu), le motif classique de Mozart. */
  alberti(triad, at, bars, step = 0.5, velocity = 0.45) {
    const [low, mid, high] = triad;
    const pattern = [low, high, mid, high];
    const perBar = Math.round(this.timeSignature[0] / step);
    for (let i = 0; i < bars * perBar; i += 1) {
      this.add(pattern[i % 4], at + i * step, step, velocity);
    }
    return this;
  }

  /** Accord répété en croches, façon accompagnement de valse ou de pop. */
  vamp(chord, at, length, times, gap = null, velocity = 0.4) {
    const stride = gap ?? length;
    for (let i = 0; i < times; i += 1) this.add(chord, at + i * stride, length, velocity);
    return this;
  }

  /** Accompagnement de valse : basse sur 1, accord sur 2 et 3. */
  waltz(bass, chord, at, bars, velocity = 0.42) {
    for (let bar = 0; bar < bars; bar += 1) {
      const t = at + bar * 3;
      this.add(bass, t, 0.9, velocity + 0.06);
      this.add(chord, t + 1, 0.9, velocity);
      this.add(chord, t + 2, 0.9, velocity);
    }
    return this;
  }

  /** Arpège continu en croches (ou autre pas), bouclé sur `bars` mesures. */
  arpeggio(pitches, at, bars, step = 0.5, velocity = 0.42) {
    const count = Math.round((bars * this.timeSignature[0]) / step);
    for (let i = 0; i < count; i += 1) this.add(pitches[i % pitches.length], at + i * step, step, velocity);
    return this;
  }

  /** Durée totale de la partition, en noires. */
  get length() {
    let end = 0;
    for (const note of this.notes) end = Math.max(end, (note.tick + note.duration) / TPB);
    return end;
  }
}
