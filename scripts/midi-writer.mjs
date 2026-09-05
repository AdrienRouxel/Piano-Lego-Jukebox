/**
 * Écriture de fichiers MIDI standard (format 0) et petite grammaire d'écriture
 * de partitions.
 *
 * Rien n'est téléchargé : chaque partition est écrite note à note dans
 * `scripts/scores/`, puis rendue ici en octets MIDI.
 */

export const TPB = 480; // impulsions par noire

/* ------------------------------------------------------------------ */
/* Encodage MIDI                                                       */
/* ------------------------------------------------------------------ */

function varint(value) {
  const bytes = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return bytes;
}

function chunk(id, data) {
  const header = [...id].map((c) => c.charCodeAt(0));
  const length = data.length;
  return [...header, (length >> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff, ...data];
}

/** Écart minimal entre l'extinction d'une note et sa reprise, en impulsions. */
const REARTICULATION = 8;

/**
 * Rend une voix jouable : une hauteur donnée ne peut sonner qu'une fois à la fois.
 *
 * Deux accidents d'écriture arrivent vite quand mélodie et accompagnement se
 * croisent : la même note écrite deux fois au même instant — elle sonne alors
 * deux fois plus fort, et sature —, et une note tenue par-dessus sa propre
 * reprise — beaucoup de lecteurs éteignent alors les deux au premier « note off »,
 * ou laissent la première coincée. On garde la plus longue des doublées, et on
 * raccourcit ce qui déborde.
 */
function singleVoicePerPitch(notes) {
  const byPitch = new Map();
  for (const note of notes) {
    if (!byPitch.has(note.midi)) byPitch.set(note.midi, []);
    byPitch.get(note.midi).push({ ...note }); // copie : la partition d'origine n'est pas retouchée
  }

  const cleaned = [];
  for (const list of byPitch.values()) {
    list.sort((a, b) => a.tick - b.tick || b.duration - a.duration);
    let previous = null;
    for (const note of list) {
      if (previous && note.tick === previous.tick) {
        // Doublon : une seule note, la plus marquée des deux.
        previous.duration = Math.max(previous.duration, note.duration);
        previous.velocity = Math.max(previous.velocity, note.velocity);
        continue;
      }
      if (previous) {
        const room = note.tick - previous.tick - REARTICULATION;
        previous.duration = Math.max(1, Math.min(previous.duration, room));
      }
      cleaned.push(note);
      previous = note;
    }
  }
  return cleaned;
}

/**
 * @param {{name:string, bpm:number, timeSignature?:number[], notes:Array<{tick:number,duration:number,midi:number,velocity:number}>}} score
 */
export function buildMidi(score) {
  const events = [];
  for (const note of singleVoicePerPitch(score.notes)) {
    const velocity = Math.max(1, Math.min(127, Math.round(note.velocity * 127)));
    events.push({ tick: note.tick, order: 1, data: [0x90, note.midi, velocity] });
    events.push({ tick: note.tick + note.duration, order: 0, data: [0x80, note.midi, 0x40] });
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const track = [];
  // Nom de piste
  const nameBytes = [...score.name].map((c) => c.charCodeAt(0) & 0x7f);
  track.push(0x00, 0xff, 0x03, ...varint(nameBytes.length), ...nameBytes);
  // Tempo
  const microsPerBeat = Math.round(60_000_000 / score.bpm);
  track.push(0x00, 0xff, 0x51, 0x03, (microsPerBeat >> 16) & 0xff, (microsPerBeat >> 8) & 0xff, microsPerBeat & 0xff);
  // Signature rythmique
  const [num, den] = score.timeSignature ?? [4, 4];
  track.push(0x00, 0xff, 0x58, 0x04, num, Math.log2(den), 24, 8);

  let last = 0;
  for (const event of events) {
    track.push(...varint(event.tick - last), ...event.data);
    last = event.tick;
  }
  track.push(0x00, 0xff, 0x2f, 0x00); // fin de piste

  const header = chunk('MThd', [0x00, 0x00, 0x00, 0x01, (TPB >> 8) & 0xff, TPB & 0xff]);
  return Uint8Array.from([...header, ...chunk('MTrk', track)]);
}

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
