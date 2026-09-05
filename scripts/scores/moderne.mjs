/**
 * La catégorie « Moderne » : dix pièces **originales**, écrites pour ce
 * jukebox dans les esthétiques qui dominent le piano des cinq dernières
 * années — lo-fi, piano minimaliste, synthwave, amapiano, drill, phonk,
 * dance-pop, ballade, house, générique de série.
 *
 * Pourquoi des originaux plutôt que les tubes de 2021-2026 ? Parce qu'une
 * transcription note à note d'une chanson récente est une copie de l'œuvre,
 * et que ces œuvres-là sont protégées. Dépose tes propres fichiers `.mid` ou
 * `.mp3` dans `tracks/Moderne/` : ils apparaîtront à côté de ceux-ci.
 */

import { Score } from '../midi-writer.mjs';

/** Répète une grille d'accords : renvoie la case de la mesure `bar`. */
const at = (grid, bar) => grid[bar % grid.length];

/** Même note, une octave plus bas (ou plus haut). `null` reste un silence. */
const octaveShift = (pitch, by) => (pitch ? pitch.replace(/(\d)$/, (d) => String(Number(d) + by)) : null);
const down = (pitch) => octaveShift(pitch, -1);
const up = (pitch) => octaveShift(pitch, 1);

/* ---------------------------------------------------------------- */
/* 1. Néon — synthwave                                               */
/* ---------------------------------------------------------------- */

function neon() {
  const score = new Score('Néon', 112);
  const BARS = 24;
  const grid = [
    { bass: 'A1', arp: ['A3', 'C4', 'E4', 'A4', 'E4', 'C4'], chord: ['A3', 'C4', 'E4'] },
    { bass: 'F1', arp: ['F3', 'A3', 'C4', 'F4', 'C4', 'A3'], chord: ['F3', 'A3', 'C4'] },
    { bass: 'C2', arp: ['C4', 'E4', 'G4', 'C5', 'G4', 'E4'], chord: ['C4', 'E4', 'G4'] },
    { bass: 'G1', arp: ['G3', 'B3', 'D4', 'G4', 'D4', 'B3'], chord: ['G3', 'B3', 'D4'] },
  ];

  for (let bar = 0; bar < BARS; bar += 1) {
    const cell = at(grid, bar);
    const t = bar * 4;
    // La basse pulsée en croches, moteur du morceau.
    for (let i = 0; i < 8; i += 1) score.add(cell.bass, t + i * 0.5, 0.45, i % 2 ? 0.34 : 0.5);
    // L'arpège en doubles croches, qui tourne au-dessus.
    if (bar >= 4) score.arpeggio(cell.arp, t, 1, 0.25, 0.36);
    if (bar >= 8) score.add(cell.chord, t, 3.8, 0.28);
  }

  // Le thème, en notes longues, entre à la 9e mesure.
  const tune = [
    ['E5', 2], ['G5', 1], ['A5', 1],
    ['F5', 3], ['E5', 1],
    ['E5', 1], ['G5', 1], ['C6', 2],
    ['B5', 2], ['A5', 2],
    ['E5', 2], ['G5', 1], ['A5', 1],
    ['C6', 3], ['B5', 1],
    ['A5', 1], ['G5', 1], ['E5', 2],
    ['A5', 4],
  ];
  score.melody(tune, 32, 0.74);
  score.melody(tune, 64, 0.8);
  score.add(['A1', 'A3', 'C4', 'E4', 'A4'], BARS * 4, 4, 0.6);
  return score;
}

/* ---------------------------------------------------------------- */
/* 2. Tard le soir — lo-fi                                           */
/* ---------------------------------------------------------------- */

function tardLeSoir() {
  const score = new Score('Tard le soir', 76);
  const BARS = 16;
  // Des accords de septième, la signature du lo-fi : jamais tout à fait résolus.
  const grid = [
    ['C3', 'E3', 'G3', 'B3'],   // Cmaj7
    ['A2', 'C3', 'E3', 'G3'],   // Am7
    ['D3', 'F3', 'A3', 'C4'],   // Dm7
    ['G2', 'B2', 'D3', 'F3'],   // G7
  ];

  for (let bar = 0; bar < BARS; bar += 1) {
    const chord = at(grid, bar);
    const t = bar * 4;
    score.add(chord[0], t, 1.9, 0.42);           // la basse, posée
    score.add(chord.slice(1), t + 0.5, 1.4, 0.3); // l'accord, en retard — c'est le « swing » du genre
    score.add(chord.slice(1), t + 2.5, 1.4, 0.26);
  }

  const tune = [
    [null, 1], ['E5', 1.5], ['G5', 0.5], ['A5', 1],
    ['G5', 2], ['E5', 1.5], [null, 0.5],
    ['C5', 1], ['E5', 1], ['D5', 2],
    ['D5', 1.5], ['C5', 0.5], ['B4', 2],
    [null, 1], ['G5', 1.5], ['A5', 0.5], ['C6', 1],
    ['B5', 2], ['G5', 1.5], [null, 0.5],
    ['A5', 1], ['G5', 1], ['E5', 1], ['D5', 1],
    ['C5', 4],
  ];
  score.melody(tune, 8, 0.6);
  score.melody(tune, 40, 0.56);
  score.add(['C3', 'E3', 'G3', 'B3', 'E4'], BARS * 4, 5, 0.34);
  return score;
}

/* ---------------------------------------------------------------- */
/* 3. Verre et béton — piano minimaliste                             */
/* ---------------------------------------------------------------- */

function verreEtBeton() {
  const score = new Score('Verre et béton', 96, [6, 8]);
  const BARS = 28;
  // Un ostinato de six croches, immuable. Seule la basse change de couleur.
  const grid = [
    { bass: ['D2', 'D3'], cell: ['D4', 'A4', 'F5', 'A4', 'D5', 'A4'] },
    { bass: ['Bb1', 'Bb2'], cell: ['D4', 'A4', 'F5', 'A4', 'D5', 'A4'] },
    { bass: ['F2', 'F3'], cell: ['C4', 'A4', 'F5', 'A4', 'C5', 'A4'] },
    { bass: ['C2', 'C3'], cell: ['C4', 'G4', 'E5', 'G4', 'C5', 'G4'] },
  ];

  for (let bar = 0; bar < BARS; bar += 1) {
    const { bass, cell } = at(grid, bar);
    const t = bar * 3;
    score.add(bass, t, 2.9, 0.36);
    cell.forEach((pitch, i) => score.add(pitch, t + i * 0.5, 0.5, 0.3 + (i === 0 ? 0.08 : 0)));
  }

  // Par-dessus, une seule ligne, qui monte d'un cran à chaque tour.
  const tune = [
    ['D5', 3], ['F5', 3],
    ['E5', 3], ['D5', 3],
    ['A5', 3], ['G5', 3],
    ['F5', 4.5], ['E5', 1.5],
    ['D5', 3], ['A5', 3],
    ['Bb5', 3], ['A5', 3],
    ['G5', 3], ['F5', 3],
    ['D5', 6],
  ];
  score.melody(tune, 24, 0.6);
  score.melody(tune, 72, 0.68);
  score.add(['D2', 'D3', 'A3', 'D4', 'F4'], BARS * 3, 6, 0.4);
  return score;
}

/* ---------------------------------------------------------------- */
/* 4. Pluie sur la vitre — ballade au piano                          */
/* ---------------------------------------------------------------- */

function pluieSurLaVitre() {
  const score = new Score('Pluie sur la vitre', 70);
  const BARS = 16;
  const grid = [
    { bass: 'G2', arp: ['D3', 'G3', 'B3', 'D4'] },
    { bass: 'E2', arp: ['B2', 'E3', 'G3', 'B3'] },
    { bass: 'C2', arp: ['C3', 'G3', 'C4', 'E4'] },
    { bass: 'D2', arp: ['A2', 'D3', 'F#3', 'A3'] },
  ];

  for (let bar = 0; bar < BARS; bar += 1) {
    const { bass, arp } = at(grid, bar);
    const t = bar * 4;
    score.add(bass, t, 3.9, 0.4);
    score.arpeggio([...arp, arp[2], arp[1]], t, 1, 0.5, 0.3);
  }

  const tune = [
    ['B4', 1], ['D5', 1], ['G5', 2],
    ['F#5', 1], ['E5', 1], ['D5', 2],
    ['E5', 1], ['G5', 1], ['E5', 1], ['D5', 1],
    ['C5', 2], ['B4', 2],
    ['B4', 1], ['D5', 1], ['G5', 2],
    ['A5', 1], ['B5', 1], ['A5', 2],
    ['G5', 1], ['F#5', 1], ['E5', 1], ['D5', 1],
    ['G4', 4],
  ];
  score.melody(tune, 16, 0.66);
  score.melody(tune, 48, 0.7);
  score.add(['G2', 'D3', 'G3', 'B3', 'D4', 'G4'], BARS * 4, 5, 0.45);
  return score;
}

/* ---------------------------------------------------------------- */
/* 5. Course du matin — house                                        */
/* ---------------------------------------------------------------- */

function courseDuMatin() {
  const score = new Score('Course du matin', 124);
  const BARS = 24;
  const grid = [
    { bass: 'A1', chord: ['A3', 'C4', 'E4'] },
    { bass: 'F1', chord: ['A3', 'C4', 'F4'] },
    { bass: 'C2', chord: ['G3', 'C4', 'E4'] },
    { bass: 'G1', chord: ['G3', 'B3', 'D4'] },
  ];

  for (let bar = 0; bar < BARS; bar += 1) {
    const { bass, chord } = at(grid, bar);
    const t = bar * 4;
    // Une note de basse sur chaque temps : le fameux « quatre au sol ».
    for (const beat of [0, 1, 2, 3]) score.add(bass, t + beat, 0.4, 0.5);
    if (bar < 2) continue;
    // Les accords piqués tombent entre les temps — c'est ce décalage qui fait danser.
    for (const off of [0.5, 1.5, 2.5, 3.5]) score.add(chord, t + off, 0.35, 0.4);
  }

  const tune = [
    ['E5', 0.5], ['A5', 0.5], ['G5', 1], ['E5', 0.5], ['D5', 0.5], ['C5', 1],
    ['D5', 0.5], ['F5', 0.5], ['E5', 1], ['C5', 2],
    ['E5', 0.5], ['A5', 0.5], ['C6', 1], ['B5', 0.5], ['A5', 0.5], ['G5', 1],
    ['A5', 4],
  ];
  score.melody(tune, 32, 0.74);
  score.melody(tune, 48, 0.74);
  score.melody(tune, 64, 0.8);
  score.add(['A1', 'A3', 'C4', 'E4', 'A4'], BARS * 4, 3, 0.7);
  return score;
}

/* ---------------------------------------------------------------- */
/* 6. Dimanche à l'ombre — amapiano                                  */
/* ---------------------------------------------------------------- */

function dimancheALOmbre() {
  const score = new Score('Dimanche à l’ombre', 112);
  const BARS = 24;
  const grid = [
    { root: 'C2', chord: ['Eb3', 'G3', 'Bb3'] },  // Cm7
    { root: 'Ab1', chord: ['Eb3', 'G3', 'C4'] },  // Abmaj7
    { root: 'Eb2', chord: ['Eb3', 'G3', 'Bb3'] }, // Ebmaj7
    { root: 'F2', chord: ['Ab3', 'C4', 'Eb4'] },  // Fm7
  ];
  // Le « log drum » : une basse syncopée qui laisse des trous partout.
  const pulse = [0, 0.75, 1.5, 2.5, 3, 3.75];

  for (let bar = 0; bar < BARS; bar += 1) {
    const { root, chord } = at(grid, bar);
    const t = bar * 4;
    pulse.forEach((off, i) => score.add(root, t + off, 0.4, i === 0 ? 0.55 : 0.38));
    if (bar < 2) continue;
    score.add(chord, t + 0.5, 0.9, 0.32);
    score.add(chord, t + 2.25, 0.9, 0.28);
  }

  const tune = [
    [null, 0.5], ['G4', 0.5], ['Bb4', 0.5], ['C5', 1.5], ['Bb4', 0.5], ['G4', 0.5],
    ['Eb5', 1.5], ['D5', 0.5], ['C5', 2],
    [null, 0.5], ['C5', 0.5], ['Eb5', 0.5], ['F5', 1.5], ['Eb5', 0.5], ['C5', 0.5],
    ['Bb4', 2], ['G4', 2],
  ];
  score.melody(tune, 32, 0.66);
  score.melody(tune, 48, 0.66);
  score.melody(tune, 64, 0.72);
  score.add(['C2', 'Eb3', 'G3', 'Bb3', 'Eb4'], BARS * 4, 4, 0.5);
  return score;
}

/* ---------------------------------------------------------------- */
/* 7. Périphérique nord — drill                                      */
/* ---------------------------------------------------------------- */

function peripheriqueNord() {
  const score = new Score('Périphérique nord', 142);
  const BARS = 24;
  // Une basse qui glisse d'une note à l'autre, très en avant, très rare.
  const grid = [
    { bass: ['A1', 'A2'], arp: ['A3', 'C4', 'E4', 'A4', 'E4', 'C4', 'E4', 'A4'] },
    { bass: ['F1', 'F2'], arp: ['F3', 'A3', 'C4', 'F4', 'C4', 'A3', 'C4', 'F4'] },
    { bass: ['D2', 'D3'], arp: ['D3', 'F3', 'A3', 'D4', 'A3', 'F3', 'A3', 'D4'] },
    { bass: ['E2', 'E3'], arp: ['E3', 'G3', 'B3', 'E4', 'B3', 'G3', 'B3', 'E4'] },
  ];

  for (let bar = 0; bar < BARS; bar += 1) {
    const { bass, arp } = at(grid, bar);
    const t = bar * 4;
    score.add(bass, t, 1.4, 0.6);
    score.add(bass, t + 2.5, 1.4, 0.5);
    if (bar >= 2) score.arpeggio(arp, t, 1, 0.5, 0.3);
  }

  // Le motif aigu, court et répété — le « hook » du genre.
  const hook = [
    ['A5', 0.5], [null, 0.5], ['C6', 0.5], ['B5', 0.5], ['A5', 1], [null, 1],
    ['E5', 0.5], [null, 0.5], ['G5', 0.5], ['A5', 0.5], ['E5', 2],
    ['F5', 0.5], [null, 0.5], ['A5', 0.5], ['G5', 0.5], ['F5', 1], ['E5', 1],
    ['D5', 1], ['E5', 1], ['A4', 2],
  ];
  score.melody(hook, 32, 0.7);
  score.melody(hook, 64, 0.76);
  score.add(['A1', 'A2', 'A3', 'C4', 'E4'], BARS * 4, 4, 0.6);
  return score;
}

/* ---------------------------------------------------------------- */
/* 8. Plein été — dance-pop                                          */
/* ---------------------------------------------------------------- */

function pleinEte() {
  const score = new Score('Plein été', 120);
  const BARS = 24;
  const grid = [
    { bass: 'D2', chord: ['D4', 'F#4', 'A4'] },
    { bass: 'A1', chord: ['C#4', 'E4', 'A4'] },
    { bass: 'B1', chord: ['D4', 'F#4', 'B4'] },
    { bass: 'G1', chord: ['D4', 'G4', 'B4'] },
  ];

  for (let bar = 0; bar < BARS; bar += 1) {
    const { bass, chord } = at(grid, bar);
    const t = bar * 4;
    for (const beat of [0, 1, 2, 3]) score.add(bass, t + beat, 0.45, beat === 0 ? 0.55 : 0.42);
    if (bar < 4) continue;
    for (const off of [0, 0.75, 1.5, 2.5, 3.25]) score.add(chord, t + off, 0.4, 0.34);
  }

  const couplet = [
    ['F#5', 0.5], ['E5', 0.5], ['D5', 1], ['E5', 0.5], ['F#5', 0.5], ['A5', 1],
    ['G5', 0.5], ['F#5', 0.5], ['E5', 1], ['D5', 2],
    ['E5', 0.5], ['F#5', 0.5], ['G5', 1], ['F#5', 0.5], ['E5', 0.5], ['D5', 1],
    ['B4', 1], ['D5', 1], ['A4', 2],
  ];
  const refrain = [
    ['A5', 1], ['B5', 0.5], ['A5', 0.5], ['F#5', 2],
    ['G5', 1], ['A5', 0.5], ['G5', 0.5], ['E5', 2],
    ['F#5', 1], ['G5', 0.5], ['A5', 0.5], ['B5', 2],
    ['A5', 2], ['D5', 2],
  ];
  score.melody(couplet, 16, 0.7);
  score.melody(refrain, 32, 0.8);
  score.melody(refrain, 48, 0.84);
  score.melody(couplet, 64, 0.72);
  score.add(['D2', 'D4', 'F#4', 'A4', 'D5'], BARS * 4, 3, 0.8);
  return score;
}

/* ---------------------------------------------------------------- */
/* 9. Phonk lent — phonk                                             */
/* ---------------------------------------------------------------- */

function phonkLent() {
  const score = new Score('Phonk lent', 128);
  const BARS = 24;
  // Un riff pentatonique doublé à l'octave, joué comme une cloche.
  const riff = [
    ['E5', 0.5], ['G5', 0.5], ['E5', 0.5], ['D5', 0.5], ['E5', 1], [null, 1],
    ['E5', 0.5], ['G5', 0.5], ['A5', 0.5], ['G5', 0.5], ['E5', 1], ['D5', 1],
    ['E5', 0.5], ['G5', 0.5], ['E5', 0.5], ['B5', 0.5], ['A5', 1], ['G5', 1],
    ['E5', 2], [null, 2],
  ];
  const grid = ['E1', 'E1', 'G1', 'G1', 'A1', 'A1', 'B1', 'E1'];

  for (let bar = 0; bar < BARS; bar += 1) {
    const bass = at(grid, bar);
    const t = bar * 4;
    // Une basse lourde, sur le temps et sur le contretemps du troisième.
    score.add(bass, t, 1.9, 0.62);
    score.add(bass, t + 2.5, 1.4, 0.5);
    if (bar >= 4) score.add([bass, 'E3', 'G3', 'B3'], t + 1, 0.9, 0.24);
  }

  for (const start of [16, 32, 48, 64]) score.melody(riff, start, start >= 48 ? 0.8 : 0.68);
  // Doublé une octave plus bas sur la seconde moitié : le côté « cloche ».
  const octave = riff.map(([pitch, length]) => [down(pitch), length]);
  score.melody(octave, 48, 0.5);
  score.melody(octave, 64, 0.56);
  score.add(['E1', 'E3', 'G3', 'B3', 'E4'], BARS * 4, 4, 0.7);
  return score;
}

/* ---------------------------------------------------------------- */
/* 10. Générique de fin — cinématique                                */
/* ---------------------------------------------------------------- */

function generiqueDeFin() {
  const score = new Score('Générique de fin', 88);
  const BARS = 20;
  const grid = [
    { bass: ['C2', 'C3'], chord: ['E3', 'G3', 'C4'] },
    { bass: ['G1', 'G2'], chord: ['D3', 'G3', 'B3'] },
    { bass: ['A1', 'A2'], chord: ['E3', 'A3', 'C4'] },
    { bass: ['F1', 'F2'], chord: ['C3', 'F3', 'A3'] },
  ];

  for (let bar = 0; bar < BARS; bar += 1) {
    const { bass, chord } = at(grid, bar);
    const t = bar * 4;
    score.add(bass, t, 3.9, 0.34 + Math.min(0.3, bar * 0.018));
    // La nappe s'épaissit mesure après mesure : d'abord des blanches, puis
    // des croches, puis des doubles — c'est toute la montée du morceau.
    const step = bar < 4 ? 2 : bar < 12 ? 0.5 : 0.25;
    score.arpeggio([...chord, chord[1]], t, 1, step, 0.26 + Math.min(0.2, bar * 0.012));
  }

  const theme = [
    ['G4', 2], ['C5', 2],
    ['B4', 1], ['C5', 1], ['D5', 2],
    ['E5', 2], ['C5', 2],
    ['D5', 3], ['G4', 1],
    ['G4', 2], ['E5', 2],
    ['D5', 1], ['E5', 1], ['G5', 2],
    ['F5', 2], ['E5', 1], ['D5', 1],
    ['C5', 4],
  ];
  score.melody(theme, 16, 0.66);
  score.melody(theme.map(([pitch, length]) => [up(pitch), length]), 48, 0.86);
  score.add(['C2', 'C3', 'G3', 'C4', 'E4', 'G4', 'C5'], BARS * 4, 6, 0.9);
  return score;
}

/* ---------------------------------------------------------------- */

export const MODERNE = [
  ['Atelier 21323 - Néon', neon],
  ['Atelier 21323 - Tard le soir', tardLeSoir],
  ['Atelier 21323 - Verre et béton', verreEtBeton],
  ['Atelier 21323 - Pluie sur la vitre', pluieSurLaVitre],
  ['Atelier 21323 - Course du matin', courseDuMatin],
  ['Atelier 21323 - Dimanche à l’ombre', dimancheALOmbre],
  ['Atelier 21323 - Périphérique nord', peripheriqueNord],
  ['Atelier 21323 - Plein été', pleinEte],
  ['Atelier 21323 - Phonk lent', phonkLent],
  ['Atelier 21323 - Générique de fin', generiqueDeFin],
];
