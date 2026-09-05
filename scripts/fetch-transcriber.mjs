#!/usr/bin/env node
/**
 * Rapatrie en local le moteur de transcription audio → MIDI, pour que le
 * convertisseur MP3 fonctionne sans connexion Internet.
 *
 * Source : « basic-pitch » de Spotify (licence Apache 2.0), un réseau de
 * neurones de transcription polyphonique, plus le moteur TensorFlow.js qui
 * l'exécute. Environ 5 Mo au total, une seule fois.
 *
 *   npm run fetch-transcriber
 *
 * Le paquet publié n'expose que des modules aux imports « nus »
 * (`@tensorflow/tfjs`), que le navigateur ne sait pas résoudre. On part donc
 * du build pré-groupé de jsDelivr et on suit son graphe de dépendances, en
 * réécrivant chaque chemin distant vers le fichier voisin correspondant.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'web', 'assets', 'transcriber');
const CDN = 'https://cdn.jsdelivr.net';

const ENTRY = '/npm/@spotify/basic-pitch@1.0.1/+esm';
const MODEL_BASE = '/npm/@spotify/basic-pitch@1.0.1/model/';
const MODEL_FILES = ['model.json', 'group1-shard1of1.bin'];

/** « /npm/@tensorflow/tfjs@3.19.0/+esm » → « tensorflow-tfjs-3.19.0.js » */
function localName(remote) {
  const slug = remote
    .replace(/^\/npm\//, '')
    .replace(/\/\+esm$/, '')
    .replace(/[@/]/g, (c) => (c === '/' ? '-' : '-'))
    .replace(/^-+|-+$/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-');
  return `${slug}.js`;
}

async function get(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'lego-piano-jukebox' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} — ${url}`);
  return response;
}

/* ------------------------------------------------------------------ */

await fs.mkdir(path.join(TARGET, 'model'), { recursive: true });

// 1. Le graphe des modules, en largeur d'abord.
const queue = [ENTRY];
const seen = new Set(queue);
let modules = 0;
let bytes = 0;

while (queue.length) {
  const remote = queue.shift();
  const source = await (await get(CDN + remote)).text();

  // Tout chemin `/npm/…` cité dans le module est une dépendance à rapatrier.
  const rewritten = source.replace(/"(\/npm\/[^"]+)"/g, (_, dep) => {
    if (!seen.has(dep)) {
      seen.add(dep);
      queue.push(dep);
    }
    return `"./${localName(dep)}"`;
  });

  const file = path.join(TARGET, localName(remote));
  await fs.writeFile(file, rewritten);
  modules += 1;
  bytes += Buffer.byteLength(rewritten);
  process.stdout.write(`  ${localName(remote).padEnd(46)} ${String(Math.round(Buffer.byteLength(rewritten) / 1024)).padStart(5)} Ko\n`);
}

// 2. Les poids du réseau.
for (const name of MODEL_FILES) {
  const buffer = Buffer.from(await (await get(CDN + MODEL_BASE + name)).arrayBuffer());
  await fs.writeFile(path.join(TARGET, 'model', name), buffer);
  bytes += buffer.length;
  process.stdout.write(`  model/${name.padEnd(40)} ${String(Math.round(buffer.length / 1024)).padStart(5)} Ko\n`);
}

// 3. Un point d'entrée stable, pour que le reste du code ignore les versions.
await fs.writeFile(
  path.join(TARGET, 'index.js'),
  `// Généré par « npm run fetch-transcriber » — ne pas modifier à la main.\n` +
    `export * from './${localName(ENTRY)}';\n`
);

console.log(`\n${modules} modules + ${MODEL_FILES.length} fichiers de modèle, ${(bytes / 1048576).toFixed(1)} Mo`);
console.log(`Écrits dans ${path.relative(ROOT, TARGET)}/`);
