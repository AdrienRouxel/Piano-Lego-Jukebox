#!/usr/bin/env node
/**
 * Serveur du jukebox LEGO Grand Piano.
 *
 * Aucune dépendance : uniquement les modules natifs de Node.
 * Il fait deux choses :
 *   1. servir le dossier `web/` (l'application) ;
 *   2. exposer `/api/library`, qui inventorie le dossier `tracks/`.
 *
 * Le serveur écoute sur http://localhost — c'est important : le Web Bluetooth
 * n'est disponible que dans un « contexte sécurisé » (HTTPS ou localhost).
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeDemoTracks } from './scripts/make-demo-tracks.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(ROOT, 'web');
const TRACKS_DIR = path.join(ROOT, 'tracks');
const SAMPLES_DIR = path.join(WEB_DIR, 'assets', 'piano');

/**
 * Documentation consultable depuis le site. Liste fermée : on sert ces
 * fichiers-là et aucun autre, quel que soit le chemin demandé.
 */
const DOCS = [
  { id: 'guide.md', file: path.join(ROOT, 'docs', 'guide.md'), title: 'Guide pas à pas', subtitle: 'Connecter le piano et se servir de l’application' },
  { id: 'README.md', file: path.join(ROOT, 'README.md'), title: 'Comment ça marche', subtitle: 'La mécanique, le protocole, la chorégraphie' },
  { id: 'firmware.md', file: path.join(ROOT, 'docs', 'firmware.md'), title: 'Micrologiciel', subtitle: 'Pybricks, et le retour au firmware LEGO' },
];
const PORT = Number(process.env.PORT) || 4173;

const MIDI_EXT = new Set(['.mid', '.midi']);
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.ogg', '.oga', '.opus', '.wav', '.flac']);
const COVER_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.mid': 'audio/midi',
  '.midi': 'audio/midi',
};

/* ------------------------------------------------------------------ */
/* Inventaire de la bibliothèque                                       */
/* ------------------------------------------------------------------ */

/**
 * Un « morceau » est un groupe de fichiers partageant le même nom de base :
 *
 *   tracks/Chopin - Nocturne op.9 no.2.mid   ← la partition (pilote les touches)
 *   tracks/Chopin - Nocturne op.9 no.2.mp3   ← l'audio (optionnel, remplace le synthé)
 *   tracks/Chopin - Nocturne op.9 no.2.jpg   ← la pochette (optionnelle)
 *
 * Un MP3 seul fonctionne aussi : la chorégraphie est alors déduite en direct
 * du niveau sonore. Un MIDI seul fonctionne aussi : le son est synthétisé.
 */
async function scanLibrary() {
  let entries = [];
  try {
    entries = await fsp.readdir(TRACKS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const groups = new Map();
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    const ext = path.extname(entry.name).toLowerCase();
    const base = entry.name.slice(0, -ext.length || undefined);
    const slot = MIDI_EXT.has(ext) ? 'midi' : AUDIO_EXT.has(ext) ? 'audio' : COVER_EXT.has(ext) ? 'cover' : null;
    if (!slot) continue;

    const group = groups.get(base) ?? { base, midi: null, audio: null, cover: null };
    // Si plusieurs fichiers du même type coexistent, on garde le premier par ordre alphabétique.
    if (!group[slot]) group[slot] = entry.name;
    groups.set(base, group);
  }

  const tracks = [];
  for (const group of groups.values()) {
    if (!group.midi && !group.audio) continue; // une pochette orpheline n'est pas un morceau

    const { artist, title } = splitName(group.base);
    tracks.push({
      id: group.base,
      title,
      artist,
      midiUrl: group.midi ? '/tracks/' + encodeURIComponent(group.midi) : null,
      audioUrl: group.audio ? '/tracks/' + encodeURIComponent(group.audio) : null,
      coverUrl: group.cover ? '/tracks/' + encodeURIComponent(group.cover) : null,
    });
  }

  tracks.sort((a, b) => a.id.localeCompare(b.id, 'fr', { numeric: true, sensitivity: 'base' }));
  return tracks;
}

/** « Chopin - Nocturne op.9 no.2 » → { artist: 'Chopin', title: 'Nocturne op.9 no.2' } */
function splitName(base) {
  const cleaned = base.replace(/_/g, ' ').trim();
  const match = cleaned.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (match) return { artist: match[1].trim(), title: match[2].trim() };
  return { artist: null, title: cleaned };
}

async function hasLocalSamples() {
  try {
    const files = await fsp.readdir(SAMPLES_DIR);
    return files.some((f) => f.toLowerCase().endsWith('.mp3'));
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Service de fichiers                                                 */
/* ------------------------------------------------------------------ */

/** Empêche toute sortie du dossier autorisé (`..`, liens symboliques, etc.). */
function safeJoin(baseDir, urlPath) {
  const decoded = decodeURIComponent(urlPath).replace(/\0/g, '');
  const resolved = path.resolve(baseDir, '.' + path.posix.normalize(decoded));
  const prefix = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep;
  return resolved === baseDir || resolved.startsWith(prefix) ? resolved : null;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

/** Sert un fichier avec gestion des requêtes Range (indispensable pour <audio>). */
async function sendFile(req, res, filePath, { cache = 'no-cache' } = {}) {
  let stat;
  try {
    stat = await fsp.stat(filePath);
    if (stat.isDirectory()) throw new Error('directory');
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 — fichier introuvable');
    return;
  }

  const type = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const headers = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': cache,
    'last-modified': stat.mtime.toUTCString(),
  };

  const range = req.headers.range;
  const match = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (match) {
    const size = stat.size;
    let start = match[1] === '' ? null : Number(match[1]);
    let end = match[2] === '' ? null : Number(match[2]);
    if (start === null) {
      // « bytes=-500 » : les 500 derniers octets.
      start = Math.max(0, size - (end ?? 0));
      end = size - 1;
    } else {
      end = end === null ? size - 1 : Math.min(end, size - 1);
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
      res.writeHead(416, { 'content-range': `bytes */${size}` });
      res.end();
      return;
    }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, { ...headers, 'content-length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
}

/* ------------------------------------------------------------------ */
/* Routage                                                             */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  try {
    if (pathname === '/api/docs') {
      sendJson(res, 200, {
        docs: DOCS.map(({ id, title, subtitle }) => ({ id, title, subtitle })),
      });
      return;
    }

    if (pathname.startsWith('/api/docs/')) {
      // Le nom demandé est comparé à la liste, jamais transformé en chemin.
      const doc = DOCS.find((entry) => entry.id === decodeURIComponent(pathname.slice('/api/docs/'.length)));
      if (!doc) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 — document inconnu');
        return;
      }
      try {
        const markdown = await fsp.readFile(doc.file, 'utf8');
        sendJson(res, 200, { id: doc.id, title: doc.title, subtitle: doc.subtitle, markdown });
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 — document introuvable sur le disque');
      }
      return;
    }

    if (pathname === '/api/library') {
      const [tracks, localSamples] = await Promise.all([scanLibrary(), hasLocalSamples()]);
      sendJson(res, 200, {
        tracks,
        localSamples,
        tracksDir: TRACKS_DIR,
      });
      return;
    }

    if (pathname.startsWith('/tracks/')) {
      const filePath = safeJoin(TRACKS_DIR, pathname.slice('/tracks'.length));
      if (!filePath) {
        res.writeHead(403).end('403');
        return;
      }
      await sendFile(req, res, filePath, { cache: 'no-cache' });
      return;
    }

    const rel = pathname === '/' ? '/index.html' : pathname;
    const filePath = safeJoin(WEB_DIR, rel);
    if (!filePath) {
      res.writeHead(403).end('403');
      return;
    }
    const cache = rel.startsWith('/assets/piano/') ? 'public, max-age=604800' : 'no-cache';
    await sendFile(req, res, filePath, { cache });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('500 — erreur interne');
  }
});

// Premier lancement : plutôt qu'un jukebox vide, on écrit quelques morceaux
// de démonstration (générés localement, œuvres du domaine public).
async function seedIfEmpty() {
  const tracks = await scanLibrary();
  if (tracks.length) return null;
  try {
    const written = await writeDemoTracks(TRACKS_DIR);
    return written;
  } catch {
    return null;
  }
}

const seeded = await seedIfEmpty();

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log('');
  console.log('  🎹  Jukebox LEGO Grand Piano');
  console.log('  ────────────────────────────────────────────');
  console.log(`  Ouvre  ${url}  dans Chrome ou Edge.`);
  console.log(`  Morceaux : ${TRACKS_DIR}`);
  if (seeded) console.log(`  (bibliothèque vide : ${seeded.length} morceaux de démonstration y ont été créés)`);
  console.log('');
  console.log('  Le Web Bluetooth exige localhost ou HTTPS — utilise bien');
  console.log('  cette adresse, pas file:// ni l\'IP de la machine.');
  console.log('');
});
