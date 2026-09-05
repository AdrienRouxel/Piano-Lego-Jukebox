#!/usr/bin/env node
/**
 * Installe le moteur de transcription rapide, dans un environnement Python
 * isolé au projet (`.venv-transcriber/`).
 *
 *   npm run setup-transcriber
 *
 * Le moteur de calcul dépend de la machine, et n'est pas choisi d'avance :
 *
 *   macOS sur puce Apple  →  CoreML, qui passe par le Neural Engine
 *   tout le reste         →  ONNX Runtime, portable et léger
 *
 * CoreML n'existe que sur macOS et n'accélère que sur puce Apple ; l'imposer
 * ailleurs ferait échouer l'installation sous Windows et Linux. ONNX Runtime,
 * lui, s'installe partout — c'est le choix par défaut.
 *
 * Sans cette étape, le convertisseur fonctionne quand même : le navigateur
 * fait le même travail avec le même réseau (`npm run fetch-transcriber`),
 * simplement plus lentement.
 *
 * Pour tout désinstaller : supprime le dossier `.venv-transcriber/`.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENV = path.join(ROOT, '.venv-transcriber');
const WINDOWS = process.platform === 'win32';
const VENV_BIN = path.join(VENV, WINDOWS ? 'Scripts' : 'bin');
const VENV_PYTHON = path.join(VENV_BIN, WINDOWS ? 'python.exe' : 'python');

/** Le moteur adapté à cette machine, et pourquoi. */
export function chooseBackend(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin' && arch === 'arm64') {
    return {
      extra: 'coreml',
      why: 'macOS sur puce Apple : CoreML passe par le Neural Engine',
    };
  }
  if (platform === 'darwin') {
    return { extra: 'onnx', why: 'macOS Intel : CoreML n’y accélère rien, ONNX Runtime fait mieux' };
  }
  return {
    extra: 'onnx',
    why: `${platform === 'win32' ? 'Windows' : 'Linux'} : ONNX Runtime, portable et léger`,
  };
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/** Le premier interpréteur Python 3 utilisable, ou `null`. */
async function findPython() {
  const candidates = WINDOWS ? ['py', 'python', 'python3'] : ['python3', 'python3.12', 'python3.11', 'python'];
  for (const candidate of candidates) {
    const args = candidate === 'py' ? ['-3', '--version'] : ['--version'];
    const code = await run(candidate, args, { stdio: 'ignore' });
    if (code === 0) return candidate;
  }
  return null;
}

/* ------------------------------------------------------------------ */

/** Le déroulé complet de l'installation. */
async function main() {
  const { extra, why } = chooseBackend();
  console.log('');
  console.log(`  Machine  : ${process.platform} / ${process.arch}`);
  console.log(`  Moteur   : ${extra}  (${why})`);
  console.log('');

  const python = await findPython();
  if (!python) {
    console.error('  Python 3 est introuvable. Installe-le, puis relance cette commande.');
    console.error('  Sans Python, le convertisseur reste utilisable : « npm run fetch-transcriber »');
    console.error('  installe la version navigateur, plus lente mais sans dépendance.');
    process.exit(1);
  }

  const exists = await fs.access(VENV_PYTHON).then(() => true, () => false);
  if (!exists) {
    console.log(`  Création de l'environnement dans ${path.relative(ROOT, VENV)}/ …`);
    const args = python === 'py' ? ['-3', '-m', 'venv', VENV] : ['-m', 'venv', VENV];
    if ((await run(python, args)) !== 0) {
      console.error('  La création de l’environnement a échoué.');
      process.exit(1);
    }
  }

  console.log(`  Installation de basic-pitch[${extra}] … (quelques minutes, environ 330 Mo)`);
  console.log('');
  const code = await run(VENV_PYTHON, ['-m', 'pip', 'install', '--upgrade', `basic-pitch[${extra}]==0.4.0`]);
  if (code !== 0) {
    console.error('');
    console.error('  L’installation a échoué. Le convertisseur reste utilisable via le');
    console.error('  navigateur : « npm run fetch-transcriber ».');
    process.exit(1);
  }

  // On vérifie que le moteur répond vraiment, plutôt que de supposer.
  console.log('');
  const check = spawn(VENV_PYTHON, [path.join(ROOT, 'scripts', 'transcribe.py'), '--describe']);
  let out = '';
  check.stdout.on('data', (chunk) => { out += chunk; });
  check.on('close', () => {
    try {
      const info = JSON.parse(out);
      console.log(`  Installé : ${info.installed.join(', ') || 'aucun'}`);
      console.log(`  Python   : ${info.python}`);
      console.log('');
      console.log(info.installed.length
        ? '  Le convertisseur utilisera ce moteur automatiquement.'
        : '  Aucun moteur détecté — le navigateur prendra le relais.');
    } catch {
      console.log('  Installation terminée, mais le moteur n’a pas su se décrire.');
    }
    console.log('');
  });
}

// Comme les autres scripts du projet : rien ne s'exécute à l'import.
if (import.meta.url === `file://${process.argv[1]}`) await main();
