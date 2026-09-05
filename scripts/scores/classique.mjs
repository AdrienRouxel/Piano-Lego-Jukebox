/**
 * Le répertoire classique du jukebox : vingt pièces du domaine public.
 *
 * Ce sont des **arrangements simplifiés**, écrits ici note à note pour ce
 * projet : mélodie et accompagnement, sur une trentaine de mesures, dans une
 * tessiture qui reste lisible sur les 25 touches du modèle LEGO. Ce ne sont
 * pas les partitions intégrales des compositeurs.
 */

import { Score } from '../midi-writer.mjs';

/* ---------------------------------------------------------------- */
/* 1. J.-S. Bach — Prélude no 1 en ut majeur, BWV 846                */
/* ---------------------------------------------------------------- */

function bachPrelude() {
  const score = new Score('Prélude en ut majeur, BWV 846', 66);
  // Toute la pièce tient dans un motif : deux notes graves tenues, puis six
  // doubles croches qui arpègent l'accord — répété deux fois par mesure.
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
    ['F#1', 'A2', 'C3', 'E3', 'G3'],
    ['F1', 'A2', 'C3', 'E3', 'G3'],
    ['F1', 'G2', 'B2', 'D3', 'G3'],
    ['E1', 'G2', 'C3', 'E3', 'G3'],
  ];
  bars.forEach((chord, barIndex) => {
    const [bassLow, bassHigh, ...upper] = chord;
    for (const half of [0, 2]) {
      const at = barIndex * 4 + half;
      score.add(bassLow, at, 2, 0.6);
      score.add(bassHigh, at + 0.25, 1.75, 0.52);
      [0, 1, 2, 0, 1, 2].forEach((degree, i) => {
        score.add(upper[degree], at + 0.5 + i * 0.25, 0.25, 0.6 - (i % 3) * 0.02);
      });
    }
  });
  // Accord de do majeur, tenu, pour clore.
  score.add(['C2', 'C3', 'E4', 'G4', 'C5'], bars.length * 4, 5, 0.62);
  return score;
}

/* ---------------------------------------------------------------- */
/* 2. J.-S. Bach — Menuet en sol majeur, BWV Anh. 114                */
/* ---------------------------------------------------------------- */

function bachMenuet() {
  const score = new Score('Menuet en sol majeur, BWV Anh. 114', 128, [3, 4]);
  const E = 0.5;
  const phrase = [
    ['D5', 1], ['G4', E], ['A4', E], ['B4', E], ['C5', E],
    ['D5', 1], ['G4', 1], ['G4', 1],
    ['E5', 1], ['C5', E], ['D5', E], ['E5', E], ['F#5', E],
    ['G5', 1], ['G4', 1], ['G4', 1],
    ['C5', 1], ['D5', E], ['C5', E], ['B4', E], ['A4', E],
    ['B4', 1], ['C5', E], ['B4', E], ['A4', E], ['G4', E],
    ['F#4', 1], ['G4', E], ['A4', E], ['B4', 1],
    ['A4', 3],
  ];
  const answer = [
    ['C5', 1], ['D5', E], ['C5', E], ['B4', E], ['A4', E],
    ['B4', 1], ['C5', E], ['B4', E], ['A4', E], ['G4', E],
    ['A4', 1], ['B4', E], ['A4', E], ['G4', E], ['F#4', E],
    ['G4', 3],
  ];

  score.melody(phrase, 0, 0.74);
  score.melody(answer, 24, 0.74);
  score.melody(phrase, 36, 0.7);
  score.melody(answer, 60, 0.7);

  // Main gauche : un accord par mesure, tenu presque toute la mesure.
  const G = ['G2', 'B2', 'D3'];
  const C = ['C3', 'E3', 'G3'];
  const D = ['A2', 'D3', 'F#3'];
  const harmony = [G, G, C, G, C, G, D, D, C, G, D, G];
  for (let repeat = 0; repeat < 2; repeat += 1) {
    harmony.forEach((chord, bar) => {
      score.add(chord, repeat * 36 + bar * 3, 2.8, 0.42);
    });
  }
  return score;
}

/* ---------------------------------------------------------------- */
/* 3. Johann Pachelbel — Canon en ré majeur                          */
/* ---------------------------------------------------------------- */

function pachelbelCanon() {
  const score = new Score('Canon en ré majeur', 64);
  // La basse obstinée : huit notes de deux temps, soit quatre mesures.
  const ground = ['D3', 'A2', 'B2', 'F#2', 'G2', 'D2', 'G2', 'A2'];
  const chords = [
    ['F#4', 'A4', 'D5'], ['E4', 'A4', 'C#5'], ['D4', 'F#4', 'B4'], ['C#4', 'F#4', 'A4'],
    ['D4', 'G4', 'B4'], ['D4', 'F#4', 'A4'], ['D4', 'G4', 'B4'], ['C#4', 'E4', 'A4'],
  ];

  const CYCLES = 4;
  for (let cycle = 0; cycle < CYCLES; cycle += 1) {
    const base = cycle * 16;
    ground.forEach((bass, i) => score.add(bass, base + i * 2, 1.9, 0.5));
    chords.forEach((chord, i) => score.add(chord, base + i * 2, 1.9, 0.3));
  }

  // 2e cycle : la première ligne du violon, en noires.
  score.sequence(['F#5', 'E5', 'D5', 'C#5', 'B4', 'A4', 'B4', 'C#5'], 16, 2, 0.72);
  // 3e cycle : la deuxième ligne, un degré plus bas.
  score.sequence(['D5', 'C#5', 'B4', 'A4', 'G4', 'F#4', 'G4', 'E4'], 32, 2, 0.72);
  // 4e cycle : la variation en croches, celle que tout le monde reconnaît.
  const eighths = [
    'D5', 'F#5', 'A5', 'G5', 'F#5', 'D5', 'F#5', 'E5',
    'D5', 'B4', 'D5', 'A4', 'G4', 'B4', 'A4', 'G4',
    'F#4', 'D4', 'E4', 'C#4', 'D4', 'A4', 'F#4', 'A4',
    'G4', 'B4', 'A4', 'G4', 'F#4', 'D4', 'E4', 'C#4',
  ];
  score.sequence(eighths, 48, 0.5, 0.7);

  score.add(['D2', 'A2', 'D4', 'F#4', 'A4'], CYCLES * 16, 6, 0.55);
  return score;
}

/* ---------------------------------------------------------------- */
/* 4. Antonio Vivaldi — Le Printemps (Les Quatre Saisons)            */
/* ---------------------------------------------------------------- */

function vivaldiPrintemps() {
  const score = new Score('Le Printemps — 1er mouvement', 108);
  const E = 0.5;
  const theme = [
    ['E5', E], ['E5', E], ['E5', 1], ['B4', E], ['B4', 1.5],
    ['E5', E], ['E5', E], ['E5', 1], ['B4', E], ['B4', 1.5],
    ['C#5', E], ['B4', E], ['C#5', E], ['D#5', E], ['E5', 1], ['E5', 1],
    ['B4', E], ['A4', E], ['G#4', E], ['A4', E], ['B4', 1], ['E5', 1],
  ];
  const bridge = [
    ['G#5', E], ['F#5', E], ['G#5', E], ['A5', E], ['B5', 1], ['B5', 1],
    ['A5', E], ['G#5', E], ['F#5', E], ['E5', E], ['D#5', 1], ['E5', 1],
    ['F#5', E], ['G#5', E], ['A5', E], ['G#5', E], ['F#5', 1], ['E5', 1],
    ['B4', E], ['D#5', E], ['F#5', E], ['D#5', E], ['E5', 2],
  ];

  score.melody(theme, 0, 0.76);
  score.melody(theme, 16, 0.56); // l'écho, plus doux — c'est le procédé de Vivaldi
  score.melody(bridge, 32, 0.76);
  score.melody(theme, 48, 0.76);

  // Basse continue : un accord par mesure.
  const E_ = ['E3', 'G#3', 'B3'];
  const B_ = ['B2', 'D#3', 'F#3'];
  const A_ = ['A2', 'C#3', 'E3'];
  const grid = [E_, E_, E_, E_, E_, E_, E_, B_, E_, E_, B_, E_, A_, B_, E_, B_, E_, E_, E_, B_, E_, E_, B_, E_];
  grid.forEach((chord, bar) => {
    score.add(chord[0], bar * 4, 1.9, 0.44);
    score.add(chord, bar * 4 + 2, 1.9, 0.32);
  });
  score.add(['E2', 'E3', 'G#3', 'B3', 'E4'], 64, 4, 0.6);
  return score;
}

/* ---------------------------------------------------------------- */
/* 5. W. A. Mozart — Sonate facile K. 545, 1er mouvement             */
/* ---------------------------------------------------------------- */

function mozartK545() {
  const score = new Score('Sonate en ut majeur K. 545 — Allegro', 126);
  const E = 0.5;
  const right = [
    ['C5', 1], ['E5', 1], ['G5', E], ['B5', E], ['C6', 1],
    ['D6', E], ['C6', E], ['B5', 1], ['A5', E], ['G5', E], ['F5', E], ['E5', E],
    ['D5', 1], ['E5', E], ['F5', E], ['G5', 1], ['A5', E], ['B5', E],
    ['C6', 2], [null, 2],
    ['G5', E], ['A5', E], ['B5', E], ['C6', E], ['D6', E], ['E6', E], ['F6', E], ['G6', E],
    ['F6', E], ['E6', E], ['D6', E], ['C6', E], ['B5', E], ['A5', E], ['G5', E], ['F5', E],
    ['E5', 1], ['G5', 1], ['C6', 1], ['B5', E], ['C6', E],
    ['C6', 3], [null, 1],
  ];
  score.melody(right, 0, 0.74);

  // Main gauche : la basse d'Alberti, marque de fabrique du style galant.
  const C = ['C3', 'E3', 'G3'];
  const G = ['B2', 'D3', 'G3'];
  const grid = [C, G, C, C, C, G, C, C];
  grid.forEach((triad, bar) => score.alberti(triad, bar * 4, 1, E, 0.4));
  score.add(['C3', 'E3', 'G3', 'C4'], 32, 3, 0.5);
  return score;
}

/* ---------------------------------------------------------------- */
/* 6. W. A. Mozart — Marche turque (Rondo alla turca)                */
/* ---------------------------------------------------------------- */

function mozartMarcheTurque() {
  const score = new Score('Marche turque — Rondo alla turca', 112);
  const S = 0.25;
  const E = 0.5;
  // Le thème : quatre doubles croches qui tournent autour d'une note, puis
  // la note d'arrivée. Quatre fois de suite, chaque fois plus haut.
  const theme = [
    ['B4', S], ['A4', S], ['G#4', S], ['A4', S], ['C5', E],
    ['D5', S], ['C5', S], ['B4', S], ['C5', S], ['E5', E],
    ['F5', S], ['E5', S], ['D#5', S], ['E5', S], ['B5', E],
    ['A5', S], ['G#5', S], ['A5', S], ['B5', S], ['C6', E],
    ['A5', S], ['G#5', S], ['A5', S], ['B5', S], ['A5', E],
    ['A5', S], ['G#5', S], ['A5', S], ['B5', S], ['A5', E],
    ['C6', S], ['B5', S], ['A5', S], ['G#5', S], ['A5', 1],
  ];
  const cadence = [
    ['E5', E], ['C5', E], ['B4', E], ['A4', E],
    ['G#4', E], ['A4', E], ['B4', E], ['C5', E],
    ['D5', E], ['C5', E], ['B4', E], ['A4', E],
    ['A4', 2],
  ];

  let at = score.melody(theme, 0, 0.78);
  at = score.melody(cadence, at, 0.74);
  at = score.melody(theme, at, 0.78);
  at = score.melody(cadence, at, 0.74);

  // Main gauche : accords secs sur les temps, à la manière d'une fanfare.
  const Am = ['A2', 'C3', 'E3'];
  const E7 = ['E2', 'G#2', 'D3'];
  const total = Math.ceil(at);
  for (let beat = 0; beat < total; beat += 1) {
    const chord = Math.floor(beat / 2) % 4 === 3 ? E7 : Am;
    score.add(chord, beat, 0.45, beat % 2 === 0 ? 0.44 : 0.34);
  }
  score.add(['A2', 'A3', 'C4', 'E4', 'A4'], at, 3, 0.7);
  return score;
}

/* ---------------------------------------------------------------- */
/* 7. L. van Beethoven — Lettre à Élise, WoO 59                      */
/* ---------------------------------------------------------------- */

function furElise() {
  const score = new Score('Lettre à Élise (section A)', 76, [3, 8]);
  const S = 0.25;
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

/* ---------------------------------------------------------------- */
/* 8. L. van Beethoven — Hymne à la joie (9e symphonie)              */
/* ---------------------------------------------------------------- */

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

/* ---------------------------------------------------------------- */
/* 9. L. van Beethoven — Sonate au clair de lune, 1er mouvement      */
/* ---------------------------------------------------------------- */

function clairDeLuneBeethoven() {
  const score = new Score('Sonate au clair de lune — Adagio sostenuto', 54);
  const T = 1 / 3; // les triolets qui ne s'arrêtent jamais

  // Chaque mesure : une basse tenue, et quatre triolets d'arpège.
  const bars = [
    { bass: ['C#2', 'C#3'], arps: [['G#3', 'C#4', 'E4']] },
    { bass: ['C#2', 'C#3'], arps: [['G#3', 'C#4', 'E4']] },
    { bass: ['B1', 'B2'], arps: [['G#3', 'C#4', 'E4'], ['A3', 'C#4', 'E4']] },
    { bass: ['A1', 'A2'], arps: [['A3', 'C#4', 'E4'], ['A3', 'D4', 'F#4']] },
    { bass: ['G#1', 'G#2'], arps: [['G#3', 'B#3', 'F#4'], ['G#3', 'C#4', 'E4']] },
    { bass: ['C#2', 'C#3'], arps: [['G#3', 'C#4', 'E4']] },
    { bass: ['C#2', 'C#3'], arps: [['G#3', 'C#4', 'E4']] },
    { bass: ['B1', 'B2'], arps: [['G#3', 'C#4', 'E4'], ['A3', 'C#4', 'E4']] },
    { bass: ['A1', 'A2'], arps: [['A3', 'C#4', 'E4'], ['A3', 'D4', 'F#4']] },
    { bass: ['G#1', 'G#2'], arps: [['G#3', 'B#3', 'F#4'], ['G#3', 'C#4', 'D#4']] },
    { bass: ['C#2', 'C#3'], arps: [['G#3', 'C#4', 'E4']] },
    { bass: ['C#2', 'C#3'], arps: [['G#3', 'C#4', 'E4']] },
  ];

  bars.forEach((bar, index) => {
    const at = index * 4;
    score.add(bar.bass, at, 3.9, 0.42);
    for (let group = 0; group < 4; group += 1) {
      const arp = bar.arps[Math.floor((group * bar.arps.length) / 4)];
      arp.forEach((pitch, i) => score.add(pitch, at + group + i * T, T, 0.34));
    }
  });

  // La mélodie, à partir de la 5e mesure : trois notes répétées, long-bref-long.
  const tune = [
    [16, [['G#4', 1.5], ['G#4', 0.5], ['G#4', 2]]],
    [20, [['G#4', 1.5], ['G#4', 0.5], ['G#4', 1], ['G#4', 1]]],
    [24, [['A4', 1.5], ['A4', 0.5], ['A4', 2]]],
    [28, [['G#4', 1.5], ['G#4', 0.5], ['E4', 1], ['E4', 1]]],
    [32, [['G#4', 1.5], ['G#4', 0.5], ['G#4', 2]]],
    [36, [['G#4', 1.5], ['G#4', 0.5], ['C#5', 2]]],
    [40, [['B4', 1.5], ['B4', 0.5], ['B4', 2]]],
    [44, [['C#5', 4]]],
  ];
  for (const [at, phrase] of tune) score.melody(phrase, at, 0.7);

  score.add(['C#2', 'C#3', 'G#3', 'C#4', 'E4'], 48, 6, 0.5);
  return score;
}

/* ---------------------------------------------------------------- */
/* 10. Frédéric Chopin — Nocturne op. 9 no 2                         */
/* ---------------------------------------------------------------- */

function chopinNocturne() {
  const score = new Score('Nocturne op. 9 no 2', 60, [3, 4]);
  const S = 0.25;

  const phraseA = [
    ['Bb4', 2], ['G5', 0.75], ['F5', S],
    ['Eb5', 1], ['Bb4', 1], ['C5', 0.75], ['Bb4', S],
    ['Ab4', 2], ['G4', 0.5], ['F4', 0.5],
    ['G4', 3],
  ];
  const phraseB = [
    ['Bb4', 2], ['Eb5', 0.75], ['D5', S],
    ['C5', 1], ['Bb4', 1], ['Ab4', 0.5], ['G4', 0.5],
    ['F4', 1], ['G4', 1], ['Ab4', 1],
    ['Bb4', 3],
  ];
  const phraseC = [
    ['Eb5', 1.5], ['F5', 0.5], ['G5', 1],
    ['Ab5', 1], ['G5', 0.5], ['F5', 0.5], ['Eb5', 1],
    ['D5', 1], ['Eb5', 1], ['F5', 1],
    ['Eb5', 3],
  ];

  let at = score.melody(phraseA, 0, 0.72);
  at = score.melody(phraseB, at, 0.7);
  at = score.melody(phraseC, at, 0.74);
  at = score.melody(phraseA, at, 0.68);

  // Main gauche : la basse sur le premier temps, l'accord sur les deux autres.
  const Eb = [['Eb2'], ['Bb3', 'Eb4', 'G4']];
  const Bb7 = [['Bb1'], ['Ab3', 'D4', 'F4']];
  const Ab = [['Ab1'], ['Ab3', 'C4', 'Eb4']];
  const Cm = [['C2'], ['Eb3', 'G3', 'C4']];
  const grid = [Eb, Bb7, Eb, Eb, Eb, Bb7, Cm, Ab, Ab, Eb, Bb7, Eb, Eb, Bb7, Eb, Eb];
  grid.forEach(([bass, chord], bar) => {
    const t = bar * 3;
    score.add(bass, t, 0.9, 0.46);
    score.add(chord, t + 1, 0.9, 0.32);
    score.add(chord, t + 2, 0.9, 0.32);
  });
  score.add(['Eb2', 'Bb3', 'Eb4', 'G4', 'Bb4'], 48, 5, 0.5);
  return score;
}

/* ---------------------------------------------------------------- */
/* 11. Frédéric Chopin — Prélude op. 28 no 4 en mi mineur            */
/* ---------------------------------------------------------------- */

function chopinPreludeMiMineur() {
  const score = new Score('Prélude op. 28 no 4 en mi mineur', 56);
  // La mélodie tient sur presque rien ; c'est l'accompagnement qui descend,
  // demi-ton par demi-ton, et fait toute la couleur de la pièce.
  const melody = [
    ['B4', 4], ['B4', 3], ['C5', 1],
    ['B4', 2], ['B4', 2], ['A4', 3], ['B4', 1],
    ['C5', 2], ['B4', 2], ['A4', 4],
    ['G4', 2], ['A4', 1], ['B4', 1], ['C5', 3], ['B4', 1],
    ['A4', 4], ['G4', 4],
    ['F#4', 3], ['G4', 1], ['A4', 2], ['B4', 2],
    ['E4', 6], [null, 2],
  ];
  score.melody(melody, 0, 0.7);

  // Une nappe de croches répétées, dont la note grave glisse vers le bas.
  const chords = [
    ['E3', 'G3', 'B3'], ['E3', 'G3', 'B3'],
    ['D#3', 'G3', 'B3'], ['D3', 'G3', 'B3'],
    ['C#3', 'G3', 'B3'], ['C3', 'F#3', 'A3'],
    ['B2', 'F#3', 'A3'], ['B2', 'E3', 'G3'],
    ['A#2', 'E3', 'G3'], ['A2', 'D#3', 'F#3'],
    ['G#2', 'D#3', 'F#3'], ['G2', 'D3', 'F3'],
    ['F#2', 'C#3', 'E3'], ['F#2', 'B2', 'D#3'],
    ['B2', 'D#3', 'F#3'], ['E2', 'B2', 'E3'],
  ];
  chords.forEach((chord, bar) => {
    for (let i = 0; i < 8; i += 1) score.add(chord, bar * 4 + i * 0.5, 0.5, 0.3);
  });
  score.add(['E2', 'B2', 'E3', 'G3', 'B3', 'E4'], 64, 5, 0.42);
  return score;
}

/* ---------------------------------------------------------------- */
/* 12. Frédéric Chopin — Valse op. 64 no 2 en ut dièse mineur        */
/* ---------------------------------------------------------------- */

function chopinValse() {
  const score = new Score('Valse op. 64 no 2', 152, [3, 4]);
  const E = 0.5;
  const theme = [
    ['G#5', 2], ['G#5', 0.5], ['A5', 0.5],
    ['G#5', 1], ['F#5', 1], ['E5', 1],
    ['D#5', 2], ['E5', 0.5], ['F#5', 0.5],
    ['E5', 2], [null, 1],
    ['G#5', 2], ['G#5', 0.5], ['A5', 0.5],
    ['G#5', 1], ['F#5', 1], ['E5', 1],
    ['D#5', 1], ['C#5', 1], ['B#4', 1],
    ['C#5', 2], [null, 1],
  ];
  const trio = [
    ['C#5', E], ['D#5', E], ['E5', E], ['F#5', E], ['G#5', E], ['A5', E],
    ['G#5', 1], ['F#5', 1], ['E5', 1],
    ['D#5', E], ['E5', E], ['F#5', E], ['G#5', E], ['A5', E], ['B5', E],
    ['G#5', 2], [null, 1],
  ];

  let at = score.melody(theme, 0, 0.76);
  at = score.melody(trio, at, 0.74);
  at = score.melody(theme, at, 0.76);

  const Cm = [['C#3'], ['G#3', 'C#4', 'E4']];
  const G7 = [['G#2'], ['G3', 'B#3', 'D#4']];
  const Fm = [['F#3'], ['A3', 'C#4', 'F#4']];
  const grid = [Cm, G7, Cm, Cm, Cm, G7, G7, Cm, Fm, Cm, Fm, Cm, Cm, G7, Cm, Cm];
  const bars = Math.ceil(at / 3);
  for (let bar = 0; bar < bars; bar += 1) {
    const [bass, chord] = grid[bar % grid.length];
    score.waltz(bass, chord, bar * 3, 1, 0.4);
  }
  score.add(['C#3', 'G#3', 'C#4', 'E4', 'G#4'], bars * 3, 3, 0.6);
  return score;
}

/* ---------------------------------------------------------------- */
/* 13. Johannes Brahms — Berceuse, op. 49 no 4                       */
/* ---------------------------------------------------------------- */

function brahmsBerceuse() {
  const score = new Score('Berceuse, op. 49 no 4', 96, [3, 4]);
  const melody = [
    ['A4', 0.5], ['A4', 0.5], ['C5', 2],
    ['A4', 0.5], ['A4', 0.5], ['C5', 2],
    ['A4', 0.5], ['C5', 0.5], ['F5', 1], ['E5', 1],
    ['D5', 1], ['D5', 1], ['C5', 1],
    ['Bb4', 0.5], ['Bb4', 0.5], ['A4', 1], ['G4', 1],
    ['Bb4', 1], ['A4', 1], ['G4', 1],
    ['Bb4', 0.5], ['Bb4', 0.5], ['A4', 1], ['G4', 1],
    ['Bb4', 1], ['D5', 1], ['C5', 1],
    ['F4', 0.5], ['F4', 0.5], ['D5', 2],
    ['Bb4', 0.5], ['D5', 0.5], ['A4', 2],
    ['F4', 0.5], ['F4', 0.5], ['D5', 1], ['C5', 1],
    ['Bb4', 1], ['A4', 1], ['G4', 1],
    ['F4', 3],
  ];
  score.melody(melody, 0, 0.7);

  const F = [['F2'], ['A3', 'C4', 'F4']];
  const C7 = [['C3'], ['G3', 'Bb3', 'E4']];
  const Bb = [['Bb2'], ['Bb3', 'D4', 'F4']];
  const grid = [F, F, F, C7, C7, C7, C7, F, Bb, F, C7, F, F];
  grid.forEach(([bass, chord], bar) => score.waltz(bass, chord, bar * 3, 1, 0.36));
  return score;
}

/* ---------------------------------------------------------------- */
/* 14. Jacques Offenbach — Le Cancan (Orphée aux Enfers)             */
/* ---------------------------------------------------------------- */

function offenbachCancan() {
  const score = new Score('Le Cancan — Orphée aux Enfers', 132, [2, 4]);
  const E = 0.5;
  const S = 0.25;
  const intro = [
    ['G5', E], ['E5', E], ['C5', E], ['E5', E],
    ['G5', E], ['E5', E], ['C5', E], ['E5', E],
    ['G5', S], ['A5', S], ['G5', S], ['F5', S], ['E5', E], ['C5', E],
    ['D5', E], ['E5', E], ['F5', E], ['G5', E],
  ];
  const galop = [
    ['C5', E], ['E5', S], ['D5', S], ['C5', E], ['E5', S], ['D5', S],
    ['C5', E], ['D5', E], ['E5', E], ['F5', E],
    ['G5', E], ['E5', E], ['C5', E], ['E5', E],
    ['D5', 1], ['G4', 1],
    ['C5', E], ['E5', S], ['D5', S], ['C5', E], ['E5', S], ['D5', S],
    ['C5', E], ['D5', E], ['E5', E], ['F5', E],
    ['G5', E], ['F5', E], ['E5', E], ['D5', E],
    ['C5', 2],
  ];

  let at = score.melody(intro, 0, 0.8);
  at = score.melody(galop, at, 0.8);
  at = score.melody(galop, at, 0.8);

  // Accompagnement de galop : basse sur 1, accord sur 2. Sans relâche.
  const C = [['C3'], ['E3', 'G3', 'C4']];
  const G7 = [['G2'], ['D3', 'F3', 'B3']];
  const F = [['F2'], ['A3', 'C4', 'F4']];
  const grid = [C, C, F, G7, C, C, G7, C, C, F, G7, C, C, G7, C, C];
  const bars = Math.ceil(at / 2);
  for (let bar = 0; bar < bars; bar += 1) {
    const [bass, chord] = grid[bar % grid.length];
    score.add(bass, bar * 2, 0.45, 0.5);
    score.add(chord, bar * 2 + 1, 0.45, 0.4);
  }
  score.add(['C3', 'G3', 'C4', 'E4', 'G4', 'C5'], bars * 2, 2, 0.85);
  return score;
}

/* ---------------------------------------------------------------- */
/* 15. Edvard Grieg — Dans l'antre du roi de la montagne             */
/* ---------------------------------------------------------------- */

function griegRoiMontagne() {
  const score = new Score('Dans l’antre du roi de la montagne', 132, [4, 4]);
  const E = 0.5;
  const theme = [
    'B3', 'C#4', 'D4', 'E4', 'F#4', 'D4', 'F#4',
    'F4', 'C#4', 'F4', 'E4', 'C4', 'E4',
    'B3', 'C#4', 'D4', 'E4', 'F#4', 'D4', 'F#4',
    'A4', 'G#4', 'F#4', 'D#4', 'F#4', 'B4',
  ];
  const bass = ['B2', 'F#2', 'B2', 'F#2'];

  // Quatre passages : de plus en plus vite, de plus en plus fort.
  // (Le tempo est fixe dans un MIDI simple : c'est la densité et la nuance
  // qui font la montée — l'octave grimpe, la vélocité aussi.)
  let at = 0;
  const passes = [
    { octave: 0, velocity: 0.5, step: E },
    { octave: 0, velocity: 0.64, step: E },
    { octave: 12, velocity: 0.78, step: 0.25 },
    { octave: 12, velocity: 0.92, step: 0.25 },
  ];
  for (const pass of passes) {
    theme.forEach((pitch, i) => {
      score.add(pitch, at + i * pass.step, pass.step, pass.velocity);
      if (pass.octave) score.add(pitch, at + i * pass.step, pass.step, pass.velocity * 0.7);
    });
    const span = theme.length * pass.step;
    for (let i = 0; i * 1 < span; i += 1) {
      score.add(bass[i % bass.length], at + i, 0.9, pass.velocity * 0.6);
    }
    at += Math.ceil(span / 4) * 4;
  }
  score.add(['B2', 'B3', 'D4', 'F#4', 'B4'], at, 2, 1);
  score.add(['B2', 'B3', 'D4', 'F#4', 'B4'], at + 2, 2, 1);
  return score;
}

/* ---------------------------------------------------------------- */
/* 16. Edvard Grieg — Le Matin (Peer Gynt)                           */
/* ---------------------------------------------------------------- */

function griegLeMatin() {
  const score = new Score('Le Matin — Peer Gynt', 84, [6, 8]);
  const E = 0.5;
  // Une mélodie entièrement pentatonique, qui monte et redescend en boucle.
  const phrase = [
    ['G5', E], ['E5', E], ['D5', E], ['B4', E], ['D5', E], ['E5', E],
    ['G5', E], ['E5', E], ['G5', E], ['A5', 1.5],
    ['E5', E], ['G5', E], ['E5', E], ['D5', E], ['B4', E], ['D5', E],
    ['B4', 3],
  ];
  const answer = [
    ['B4', E], ['D5', E], ['E5', E], ['G5', E], ['E5', E], ['D5', E],
    ['E5', E], ['G5', E], ['A5', E], ['B5', 1.5],
    ['A5', E], ['G5', E], ['E5', E], ['D5', E], ['B4', E], ['G4', E],
    ['E4', 3],
  ];

  let at = score.melody(phrase, 0, 0.62);
  at = score.melody(answer, at, 0.7);
  at = score.melody(phrase, at, 0.66);

  const E_ = ['E3', 'G3', 'B3'];
  const B_ = ['B2', 'D#3', 'F#3'];
  const A_ = ['A2', 'C#3', 'E3'];
  const grid = [E_, E_, A_, E_, B_, E_, A_, B_, E_, E_, A_, E_, B_, E_, E_, E_];
  const bars = Math.ceil(at / 3);
  for (let bar = 0; bar < bars; bar += 1) {
    const chord = grid[bar % grid.length];
    score.arpeggio([chord[0], chord[1], chord[2], chord[1]], bar * 3, 1, 0.5, 0.3);
  }
  score.add(['E2', 'E3', 'G3', 'B3', 'E4'], bars * 3, 3, 0.45);
  return score;
}

/* ---------------------------------------------------------------- */
/* 17. P. I. Tchaïkovski — Danse de la fée Dragée                    */
/* ---------------------------------------------------------------- */

function tchaikovskiFeeDragee() {
  const score = new Score('Danse de la fée Dragée', 108, [2, 4]);
  const E = 0.5;
  const S = 0.25;
  // Le célesta : une descente en cascade, toujours la même, toujours ailleurs.
  const phraseA = [
    ['E6', S], ['D#6', S], ['E6', S], ['D#6', S], ['E6', S], ['B5', S], ['D6', S], ['C6', S],
    ['A5', E], [null, E], ['A5', S], ['C6', S], ['E6', S], ['A6', S],
    ['G6', E], [null, E], ['E6', S], ['G6', S], ['B6', S], ['G6', S],
    ['E6', 1], [null, 1],
  ];
  const phraseB = [
    ['E6', S], ['D#6', S], ['E6', S], ['D#6', S], ['E6', S], ['B5', S], ['D6', S], ['C6', S],
    ['A5', E], [null, E], ['A5', S], ['C6', S], ['E6', S], ['A6', S],
    ['G6', E], ['F6', E], ['E6', E], ['D6', E],
    ['C6', 1], [null, 1],
  ];

  let at = score.melody(phraseA, 0, 0.7);
  at = score.melody(phraseB, at, 0.7);
  at = score.melody(phraseA, at, 0.68);
  at = score.melody(phraseB, at, 0.72);

  // Le pizzicato des contrebasses : deux notes par mesure, sèches.
  const Em = ['E3', 'B3'];
  const B7 = ['B2', 'F#3'];
  const Am = ['A2', 'E3'];
  const grid = [Em, Em, Am, Em, Em, Em, B7, Em];
  const bars = Math.ceil(at / 2);
  for (let bar = 0; bar < bars; bar += 1) {
    const chord = grid[bar % grid.length];
    score.add(chord[0], bar * 2, 0.3, 0.44);
    score.add(chord[1], bar * 2 + 1, 0.3, 0.36);
  }
  score.add(['E3', 'B3', 'E4', 'G4', 'B4'], bars * 2, 2, 0.55);
  return score;
}

/* ---------------------------------------------------------------- */
/* 18. Erik Satie — Gymnopédie no 1                                  */
/* ---------------------------------------------------------------- */

function satieGymnopedie() {
  const score = new Score('Gymnopédie no 1', 66, [3, 4]);

  // L'accompagnement : basse grave sur le premier temps, accord suspendu sur
  // le deuxième. Deux mesures qui se répondent, indéfiniment.
  const swing = [
    [['G1'], ['B3', 'D4', 'F#4']],
    [['D2'], ['F#3', 'A3', 'C#4']],
  ];
  const BARS = 24;
  for (let bar = 0; bar < BARS; bar += 1) {
    const [bass, chord] = swing[bar % 2];
    score.add(bass, bar * 3, 0.95, 0.4);
    score.add(chord, bar * 3 + 1, 1.9, 0.28);
  }

  // La mélodie entre à la 5e mesure et flotte au-dessus, en valeurs longues.
  const tune = [
    ['F#5', 3],
    ['A5', 1], ['G#5', 1], ['B5', 1],
    ['A5', 2], ['G#5', 1],
    ['F#5', 3],
    ['E5', 1], ['D5', 1], ['C#5', 1],
    ['D5', 2], ['E5', 1],
    ['F#5', 2], ['A5', 1],
    ['G#5', 3],
    ['B5', 1], ['A5', 1], ['G#5', 1],
    ['F#5', 2], ['E5', 1],
    ['D5', 3],
    ['C#5', 1], ['D5', 1], ['E5', 1],
    ['F#5', 2], ['G#5', 1],
    ['A5', 3],
    ['F#5', 2], ['E5', 1],
    ['D5', 3],
  ];
  score.melody(tune, 12, 0.62);
  score.add(['G1', 'B3', 'D4', 'F#4'], BARS * 3, 6, 0.36);
  return score;
}

/* ---------------------------------------------------------------- */
/* 19. Erik Satie — Gnossienne no 1                                  */
/* ---------------------------------------------------------------- */

function satieGnossienne() {
  const score = new Score('Gnossienne no 1', 72, [4, 4]);
  const E = 0.5;

  // Main gauche : octave grave sur le temps fort, accord sur les autres.
  // Rien ne bouge — c'est le vide autour de la mélodie qui fait la pièce.
  const bars = [
    [['F2', 'F3'], ['Ab3', 'C4', 'F4']],
    [['F2', 'F3'], ['Ab3', 'C4', 'F4']],
    [['C2', 'C3'], ['Eb3', 'G3', 'C4']],
    [['F2', 'F3'], ['Ab3', 'C4', 'F4']],
  ];
  const BARS = 20;
  for (let bar = 0; bar < BARS; bar += 1) {
    const [bass, chord] = bars[bar % bars.length];
    score.add(bass, bar * 4, 0.9, 0.4);
    for (const beat of [1, 2, 3]) score.add(chord, bar * 4 + beat, 0.9, 0.26);
  }

  // La mélodie, orientale et lasse, avec ses arabesques descendantes.
  const tune = [
    ['C5', 2], ['Db5', E], ['C5', E], ['Bb4', 1],
    ['Ab4', 2], ['G4', 1], ['F4', 1],
    ['C5', 1], ['Db5', 1], ['Eb5', 1], ['F5', 1],
    ['Eb5', 2], ['Db5', 1], ['C5', 1],
    ['Bb4', 2], ['C5', E], ['Db5', E], ['C5', 1],
    ['Ab4', 3], ['G4', 1],
    ['F4', 4],
    [null, 4],
    ['F5', 2], ['Eb5', E], ['Db5', E], ['C5', 1],
    ['Db5', 2], ['C5', 1], ['Bb4', 1],
    ['Ab4', 1], ['Bb4', 1], ['C5', 1], ['Db5', 1],
    ['C5', 2], ['Bb4', 1], ['Ab4', 1],
    ['G4', 2], ['Ab4', E], ['Bb4', E], ['Ab4', 1],
    ['F4', 4],
  ];
  score.melody(tune, 16, 0.62);
  score.add(['F2', 'F3', 'Ab3', 'C4', 'F4'], BARS * 4, 6, 0.4);
  return score;
}

/* ---------------------------------------------------------------- */
/* 20. Scott Joplin — The Entertainer                                */
/* ---------------------------------------------------------------- */

function joplinEntertainer() {
  const score = new Score('The Entertainer', 92, [4, 4]);
  const E = 0.5;
  const S = 0.25;

  const intro = [
    ['D5', S], ['D#5', S], ['E5', S], ['C6', E], ['E5', E], ['C6', E], ['E5', E], ['C6', 1],
    ['C6', S], ['D6', S], ['D#6', S], ['E6', S], ['C6', S], ['D6', S], ['E6', E], ['B5', S], ['D6', S], ['C6', 1],
  ];
  const themeA = [
    ['C6', S], ['D6', S], ['D#6', S], ['E6', S], ['C6', S], ['D6', S], ['E6', E], ['B5', S], ['D6', S], ['C6', E], [null, E],
    ['A5', S], ['G5', S], ['F#5', S], ['A5', S], ['C6', E], ['D6', S], ['B5', S], ['D6', E], ['C6', 1],
    ['A5', S], ['G5', S], ['F#5', S], ['A5', S], ['C6', E], ['D6', S], ['B5', S], ['D6', E], ['C6', 1],
    ['C6', S], ['D6', S], ['D#6', S], ['E6', S], ['C6', S], ['D6', S], ['E6', E], ['B5', S], ['D6', S], ['C6', 1],
  ];
  const themeB = [
    ['A5', S], ['G5', S], ['F#5', S], ['A5', S], ['C6', E], ['E6', E], ['D6', S], ['C6', S], ['A5', S], ['D6', S], ['C6', 1],
    ['A5', S], ['G5', S], ['F#5', S], ['A5', S], ['C6', E], ['E6', E], ['D6', S], ['C6', S], ['A5', S], ['D6', S], ['C6', 1],
    ['C6', S], ['D6', S], ['D#6', S], ['E6', S], ['C6', S], ['D6', S], ['E6', E], ['B5', S], ['D6', S], ['C6', E], [null, E],
    ['G5', S], ['A5', S], ['B5', S], ['C6', S], ['D6', E], ['E6', E], ['C6', 2],
  ];

  let at = score.melody(intro, 0, 0.76);
  at = score.melody(themeA, at, 0.78);
  at = score.melody(themeB, at, 0.78);

  // Le stride : basse sur les temps impairs, accord sur les temps pairs.
  const C = [['C3'], ['E3', 'G3', 'C4']];
  const G7 = [['G2'], ['D3', 'F3', 'B3']];
  const F = [['F2'], ['A2', 'C3', 'F3']];
  const grid = [C, C, C, G7, C, C, G7, C, F, C, G7, C, C, G7, C, C];
  const bars = Math.ceil(at / 4);
  for (let bar = 0; bar < bars; bar += 1) {
    const [bass, chord] = grid[bar % grid.length];
    for (const beat of [0, 2]) score.add(bass, bar * 4 + beat, 0.45, 0.48);
    for (const beat of [1, 3]) score.add(chord, bar * 4 + beat, 0.45, 0.38);
  }
  score.add(['C3', 'G3', 'C4', 'E4', 'G4', 'C5'], bars * 4, 3, 0.8);
  return score;
}

/* ---------------------------------------------------------------- */

export const CLASSIQUE = [
  ['Johann Sebastian Bach - Prélude en ut majeur BWV 846', bachPrelude],
  ['Johann Sebastian Bach - Menuet en sol majeur BWV Anh 114', bachMenuet],
  ['Johann Pachelbel - Canon en ré majeur', pachelbelCanon],
  ['Antonio Vivaldi - Le Printemps', vivaldiPrintemps],
  ['Wolfgang Amadeus Mozart - Sonate facile K 545', mozartK545],
  ['Wolfgang Amadeus Mozart - Marche turque', mozartMarcheTurque],
  ['Ludwig van Beethoven - Lettre à Élise', furElise],
  ['Ludwig van Beethoven - Hymne à la joie', odeToJoy],
  ['Ludwig van Beethoven - Sonate au clair de lune', clairDeLuneBeethoven],
  ['Frédéric Chopin - Nocturne op 9 no 2', chopinNocturne],
  ['Frédéric Chopin - Prélude op 28 no 4', chopinPreludeMiMineur],
  ['Frédéric Chopin - Valse op 64 no 2', chopinValse],
  ['Johannes Brahms - Berceuse', brahmsBerceuse],
  ['Jacques Offenbach - Le Cancan', offenbachCancan],
  ['Edvard Grieg - Dans l’antre du roi de la montagne', griegRoiMontagne],
  ['Edvard Grieg - Le Matin', griegLeMatin],
  ['Piotr Ilitch Tchaïkovski - Danse de la fée Dragée', tchaikovskiFeeDragee],
  ['Erik Satie - Gymnopédie no 1', satieGymnopedie],
  ['Erik Satie - Gnossienne no 1', satieGnossienne],
  ['Scott Joplin - The Entertainer', joplinEntertainer],
];
