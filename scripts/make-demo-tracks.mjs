#!/usr/bin/env node
/**
 * Génère quelques morceaux de démonstration dans `tracks/`, pour que le jukebox
 * ne soit pas vide au premier lancement.
 *
 * Les partitions sont écrites ici même, note par note : aucune donnée n'est
 * téléchargée. Les œuvres utilisées sont dans le domaine public.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRACKS_DIR = path.join(ROOT, 'tracks');
const TPB = 480; // impulsions par noire

/* ------------------------------------------------------------------ */
/* Écriture d'un fichier MIDI standard (format 0)                      */
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

/**
 * @param {{name:string, bpm:number, notes:Array<{tick:number,duration:number,midi:number,velocity:number}>}} score
 */
function buildMidi(score) {
  const events = [];
  for (const note of score.notes) {
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
/* Aides d'écriture des partitions                                     */
/* ------------------------------------------------------------------ */

const NOTE_NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** « C4 », « F#3 », « Bb5 » → numéro MIDI (C4 = 60). */
function midi(name) {
  const match = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!match) throw new Error(`Note illisible : ${name}`);
  const [, letter, accidental, octave] = match;
  const offset = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  return NOTE_NAMES[letter] + offset + (Number(octave) + 1) * 12;
}

class Score {
  constructor(name, bpm, timeSignature = [4, 4]) {
    this.name = name;
    this.bpm = bpm;
    this.timeSignature = timeSignature;
    this.notes = [];
  }
  /** @param {string|string[]} pitch  @param {number} at (en noires) @param {number} length (en noires) */
  add(pitch, at, length, velocity = 0.72) {
    for (const p of [].concat(pitch)) {
      this.notes.push({
        tick: Math.round(at * TPB),
        duration: Math.max(1, Math.round(length * TPB) - 6),
        midi: typeof p === 'number' ? p : midi(p),
        velocity,
      });
    }
    return this;
  }
  /** Suite de notes jouées l'une après l'autre. */
  sequence(pitches, at, length, velocity = 0.72) {
    pitches.forEach((pitch, i) => this.add(pitch, at + i * length, length, velocity));
    return this;
  }
}

/* ------------------------------------------------------------------ */
/* Les partitions                                                      */
/* ------------------------------------------------------------------ */

/** J.-S. Bach — Prélude no 1 en ut majeur, BWV 846 (les 12 premières mesures). */
function bachPrelude() {
  const score = new Score('Prélude en ut majeur, BWV 846', 66);
  // La pièce entière est un seul motif : deux notes graves tenues, puis six
  // doubles croches arpégeant l'accord — le tout répété deux fois par mesure.
  const bars = [
    ['C2', 'E3', 'G3', 'C4', 'E4'],
    ['C2', 'D3', 'A3', 'D4', 'F4'],
    ['B1', 'D3', 'G3', 'D4', 'F4'],
    ['C2', 'E3', 'G3', 'C4', 'E4'],
    ['C2', 'E3', 'A3', 'E4', 'A4'],
    ['C2', 'D3', 'F#3', 'A3', 'D4'],
    ['B1', 'D3', 'G3', 'D4', 'G4'],
    ['B1', 'C3', 'E3', 'G3', 'C4'],
    ['A1', 'C3', 'E3', 'G3', 'C4'],
    ['D2', 'A2', 'D3', 'F#3', 'C4'],
    ['G1', 'B2', 'D3', 'G3', 'B3'],
    ['G1', 'B2', 'D3', 'F3', 'G3'],
  ];
  bars.forEach((chord, barIndex) => {
    const [bassLow, bassHigh, ...upper] = chord;
    for (const half of [0, 2]) {
      const at = barIndex * 4 + half;
      score.add(bassLow, at, 2, 0.6);
      score.add(bassHigh, at + 0.25, 1.75, 0.52);
      // Six doubles croches : mi-sol-do mi-sol-do, selon l'accord de la mesure.
      [0, 1, 2, 0, 1, 2].forEach((degree, i) => {
        score.add(upper[degree], at + 0.5 + i * 0.25, 0.25, 0.6 - (i % 3) * 0.02);
      });
    }
  });
  return score;
}

/** L. van Beethoven — Lettre à Élise, WoO 59 (la section A). */
function furElise() {
  const score = new Score('Lettre à Élise (section A)', 76, [3, 8]);
  const S = 0.25; // une double croche, exprimée en noires

  // Main droite, en double croches, avec les silences notés `null`.
  const right = [
    'E5', 'D#5',
    'E5', 'D#5', 'E5', 'B4', 'D5', 'C5',
    'A4', null, null, 'C4', 'E4', 'A4',
    'B4', null, null, 'E4', 'G#4', 'B4',
    'C5', null, null, 'E4', 'E5', 'D#5',
    'E5', 'D#5', 'E5', 'B4', 'D5', 'C5',
    'A4', null, null, 'C4', 'E4', 'A4',
    'B4', null, null, 'E4', 'C5', 'B4',
    'A4', null, null, null, null, null,
  ];
  right.forEach((pitch, i) => {
    if (pitch) score.add(pitch, i * S, i === right.length - 6 ? 1.5 : S, 0.72);
  });

  // Main gauche : un arpège par mesure, à partir de la mesure 2.
  const left = [
    [8, ['A2', 'E3', 'A3']],
    [14, ['E2', 'E3', 'G#3']],
    [20, ['A2', 'E3', 'A3']],
    [32, ['A2', 'E3', 'A3']],
    [38, ['E2', 'E3', 'G#3']],
    [44, ['A2', 'E3', 'A3']],
  ];
  for (const [slot, arpeggio] of left) {
    arpeggio.forEach((pitch, i) => score.add(pitch, (slot + i * 2) * S, 2 * S, 0.5));
  }
  return score;
}

/** L. van Beethoven — Hymne à la joie (9e symphonie), harmonisé simplement. */
function odeToJoy() {
  const score = new Score('Hymne à la joie', 108);
  const melody = [
    'E4', 'E4', 'F4', 'G4', 'G4', 'F4', 'E4', 'D4',
    'C4', 'C4', 'D4', 'E4', 'E4', 'D4', 'D4',
    'E4', 'E4', 'F4', 'G4', 'G4', 'F4', 'E4', 'D4',
    'C4', 'C4', 'D4', 'E4', 'D4', 'C4', 'C4',
  ];
  const lengths = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5, 0.5, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5, 0.5, 2];
  const chords = [
    ['C3', 'E3', 'G3'], ['C3', 'E3', 'G3'], ['F2', 'A2', 'C3'], ['C3', 'E3', 'G3'],
    ['G2', 'B2', 'D3'], ['C3', 'E3', 'G3'], ['G2', 'B2', 'D3'], ['C3', 'E3', 'G3'],
  ];

  let at = 0;
  melody.forEach((pitch, i) => {
    score.add(pitch, at, lengths[i], 0.78);
    at += lengths[i];
  });
  for (let bar = 0; bar < 8; bar += 1) {
    score.add(chords[bar % chords.length], bar * 4, 3.8, 0.45);
    score.add(chords[bar % chords.length], 32 + bar * 4, 3.8, 0.45);
  }
  return score;
}

/** Une pièce écrite pour le réglage : densité croissante, silences francs, final soutenu. */
function calibration() {
  const score = new Score('Gammes et arpèges (réglage du moteur)', 120);
  const scaleUp = ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];

  // 1. Notes isolées, bien espacées : le moteur doit s'arrêter entre chaque.
  ['C4', 'E4', 'G4', 'C5'].forEach((pitch, i) => score.add(pitch, i * 2, 1, 0.8));

  // 2. Silence : les touches doivent être immobiles.
  // 3. Gamme montante en croches, puis descendante en doubles croches.
  score.sequence(scaleUp, 10, 0.5, 0.7);
  score.sequence([...scaleUp].reverse(), 18, 0.25, 0.7);

  // 4. Arpèges rapides et denses : le moteur doit tourner à plein régime.
  const arpeggio = ['C3', 'G3', 'C4', 'E4', 'G4', 'E4', 'C4', 'G3'];
  for (let i = 0; i < 32; i += 1) {
    score.add(arpeggio[i % arpeggio.length], 22 + i * 0.25, 0.25, 0.75);
  }
  // 5. Accord final tenu.
  score.add(['C3', 'G3', 'C4', 'E4', 'G4', 'C5'], 30, 4, 0.85);
  return score;
}

/* ------------------------------------------------------------------ */

const DEMOS = [
  ['Johann Sebastian Bach - Prélude en ut majeur BWV 846', bachPrelude],
  ['Ludwig van Beethoven - Lettre à Élise', furElise],
  ['Ludwig van Beethoven - Hymne à la joie', odeToJoy],
  ['Démo - Gammes et arpèges', calibration],
];

export async function writeDemoTracks(targetDir = TRACKS_DIR) {
  await fs.mkdir(targetDir, { recursive: true });
  const written = [];
  for (const [fileName, build] of DEMOS) {
    const filePath = path.join(targetDir, `${fileName}.mid`);
    await fs.writeFile(filePath, buildMidi(build()));
    written.push(path.basename(filePath));
  }
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const written = await writeDemoTracks();
  console.log(`${written.length} morceaux de démonstration écrits dans ${TRACKS_DIR} :`);
  for (const name of written) console.log(`  • ${name}`);
}
