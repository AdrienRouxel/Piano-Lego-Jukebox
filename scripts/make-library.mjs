#!/usr/bin/env node
/**
 * Écrit la bibliothèque de départ dans `tracks/`, rangée par catégories.
 *
 * Rien n'est téléchargé : chaque partition est écrite note à note dans
 * `scripts/scores/`, puis rendue ici en fichiers MIDI standard.
 *
 *   tracks/Classique/   quatorze pièces du domaine public, en arrangement simplifié
 *   tracks/Moderne/     dix pièces originales, dans les esthétiques actuelles
 *   tracks/Gaming/      vide — à toi de la remplir
 *   tracks/Réglage/     la piste de calibration du moteur
 *
 * Un dossier vide reste une catégorie visible dans la page : c'est fait exprès,
 * pour qu'on sache où déposer ses fichiers.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Score, buildMidi } from './midi-writer.mjs';
import { CLASSIQUE } from './scores/classique.mjs';
import { MODERNE } from './scores/moderne.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRACKS_DIR = path.join(ROOT, 'tracks');

/* ---------------------------------------------------------------- */
/* La piste de réglage                                               */
/* ---------------------------------------------------------------- */

/** Écrite pour le réglage : densité croissante, silences francs, final tenu. */
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

/* ---------------------------------------------------------------- */

/**
 * Les catégories de départ. `scores` peut être vide : le dossier est alors
 * créé quand même, et la catégorie apparaît, prête à recevoir des fichiers.
 */
export const CATEGORIES = [
  { name: 'Classique', scores: CLASSIQUE },
  { name: 'Moderne', scores: MODERNE },
  { name: 'Gaming', scores: [] },
  { name: 'Réglage', scores: [['Démo - Gammes et arpèges', calibration]] },
];

/**
 * @param {string} targetDir dossier `tracks/`
 * @param {{overwrite?: boolean}} options par défaut, un fichier existant est laissé tel quel
 * @returns {Promise<string[]>} les chemins écrits, relatifs à `targetDir`
 */
export async function writeStarterLibrary(targetDir = TRACKS_DIR, { overwrite = false } = {}) {
  const written = [];
  for (const category of CATEGORIES) {
    const dir = path.join(targetDir, category.name);
    await fs.mkdir(dir, { recursive: true });

    for (const [fileName, build] of category.scores) {
      const filePath = path.join(dir, `${fileName}.mid`);
      if (!overwrite) {
        // Ne jamais écraser un fichier retouché à la main.
        const exists = await fs.access(filePath).then(() => true, () => false);
        if (exists) continue;
      }
      await fs.writeFile(filePath, buildMidi(build()));
      written.push(path.join(category.name, path.basename(filePath)));
    }
  }
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const overwrite = process.argv.includes('--force');
  const written = await writeStarterLibrary(TRACKS_DIR, { overwrite });
  if (!written.length) {
    console.log('Rien à écrire : tous les fichiers sont déjà là (relance avec --force pour les régénérer).');
  } else {
    console.log(`${written.length} morceaux écrits dans ${TRACKS_DIR} :`);
    for (const name of written) console.log(`  • ${name}`);
  }
}
