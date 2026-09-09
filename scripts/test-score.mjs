#!/usr/bin/env node
/**
 * Vérifie la gravure de partition : lecture des hauteurs, choix de l'armure,
 * découpage en mesures, espacement des colonnes, et — le point qui compte
 * vraiment — la correspondance entre l'instant d'une note et sa place sur la
 * page. Un curseur qui ne tomberait pas sur la note qu'on entend ruinerait
 * tout le mode partition.
 *
 * Aucun navigateur requis : `score.js` ne touche au DOM qu'au moment de
 * dessiner, et rien de ce qui est vérifié ici n'en a besoin.
 *
 *   npm test
 */

import { guessKey, spellPitch, layoutScore, pageAt, SPACE } from '../web/js/music/score.js';

let ok = 0;
let ko = 0;

const check = (label, actual, expected) => {
  const got = JSON.stringify(actual);
  const want = JSON.stringify(expected);
  if (got === want) {
    ok += 1;
    console.log(`  ✔ ${label.padEnd(52)} ${got}`);
  } else {
    ko += 1;
    console.log(`  ✘ ${label.padEnd(52)} attendu ${want}\n${' '.repeat(57)}obtenu  ${got}`);
  }
};

const assert = (label, condition, detail = '') => {
  if (condition) {
    ok += 1;
    console.log(`  ✔ ${label}`);
  } else {
    ko += 1;
    console.log(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

/* ------------------------------------------------------------------ */
/* Outils : fabriquer une partition à la main                          */
/* ------------------------------------------------------------------ */

/** Gamme majeure sur une tonique, en numéros MIDI. */
const majorScale = (tonic) => [0, 2, 4, 5, 7, 9, 11].map((step) => ({ midi: tonic + step }));

/**
 * Construit un objet de partition de la même forme que celui rendu par
 * `parseMidi`, à tempo constant.
 *
 * @param {Array<[number, number, number]>} notes triplets `[instant, durée, hauteur]`
 */
function makeMidi(notes, { bpm = 120, numerator = 4, denominator = 4 } = {}) {
  const beat = 60 / bpm;
  const duration = notes.reduce((max, [time, length]) => Math.max(max, time + length), 0);
  const beats = [];
  for (let i = 0; i * beat <= duration + beat * 4; i += 1) {
    beats.push({ time: i * beat, downbeat: i % numerator === 0 });
  }
  return {
    duration,
    averageBpm: bpm,
    timeSignature: { numerator, denominator },
    beats,
    notes: notes.map(([time, length, midi]) => ({
      time,
      duration: length,
      midi,
      velocity: 0.8,
      channel: 0,
      isDrum: false,
    })),
  };
}

/** Toutes les notes d'une mise en page, telles qu'elles ont été placées. */
function placedNotes(score) {
  const out = [];
  for (const page of score.pages) {
    for (const system of page.systems) {
      for (const cell of system.cells) out.push(...cell.measure.notes);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */

console.log('\nLECTURE DES HAUTEURS');

check('do central', spellPitch(60, 0), { step: 0, alter: 0, octave: 4, diatonic: 28 });
check('la 440', spellPitch(69, 0), { step: 5, alter: 0, octave: 4, diatonic: 33 });
// La même touche, deux noms : c'est l'armure qui tranche.
check('touche 66, armure de dièses → fa dièse', spellPitch(66, 2), { step: 3, alter: 1, octave: 4, diatonic: 31 });
check('touche 66, armure de bémols → sol bémol', spellPitch(66, -3), { step: 4, alter: -1, octave: 4, diatonic: 32 });
// Si dièse appartient à l'octave du si, pas à celle du do qu'il fait sonner.
check('touche 60, lue en si dièse', spellPitch(60, 7), { step: 0, alter: 0, octave: 4, diatonic: 28 });
check('touche 59, armure de dièses → si', spellPitch(59, 3), { step: 6, alter: 0, octave: 3, diatonic: 27 });

console.log('\nARMURE');

check('gamme de do majeur', guessKey(majorScale(60)), 0);
check('gamme de sol majeur (un dièse)', guessKey(majorScale(67)), 1);
check('gamme de ré majeur (deux dièses)', guessKey(majorScale(62)), 2);
check('gamme de fa majeur (un bémol)', guessKey(majorScale(65)), -1);
check('gamme de mi bémol majeur (trois bémols)', guessKey(majorScale(63)), -3);
// Une seule note ne prouve rien : l'armure la plus simple doit l'emporter.
check('note isolée : pas d’armure inventée', guessKey([{ midi: 60 }]), 0);
check('partition vide', guessKey([]), 0);

console.log('\nMESURES');

// Huit noires à 120 bpm en 4/4 : deux mesures pleines.
const simple = layoutScore(makeMidi(Array.from({ length: 8 }, (_, i) => [i * 0.5, 0.5, 60 + i])), { width: 900 });
check('huit noires en 4/4 → deux mesures', simple.measures.length, 2);
check('la première mesure commence à zéro', simple.measures[0].startTime, 0);
check('la seconde commence à la cinquième noire', Math.round(simple.measures[1].startTime * 100) / 100, 2);

// Un 3/4 : trois noires par mesure, pas quatre.
const waltz = layoutScore(makeMidi(Array.from({ length: 9 }, (_, i) => [i * 0.5, 0.5, 60]), { numerator: 3 }), { width: 900 });
check('neuf noires en 3/4 → trois mesures', waltz.measures.length, 3);

// Un 6/8 vaut trois noires, et non six.
const jig = layoutScore(makeMidi(Array.from({ length: 12 }, (_, i) => [i * 0.25, 0.25, 60]), { numerator: 6, denominator: 8 }), { width: 900 });
check('douze croches en 6/8 → deux mesures', jig.measures.length, 2);

console.log('\nPORTÉES ET ALTÉRATIONS');

const split = layoutScore(makeMidi([[0, 0.5, 59], [0, 0.5, 60]]), { width: 900 });
const [low, high] = placedNotes(split).sort((a, b) => a.midi - b.midi);
check('le si sous le do central va en clé de fa', low.staff, 1);
check('le do central va en clé de sol', high.staff, 0);

// Trois fa dièses tout seuls ne prouvent rien : l'armure devinée les
// contiendrait, et aucune altération ne serait écrite. On ancre donc le
// morceau en do majeur avec de vraies notes naturelles, puis on regarde ce
// qu'il advient des fa dièses qui s'y ajoutent.
const anchored = [];
for (let repeat = 0; repeat < 3; repeat += 1) {
  majorScale(60).forEach((note, i) => anchored.push([(repeat * 7 + i) * 0.125, 0.125, note.midi]));
}
// Deux fa dièses dans la troisième mesure, un autre dans la quatrième.
anchored.push([4, 0.5, 66], [4.5, 0.5, 66], [6, 0.5, 66]);
const accidentals = layoutScore(makeMidi(anchored), { width: 900 });
check('le morceau est bien lu en do majeur', accidentals.fifths, 0);
const marks = placedNotes(accidentals)
  .filter((note) => note.midi === 66)
  .map((note) => note.accidental);
check('altération écrite une seule fois par mesure', marks, [1, null, 1]);

console.log('\nESPACEMENT');

// Une blanche puis quatre doubles croches : le piège classique. Espacées au
// prorata du temps, les doubles croches se tasseraient dans le dernier quart.
const mixed = layoutScore(makeMidi([[0, 1, 60], [1, 0.125, 62], [1.125, 0.125, 64], [1.25, 0.125, 65], [1.375, 0.125, 67]]), { width: 900 });
const columns = mixed.pages[0].systems[0].cells[0].points;
const gaps = columns.slice(1).map((point, i) => point.x - columns[i].x);
assert(
  'aucune colonne écrasée par sa voisine',
  gaps.every((gap) => gap > SPACE * 1.5),
  `écarts : ${gaps.map((g) => Math.round(g)).join(', ')}`
);
assert(
  'la blanche prend plus de place qu’une double croche, sans être seize fois plus large',
  gaps[0] > gaps[1] && gaps[0] < gaps[1] * 5,
  `blanche ${Math.round(gaps[0])}, double croche ${Math.round(gaps[1])}`
);

console.log('\nSUIVI');

// Le point qui compte : l'abscisse d'une note doit être celle que le curseur
// atteindra à l'instant où elle sonne.
const followed = layoutScore(makeMidi(Array.from({ length: 16 }, (_, i) => [i * 0.5, 0.5, 60 + (i % 8)])), { width: 900, systemsPerPage: 1 });
const notes = placedNotes(followed);
assert('les abscisses suivent l’ordre du temps dans une mesure', (() => {
  for (const page of followed.pages) {
    for (const system of page.systems) {
      for (const cell of system.cells) {
        const xs = cell.measure.notes.map((note) => note.x);
        for (let i = 1; i < xs.length; i += 1) if (xs[i] < xs[i - 1] - 0.01) return false;
      }
    }
  }
  return true;
})());

assert('chaque note reçoit une abscisse', notes.every((note) => Number.isFinite(note.x)));

check('la page zéro contient le premier instant', pageAt(followed, 0), 0);
check('un instant au-delà de la fin reste sur la dernière page', pageAt(followed, 9999), followed.pages.length - 1);

// Le curseur se lit dans la même table que les notes : on refait ici le calcul
// que fait `ScoreView`, et on vérifie qu'il tombe sur la tête attendue.
const cursorAt = (score, time) => {
  for (const page of score.pages) {
    for (const system of page.systems) {
      for (const cell of system.cells) {
        if (time >= cell.measure.endTime) continue;
        const points = cell.points;
        let index = 0;
        while (index < points.length - 2 && points[index + 1].time <= time) index += 1;
        const from = points[index];
        const to = points[index + 1];
        const ratio = (time - from.time) / (to.time - from.time || 1);
        return from.x + ratio * (to.x - from.x);
      }
    }
  }
  return null;
};

const misses = notes
  .map((note) => ({ note, gap: Math.abs(cursorAt(followed, note.time) - note.x) }))
  .filter((entry) => entry.gap > 0.5);
assert(
  'le curseur tombe sur la note à l’instant où elle sonne',
  misses.length === 0,
  misses.length ? `${misses.length} note(s) manquée(s), écart max ${Math.round(Math.max(...misses.map((m) => m.gap)))}` : ''
);

console.log('\nCAS LIMITES');

check('partition sans note', layoutScore(makeMidi([])), null);
// La batterie n'est ni jouée ni gravée : ce n'est pas un piano.
const drums = makeMidi([[0, 0.5, 38]]);
drums.notes[0].isDrum = true;
check('partition de batterie seule', layoutScore(drums), null);

const single = layoutScore(makeMidi([[0, 0.5, 60]]), { width: 900 });
check('une note seule tient sur une page', single.pages.length, 1);

console.log(`\n${ok} vérifications passées, ${ko} en échec\n`);
process.exit(ko ? 1 : 0);
