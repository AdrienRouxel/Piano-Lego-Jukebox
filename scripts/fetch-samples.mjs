#!/usr/bin/env node
/**
 * Copie en local les échantillons du piano « Salamander », pour que le jukebox
 * fonctionne sans connexion Internet.
 *
 * Source : https://tonejs.github.io/audio/salamander/ — le Salamander Grand
 * Piano d'Alexander Holm, publié sous licence Creative Commons BY 3.0.
 * Environ 2 Mo au total, une seule fois.
 *
 *   npm run fetch-samples
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'web', 'assets', 'piano');
const BASE = 'https://tonejs.github.io/audio/salamander/';

const PITCH_NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];
// Une note toutes les tierces mineures, de La0 (21) à Do8 (108).
const SAMPLES = Array.from({ length: 30 }, (_, i) => 21 + i * 3).map(
  (midi) => `${PITCH_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}.mp3`
);

await fs.mkdir(TARGET, { recursive: true });

let downloaded = 0;
let skipped = 0;
let failed = 0;

console.log(`Téléchargement de ${SAMPLES.length} échantillons vers ${TARGET}`);

for (const name of SAMPLES) {
  const destination = path.join(TARGET, name);
  try {
    await fs.access(destination);
    skipped += 1;
    continue;
  } catch { /* le fichier n'existe pas encore */ }

  try {
    const response = await fetch(BASE + name);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
    downloaded += 1;
    process.stdout.write(`\r  ${downloaded + skipped}/${SAMPLES.length}  ${name.padEnd(12)}`);
  } catch (error) {
    failed += 1;
    console.error(`\n  ✘ ${name} — ${error.message}`);
  }
}

console.log('');
console.log(`  ${downloaded} téléchargés, ${skipped} déjà présents, ${failed} en échec.`);
if (!failed) {
  console.log('  Le jukebox utilisera désormais ces fichiers, même hors connexion.');
  console.log('');
  console.log('  Échantillons : Salamander Grand Piano (Alexander Holm), licence CC BY 3.0.');
}
