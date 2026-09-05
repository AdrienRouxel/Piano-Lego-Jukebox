#!/usr/bin/env node
/**
 * Vérifie l'encodeur de code QR en le relisant dans l'autre sens.
 *
 * Un code QR ne se vérifie pas à l'œil : on refait donc ici le chemin inverse
 * de l'encodeur — retrouver le masque dans les informations de format, le
 * retirer, reparcourir le serpentin, désentrelacer les blocs, et comparer le
 * texte obtenu à celui de départ. On contrôle en plus que chaque bloc est
 * bien divisible par son polynôme générateur : c'est la propriété sur
 * laquelle repose toute la correction d'erreur de Reed-Solomon.
 *
 *   node scripts/test-qrcode.mjs
 */

import { encodeQr, functionPatterns, dataPath, errorCorrection, VERSION_BLOCKS } from '../web/js/qrcode.js';

let ok = 0;
let ko = 0;

const check = (label, actual, expected) => {
  if (actual === expected) {
    ok += 1;
    console.log(`  ✔ ${label}`);
  } else {
    ko += 1;
    console.log(`  ✘ ${label}\n      attendu ${expected}\n      obtenu  ${actual}`);
  }
};

/* ------------------------------------------------------------------ */
/* Relecture                                                           */
/* ------------------------------------------------------------------ */

const MASKS = [
  (row, col) => (row + col) % 2 === 0,
  (row) => row % 2 === 0,
  (row, col) => col % 3 === 0,
  (row, col) => (row + col) % 3 === 0,
  (row, col) => (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0,
  (row, col) => ((row * col) % 2) + ((row * col) % 3) === 0,
  (row, col) => (((row * col) % 2) + ((row * col) % 3)) % 2 === 0,
  (row, col) => (((row + col) % 2) + ((row * col) % 3)) % 2 === 0,
];

/** Relit les informations de format inscrites dans le coin supérieur gauche. */
function readFormat(modules, size) {
  const at = (row, col) => modules[row * size + col];
  let bits = 0;
  const read = (index, value) => { bits |= value << index; };
  for (let i = 0; i <= 5; i += 1) read(i, at(i, 8));
  read(6, at(7, 8));
  read(7, at(8, 8));
  read(8, at(8, 7));
  for (let i = 9; i < 15; i += 1) read(i, at(8, 14 - i));

  const unmasked = bits ^ 0x5412;
  const level = (unmasked >> 13) & 0b11;
  const mask = (unmasked >> 10) & 0b111;

  // Contrôle du code BCH : le mot de 15 bits doit être un multiple de 0x537.
  let rest = unmasked;
  for (let i = 14; i >= 10; i -= 1) {
    if (rest & (1 << i)) rest ^= 0x537 << (i - 10);
  }
  return { level, mask, valid: rest === 0 };
}

/** Retrouve le texte encodé dans une matrice de modules. */
function decodeQr({ version, size, modules }) {
  const { reserved } = functionPatterns(version);
  const { mask } = readFormat(modules, size);

  // Retrait du masque, puis lecture du serpentin.
  const bare = Uint8Array.from(modules);
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const index = row * size + col;
      if (!reserved[index] && MASKS[mask](row, col)) bare[index] ^= 1;
    }
  }

  const path = dataPath(size, reserved);
  const stream = new Uint8Array(path.length >> 3);
  for (let i = 0; i < stream.length * 8; i += 1) {
    if (bare[path[i]]) stream[i >> 3] |= 1 << (7 - (i & 7));
  }

  /* Désentrelacement : l'inverse exact de ce que fait l'encodeur. */
  const { ec, groups } = VERSION_BLOCKS[version];
  const sizes = [];
  for (const [count, length] of groups) for (let i = 0; i < count; i += 1) sizes.push(length);
  const dataBlocks = sizes.map((length) => new Uint8Array(length));
  const ecBlocks = sizes.map(() => new Uint8Array(ec));

  let cursor = 0;
  for (let i = 0; i < Math.max(...sizes); i += 1) {
    for (let b = 0; b < dataBlocks.length; b += 1) {
      if (i < sizes[b]) dataBlocks[b][i] = stream[cursor++];
    }
  }
  for (let i = 0; i < ec; i += 1) {
    for (let b = 0; b < ecBlocks.length; b += 1) ecBlocks[b][i] = stream[cursor++];
  }

  // Chaque bloc doit avoir un reste nul : sa correction d'erreur est cohérente.
  const soundBlocks = dataBlocks.every((block, b) => {
    const computed = errorCorrection(block, ec);
    return computed.every((byte, i) => byte === ecBlocks[b][i]);
  });

  const payload = Uint8Array.from(dataBlocks.flatMap((block) => [...block]));
  const bitAt = (i) => (payload[i >> 3] >> (7 - (i & 7))) & 1;
  const readBits = (from, count) => {
    let value = 0;
    for (let i = 0; i < count; i += 1) value = (value << 1) | bitAt(from + i);
    return value;
  };

  const mode = readBits(0, 4);
  const lengthBits = version < 10 ? 8 : 16;
  const length = readBits(4, lengthBits);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = readBits(4 + lengthBits + i * 8, 8);

  return { mode, mask, soundBlocks, text: new TextDecoder().decode(bytes) };
}

/* ------------------------------------------------------------------ */
/* Vérifications                                                       */
/* ------------------------------------------------------------------ */

console.log('\nSTRUCTURE');
{
  const code = encodeQr('http://192.168.1.42:4173/r');
  check('taille cohérente avec la version', code.size, code.version * 4 + 17);
  check('adresse de stand : version 2', code.version, 2);

  const at = (row, col) => code.modules[row * code.size + col];
  // Les sept lignes de la cible, telles que la norme les dessine.
  const target = [];
  for (let row = 0; row < 7; row += 1) {
    let line = '';
    for (let col = 0; col < 7; col += 1) line += at(row, col);
    target.push(line);
  }
  check(
    'cible de repérage, coin supérieur gauche',
    target.join('|'),
    '1111111|1000001|1011101|1011101|1011101|1000001|1111111'
  );
  check('séparateur clair autour de la cible', `${at(7, 7)}${at(7, 0)}${at(0, 7)}`, '000');
  check('module toujours sombre', at(code.size - 8, 8), 1);

  let timing = '';
  for (let i = 8; i < 13; i += 1) timing += at(6, i);
  check('ligne de synchronisation alternée', timing, '10101');

  const format = readFormat(code.modules, code.size);
  check('code BCH du format valide', format.valid, true);
  check('niveau de correction M', format.level, 0b00);
  check('masque relu identique', format.mask, code.mask);
}

console.log('\nALLER-RETOUR');
const samples = [
  ['adresse locale', 'http://192.168.1.42:4173/r'],
  ['adresse courte', 'http://localhost:4173/r'],
  ['une seule lettre', 'A'],
  ['accents et espaces', 'Jukebox — LEGO Grand Piano · Epitech'],
  ['texte long', 'http://192.168.1.42:4173/r?stand=epitech-journee-portes-ouvertes-2026&salle=hall-principal'],
  ['limite haute', 'x'.repeat(213)],
];

for (const [label, text] of samples) {
  const code = encodeQr(text);
  const back = decodeQr(code);
  check(`${label} — texte restitué`, back.text, text);
  check(`${label} — mode octet`, back.mode, 0b0100);
  check(`${label} — correction d’erreur cohérente`, back.soundBlocks, true);
}

console.log('\nBORNES');
{
  let message = 'aucune';
  try {
    encodeQr('x'.repeat(214));
  } catch (error) {
    message = 'refusé';
  }
  check('au-delà de la version 10, l’encodeur refuse', message, 'refusé');

  // Une version par bloc de capacité : on vérifie que le choix suit bien la taille.
  check('14 octets tiennent en version 1', encodeQr('x'.repeat(14)).version, 1);
  check('15 octets passent en version 2', encodeQr('x'.repeat(15)).version, 2);
}

console.log(`\n${ok} vérifications passées, ${ko} en échec\n`);
process.exit(ko ? 1 : 0);
