#!/usr/bin/env node
/**
 * Serveur du jukebox LEGO Grand Piano.
 *
 * Aucune dépendance : uniquement les modules natifs de Node.
 * Il fait trois choses :
 *   1. servir le dossier `web/` (l'application) ;
 *   2. exposer `/api/library`, qui inventorie le dossier `tracks/` ;
 *   3. tenir la file d'attente du stand, partagée entre le jukebox et les
 *      téléphones des visiteurs (voir « Salle de commande » plus bas).
 *
 * Par défaut le serveur n'écoute que sur http://localhost — c'est important :
 * le Web Bluetooth n'est disponible que dans un « contexte sécurisé » (HTTPS
 * ou localhost). Le **mode local** l'ouvre en plus au réseau local, pour que
 * les visiteurs atteignent la télécommande depuis leur téléphone : soit dès le
 * lancement avec `--lan` (`npm run stand`), soit à chaud depuis les réglages du
 * jukebox. Le jukebox, lui, reste sur localhost et garde son Bluetooth.
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeStarterLibrary } from './scripts/make-library.mjs';
import { resolveMusicRequest, downloadPreview, downloadArtwork, REQUEST_CATEGORY } from './scripts/music-links.mjs';

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

/**
 * Mode local demandé dès le lancement : le serveur écoute alors sur toutes les
 * interfaces, comme avant. Sans cette option il ne prend que la boucle locale,
 * et le mode local s'allume à chaud depuis les réglages du jukebox — ce qui
 * ouvre une seconde écoute, sur la seule adresse Wi-Fi de la machine.
 *
 * Dans les deux cas la mise en garde est la même : le dossier `tracks/` et
 * toute l'interface deviennent lisibles par le réseau où l'on est branché.
 */
const LAN_AT_START = process.argv.includes('--lan') || process.env.HOST === '0.0.0.0';
const HOST = LAN_AT_START ? '0.0.0.0' : '127.0.0.1';

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
 *   tracks/Classique/Chopin - Nocturne.mid   ← la partition (pilote les touches)
 *   tracks/Classique/Chopin - Nocturne.mp3   ← l'audio (optionnel, remplace le synthé)
 *   tracks/Classique/Chopin - Nocturne.jpg   ← la pochette (optionnelle)
 *
 * Un MP3 seul fonctionne aussi : la chorégraphie est alors déduite en direct
 * du niveau sonore. Un MIDI seul fonctionne aussi : le son est synthétisé.
 *
 * Chaque sous-dossier de `tracks/` est une **catégorie**, repliable dans la
 * page. Les fichiers posés à la racine forment la catégorie « Mes morceaux ».
 * Un seul niveau est exploré : un dossier dans un dossier est ignoré.
 */

/** Catégorie des fichiers laissés à la racine de `tracks/`. */
const ROOT_CATEGORY = 'Mes morceaux';

/**
 * Ordre d'affichage des catégories connues. Toute autre catégorie vient
 * ensuite, par ordre alphabétique, et « Mes morceaux » ferme la marche.
 */
const CATEGORY_ORDER = [REQUEST_CATEGORY, 'Classique', 'Piano', 'Moderne', 'Gaming', 'Réglage'];

/** Où atterrissent les extraits demandés par les visiteurs depuis leur téléphone. */
const REQUESTS_DIR = path.join(TRACKS_DIR, REQUEST_CATEGORY);

function categoryRank(name) {
  if (name === ROOT_CATEGORY) return CATEGORY_ORDER.length + 1;
  const known = CATEGORY_ORDER.indexOf(name);
  return known === -1 ? CATEGORY_ORDER.length : known;
}

/** Inventorie un dossier et renvoie ses morceaux, triés par nom. */
async function scanFolder(dir, category, urlPrefix) {
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
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

  const url = (name) => (name ? urlPrefix + encodeURIComponent(name) : null);
  const tracks = [];
  for (const group of groups.values()) {
    if (!group.midi && !group.audio) continue; // une pochette orpheline n'est pas un morceau

    const { artist, title } = splitName(group.base);
    tracks.push({
      // L'identifiant porte la catégorie : deux morceaux homonymes dans deux
      // dossiers différents restent distincts (et gardent deux pochettes).
      id: `${category}/${group.base}`,
      category,
      title,
      artist,
      midiUrl: url(group.midi),
      audioUrl: url(group.audio),
      coverUrl: url(group.cover),
    });
  }

  tracks.sort((a, b) => a.id.localeCompare(b.id, 'fr', { numeric: true, sensitivity: 'base' }));
  return tracks;
}

/**
 * Parcourt `tracks/` et sa première rangée de sous-dossiers.
 * @returns {Promise<{tracks: object[], categories: {name: string, count: number}[]}>}
 */
async function scanLibrary() {
  let entries = [];
  try {
    entries = await fsp.readdir(TRACKS_DIR, { withFileTypes: true });
  } catch {
    return { tracks: [], categories: [] };
  }

  const folders = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name);

  const scanned = await Promise.all([
    scanFolder(TRACKS_DIR, ROOT_CATEGORY, '/tracks/'),
    ...folders.map((name) => scanFolder(path.join(TRACKS_DIR, name), name, `/tracks/${encodeURIComponent(name)}/`)),
  ]);

  // Un dossier vide reste une catégorie : elle s'affiche, prête à être remplie.
  const counts = new Map(folders.map((name) => [name, 0]));
  for (const list of scanned) {
    if (list.length) counts.set(list[0].category, list.length);
  }
  counts.delete(ROOT_CATEGORY);
  if (scanned[0].length) counts.set(ROOT_CATEGORY, scanned[0].length);

  const categories = [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => categoryRank(a.name) - categoryRank(b.name) || a.name.localeCompare(b.name, 'fr'));

  const order = new Map(categories.map((entry, index) => [entry.name, index]));
  const tracks = scanned
    .flat()
    .sort((a, b) => order.get(a.category) - order.get(b.category) || a.id.localeCompare(b.id, 'fr', { numeric: true, sensitivity: 'base' }));

  return { tracks, categories };
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
/* Salle de commande : la file d'attente du stand                      */
/* ------------------------------------------------------------------ */

/**
 * En journée portes ouvertes, le jukebox tourne sur l'ordinateur relié au
 * piano, et les visiteurs choisissent leur morceau depuis leur téléphone —
 * une page servie par ce même serveur, atteinte en scannant un code QR.
 *
 * Les visiteurs sont en 5G, pas sur le Wi-Fi de la salle : le code QR doit
 * donc porter une adresse **publique**, pas un 192.168.x.x que leur téléphone
 * n'atteindrait jamais. Trois situations, dans cet ordre :
 *
 *   1. `PUBLIC_URL` est déclarée — elle fait foi, quelle que soit la suite ;
 *   2. la requête arrive par un nom de domaine (VPS, éventuellement derrière
 *      un proxy inverse) — on réutilise ce nom, rien à configurer ;
 *   3. `--lan` sans domaine — repli sur l'adresse locale, utile seulement si
 *      les visiteurs partagent le Wi-Fi du stand.
 *
 * Comme la page devient publique, trois garde-fous :
 *   • un **code de stand** transporté par le code QR : sans lui, aucune
 *     demande n'est acceptée. Le visiteur ne le voit jamais, il scanne ;
 *   • un **jeton opérateur** pour tout ce qui pilote le stand (passer au
 *     morceau suivant, vider la file). Sur un serveur purement local sans
 *     proxy, la boucle locale suffit et le jeton n'est pas demandé ;
 *   • une **limitation de débit** par adresse IP.
 *
 * Tout l'état tient en mémoire : fermer le serveur remet le stand à zéro.
 */

/** Adresse publique déclarée à la main, si l'on ne veut rien deviner. */
const PUBLIC_URL = (process.env.PUBLIC_URL ?? '').trim().replace(/\/+$/, '');

/**
 * Alphabet du code de stand : ni O ni 0, ni I ni 1. Le code voyage dans le
 * code QR, mais il arrive qu'on doive le dicter à quelqu'un.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomToken(length, alphabet = CODE_ALPHABET) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/**
 * Les deux jetons survivent au redémarrage du serveur.
 *
 * C'est indispensable dès qu'on tient un stand plusieurs jours : un code tiré
 * au hasard à chaque lancement rendrait caduc le code QR imprimé la veille, et
 * les visiteurs scanneraient un code que le serveur refuse. On les range donc
 * dans un fichier local, ignoré par git. Les variables d'environnement, elles,
 * restent prioritaires — c'est la façon de fixer un code pour de bon.
 */
const SESSION_FILE = path.join(ROOT, '.stand-session.json');

function loadSession() {
  try {
    const saved = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    return {
      code: typeof saved.code === 'string' ? saved.code : null,
      operator: typeof saved.operator === 'string' ? saved.operator : null,
    };
  } catch {
    return { code: null, operator: null };
  }
}

const session = loadSession();

/** Code porté par le code QR. */
const STAND_CODE = (process.env.STAND_CODE ?? '').trim().toUpperCase() || session.code || randomToken(5);
/** Jeton de pilotage, à passer une fois au jukebox : `…/?op=…`. */
const STAND_OPERATOR = (process.env.STAND_OPERATOR ?? '').trim() || session.operator || randomToken(12);

if (session.code !== STAND_CODE || session.operator !== STAND_OPERATOR) {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify({ code: STAND_CODE, operator: STAND_OPERATOR }, null, 2));
  } catch {
    // Disque en lecture seule (conteneur) : on continue avec des jetons du jour.
  }
}

const stand = {
  /** @type {Array<{key:string, id:string, title:string, artist:string|null, by:string, name:string|null, at:number}>} */
  queue: [],
  /** Ce que joue le jukebox, tel qu'il le publie lui-même. */
  now: null,
  /** Historique du jour, pour le bilan de fin de stand. */
  history: [],
  /** Flux SSE ouverts (jukebox et téléphones). */
  clients: new Set(),
  /** Numéro d'ordre, qui incrémente à chaque demande. */
  ticket: 0,
  /** Applaudissements reçus depuis le lancement. */
  cheers: 0,
};

/** Au-delà, la file devient une salle d'attente : on refuse poliment. */
const QUEUE_LIMIT = 40;
/** Demandes simultanées d'un même téléphone : de quoi choisir, pas monopoliser. */
const QUEUE_PER_VISITOR = 3;
/** Taille maximale d'un corps de requête. Rien ici ne dépasse quelques centaines d'octets. */
const BODY_LIMIT = 4096;
/** Un MIDI de conversion dépasse largement la borne JSON : il a la sienne. */
const MIDI_BODY_LIMIT = 2 * 1024 * 1024;
/** Longueur de l'historique conservé. */
const HISTORY_LIMIT = 200;
/** Limitation de débit : requêtes par adresse et par minute. */
const RATE_WINDOW = 60_000;
const RATE_MAX = 40;

/* --- Identité de l'appelant ---------------------------------------- */

/** Adresse du client, en tenant compte d'un éventuel proxy inverse. */
function clientAddress(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress ?? 'inconnu';
}

/** @type {Map<string, {count:number, until:number}>} */
const rateBuckets = new Map();

/**
 * Le serveur est-il ouvert à d'autres appareils que celui qui l'exécute ?
 * Trois façons de l'être : une adresse publique déclarée, l'écoute réseau
 * (`--lan`, ou l'interrupteur des réglages), ou un proxy inverse devant.
 */
function isShared(req) {
  return Boolean(
    PUBLIC_URL ||
      LAN_AT_START ||
      lanServer ||
      req?.headers['x-forwarded-for'] ||
      req?.headers['x-forwarded-host']
  );
}

/**
 * Cadence maximale d'un même visiteur. Deux exemptions, et aucune n'ouvre de
 * brèche :
 *
 *   • tant que le serveur n'écoute que la boucle locale, il n'y a personne
 *     d'autre que soi de l'autre côté : se limiter reviendrait à se limiter
 *     soi-même ;
 *   • le poste du stand publie ce qu'il joue toutes les deux secondes, soit
 *     trente requêtes par minute à lui seul. Comptées avec le reste, elles
 *     épuisaient son propre quota, et trois demandes d'affilée suffisaient à
 *     déclencher le refus. Le jeton de pilotage l'identifie : un visiteur ne
 *     passe pas par là.
 */
function rateLimited(req, body) {
  if (!isShared(req)) return false;
  if (isOperator(req, body)) return false;

  const key = clientAddress(req);
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.until <= now) {
    // Ménage paresseux : une table qui grossit indéfiniment finirait par peser.
    if (rateBuckets.size > 5000) {
      for (const [address, entry] of rateBuckets) if (entry.until <= now) rateBuckets.delete(address);
    }
    rateBuckets.set(key, { count: 1, until: now + RATE_WINDOW });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_MAX;
}

/** Le code du stand, tel que le téléphone l'a reçu par le code QR. */
function hasStandCode(req, url, body) {
  const given = String(body?.code ?? url.searchParams.get('c') ?? '').trim().toUpperCase();
  return given === STAND_CODE;
}

/**
 * Droit de piloter le stand. Le jeton l'accorde toujours ; sinon on ne fait
 * confiance à la boucle locale que si le serveur n'est ni publié ni derrière
 * un proxy — car derrière un proxy inverse, *tout le monde* arrive de 127.0.0.1.
 */
function isOperator(req, body) {
  const given = String(body?.operator ?? req.headers['x-stand-operator'] ?? '');
  if (given && given === STAND_OPERATOR) return true;
  if (PUBLIC_URL || req.headers['x-forwarded-for'] || req.headers['x-forwarded-host']) return false;
  const address = req.socket.remoteAddress ?? '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/* --- Adresse publique ---------------------------------------------- */

/**
 * Adresse de la machine sur le réseau local. On préfère les plages privées
 * habituelles : sur un portable, la première interface venue est souvent un
 * réseau virtuel (Docker, VPN) que personne d'autre n'atteint.
 */
function lanAddress() {
  const candidates = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      const privateRange =
        net.address.startsWith('192.168.') ||
        net.address.startsWith('10.') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(net.address);
      candidates.push({ address: net.address, privateRange });
    }
  }
  candidates.sort((a, b) => Number(b.privateRange) - Number(a.privateRange));
  return candidates[0]?.address ?? null;
}

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/* --- Mode local ------------------------------------------------------ */

/**
 * Le cas le plus fréquent chez soi : l'ordinateur et le téléphone sont sur le
 * même Wi-Fi. Il n'y a alors ni domaine ni tunnel, et il suffit d'ouvrir le
 * serveur sur l'adresse locale de la machine pour que le téléphone atteigne la
 * télécommande.
 *
 * Plutôt que de faire écouter le serveur principal sur toutes les interfaces,
 * on ouvre **une seconde écoute, sur la seule adresse Wi-Fi**. Deux raisons :
 *   • le jukebox garde sa page sur `localhost`, donc son contexte sécurisé et
 *     son Web Bluetooth : rien ne se déconnecte quand on bascule ;
 *   • fermer le mode local referme vraiment la porte, sans redémarrer le
 *     serveur ni couper les flux d'événements en cours.
 */
let lanServer = null;
let lanBound = null;

/** État du mode local, tel que l'interface du jukebox le montre. */
function localMode() {
  const address = lanBound ?? lanAddress();
  return {
    // Démarré avec `--lan`, le serveur écoute déjà partout : le mode est acquis
    // et l'interrupteur n'a plus rien à ouvrir ni à fermer.
    enabled: LAN_AT_START || Boolean(lanServer),
    pinned: LAN_AT_START,
    address,
    port: PORT,
    // Sans adresse privée, la machine n'est sur aucun réseau utilisable.
    supported: Boolean(address),
  };
}

/** Ouvre l'écoute sur le réseau local. Résout avec le nouvel état. */
function openLocalMode() {
  if (LAN_AT_START || lanServer) return Promise.resolve(localMode());
  const address = lanAddress();
  if (!address) return Promise.reject(new Error('aucune adresse réseau locale : vérifie le Wi-Fi.'));

  return new Promise((resolve, reject) => {
    const extra = http.createServer(handleRequest);
    extra.once('error', (error) => {
      extra.close();
      reject(new Error(error.code === 'EADDRINUSE' ? `le port ${PORT} est déjà pris sur ${address}.` : error.message));
    });
    extra.listen(PORT, address, () => {
      lanServer = extra;
      lanBound = address;
      console.log(`  📱  Mode local ouvert : http://${address}:${PORT}/r?c=${STAND_CODE}`);
      resolve(localMode());
    });
  });
}

/** Referme l'écoute réseau. Les connexions déjà ouvertes se terminent seules. */
function closeLocalMode() {
  if (!lanServer) return Promise.resolve(localMode());
  const extra = lanServer;
  lanServer = null;
  lanBound = null;
  return new Promise((resolve) => {
    extra.close(() => {
      console.log('  📱  Mode local refermé.');
      resolve(localMode());
    });
    // Un flux d'événements SSE resterait ouvert indéfiniment : on ne l'attend pas.
    extra.closeAllConnections?.();
  });
}

/** Racine publique du site, vue depuis l'extérieur. */
function publicBase(req) {
  if (PUBLIC_URL) return PUBLIC_URL;

  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim();
  if (host && !LOCAL_HOSTS.test(host)) {
    const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() || 'http';
    return `${proto}://${host}`;
  }

  // Rien qu'un nom local : reste le repli réseau local, si le mode est ouvert.
  const local = localMode();
  if (local.enabled && local.address) return `http://${local.address}:${PORT}`;
  return null;
}

/** Adresse complète à mettre dans le code QR, code de stand compris. */
function remoteUrl(req) {
  const base = publicBase(req);
  return base ? `${base}/r?c=${STAND_CODE}` : null;
}

/* --- État partagé --------------------------------------------------- */

/**
 * Index des morceaux, rafraîchi paresseusement : une demande venue d'un
 * téléphone doit désigner un morceau qui existe vraiment.
 */
let libraryCache = { at: 0, tracks: new Map() };

/** À appeler dès qu'un fichier apparaît dans `tracks/` : le cache a vieilli d'un coup. */
function forgetLibrary() {
  libraryCache = { at: 0, tracks: new Map() };
}

async function libraryIndex() {
  if (Date.now() - libraryCache.at < 3000 && libraryCache.tracks.size) return libraryCache.tracks;
  const { tracks } = await scanLibrary();
  libraryCache = { at: Date.now(), tracks: new Map(tracks.map((track) => [track.id, track])) };
  return libraryCache.tracks;
}

/** Instantané envoyé aux deux bouts : la file, ce qui joue, le bilan. */
function standState() {
  return {
    queue: stand.queue,
    now: stand.now,
    played: stand.history.length,
    requested: stand.history.filter((entry) => entry.requested).length,
    cheers: stand.cheers,
  };
}

/** Pousse un événement nommé à tous les flux ouverts. */
function broadcast(event, payload) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of stand.clients) {
    try {
      client.write(frame);
    } catch {
      stand.clients.delete(client);
    }
  }
}

const broadcastState = () => broadcast('state', standState());

/**
 * Nombre de flux d'événements ouverts en même temps. Sur un salon, chaque
 * téléphone qui laisse la page ouverte en tient un : le plafond évite qu'un
 * hall entier finisse par épuiser les descripteurs du serveur.
 */
const STREAM_LIMIT = 400;

/** Ouvre un flux d'événements et y pousse l'état courant. */
function openEventStream(req, res) {
  if (stand.clients.size >= STREAM_LIMIT) {
    // Refus explicite : la page se rabattra sur ce qu'elle sait déjà.
    sendJson(res, 503, { error: 'Trop de connexions ouvertes. Réessaie dans un instant.' });
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    // Un proxy inverse qui met en tampon casserait le direct : on le lui interdit.
    'x-accel-buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  res.write(`event: state\ndata: ${JSON.stringify(standState())}\n\n`);
  stand.clients.add(res);

  // Un commentaire toutes les 20 s : de quoi traverser les coupures silencieuses
  // d'un réseau mobile, et empêcher un proxy de fermer une connexion inactive.
  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(keepAlive);
    }
  }, 20_000);

  const close = () => {
    clearInterval(keepAlive);
    stand.clients.delete(res);
  };
  req.on('close', close);
  res.on('close', close);
}

/** Lit un corps JSON, borné en taille. Renvoie `null` si le corps est illisible. */
function readJsonBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

/** Jeton de visiteur : au pire l'adresse, pour que le plafond reste utile. */
function visitorKey(req, body) {
  const claimed = typeof body?.by === 'string' ? body.by.slice(0, 40) : '';
  return claimed || `ip:${clientAddress(req)}`;
}

/**
 * Prénom facultatif, affiché sur l'écran du stand quand le morceau passe.
 *
 * C'est du texte saisi par le public et montré à toute la salle : on ne garde
 * que des lettres, on plafonne à quatorze caractères, et l'écran peut de toute
 * façon cesser d'afficher les prénoms d'un seul réglage.
 */
function cleanName(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .normalize('NFC')
    // Une balise entière disparaît d'un bloc : ne retirer que les chevrons
    // laisserait « <b>x</b> » devenir « bxb », ce qui n'a plus de sens.
    .replace(/<[^>]*>?/g, ' ')
    .replace(/[^\p{L}\p{M}\s'’-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14)
    // La coupe peut tomber au milieu d'un nom composé : on retaille après.
    .trim();
  return cleaned.length >= 2 ? cleaned : null;
}

/* --- Routage des écritures ------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Transcription audio → notes (moteur rapide, optionnel)              */
/*                                                                     */
/* Si l'environnement Python est installé, le serveur transcrit à la   */
/* place du navigateur : même réseau, mais dix à quinze fois plus vite.*/
/* Sinon il le dit, et la page se rabat sur sa propre version.         */
/* ------------------------------------------------------------------ */

const VENV_PYTHON = path.join(
  ROOT,
  '.venv-transcriber',
  process.platform === 'win32' ? 'Scripts' : 'bin',
  process.platform === 'win32' ? 'python.exe' : 'python'
);
const TRANSCRIBE_SCRIPT = path.join(ROOT, 'scripts', 'transcribe.py');
/** Un extrait de trente secondes en mono 22 kHz pèse moins de 2 Mo. */
const AUDIO_BODY_LIMIT = 32 * 1024 * 1024;

/** Lance le pont Python et renvoie ce qu'il a écrit sur la sortie standard. */
function runPython(args) {
  return new Promise((resolve) => {
    const child = spawn(VENV_PYTHON, [TRANSCRIBE_SCRIPT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', (error) => resolve({ code: -1, out: '', err: error.message }));
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

/** Ce que la machine sait faire, relu une fois puis gardé en mémoire. */
let engineInfo = null;
async function describeEngine() {
  if (engineInfo) return engineInfo;
  const exists = await fsp.access(VENV_PYTHON).then(() => true, () => false);
  if (!exists) {
    engineInfo = { available: false, reason: 'environnement Python absent' };
    return engineInfo;
  }
  const { code, out } = await runPython(['--describe']);
  try {
    const info = JSON.parse(out);
    engineInfo = {
      available: code === 0 && info.installed.length > 0,
      backend: info.installed[0] ?? null,
      system: info.system,
      machine: info.machine,
      python: info.python,
    };
  } catch {
    engineInfo = { available: false, reason: 'le moteur n’a pas su se décrire' };
  }
  return engineInfo;
}

/**
 * POST /api/transcribe — le corps est un WAV mono 22 050 Hz, déjà découpé par
 * le navigateur. On ne fait que le passer au réseau et rendre les notes.
 */
async function handleTranscribe(req, res) {
  const engine = await describeEngine();
  if (!engine.available) {
    sendJson(res, 503, { error: 'Moteur rapide indisponible.', ...engine });
    return;
  }

  const body = await readRawBody(req, AUDIO_BODY_LIMIT);
  if (!body || body.length < 44 || body.subarray(0, 4).toString('latin1') !== 'RIFF') {
    sendJson(res, 400, { error: 'Le corps attendu est un fichier WAV.' });
    return;
  }

  const scratch = path.join(os.tmpdir(), `jukebox-${Date.now()}-${process.pid}.wav`);
  try {
    await fsp.writeFile(scratch, body);
    const { code, out, err } = await runPython([scratch]);
    if (code !== 0) {
      sendJson(res, 500, { error: 'La transcription a échoué.', detail: err.slice(-400) });
      return;
    }
    const payload = JSON.parse(out);
    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  } finally {
    await fsp.unlink(scratch).catch(() => {});
  }
}

/** Lit un corps binaire, borné en taille. Renvoie `null` s'il déborde. */
function readRawBody(req, limit) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });
}

/**
 * Un nom de fichier ou de dossier accepté dans `tracks/` : un seul segment,
 * sans séparateur ni caractère de contrôle, et qui ne commence pas par un
 * point (ces entrées sont ignorées par l'inventaire).
 */
function safeSegment(value, maxLength) {
  const name = String(value ?? '').trim();
  if (!name || name.length > maxLength) return null;
  if (name === '.' || name === '..' || name.startsWith('.')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\\/\u0000-\u001f]/.test(name)) return null;
  return name;
}

/**
 * Enregistre un MIDI produit par le convertisseur MP3 dans
 * `tracks/<catégorie>/<nom>.mid`.
 *
 * POST /api/tracks?category=…&name=…[&overwrite=1]
 * Corps : les octets du fichier MIDI.
 */
/**
 * Met un morceau dans la file, avec les garde-fous du stand : file plafonnée,
 * trois demandes par téléphone, pas de doublon.
 *
 * @returns {{entry:object}|{error:string, status:number}}
 */
function enqueue(track, by, name) {
  if (stand.queue.length >= QUEUE_LIMIT) {
    return { error: 'La file est pleine. Reviens dans quelques minutes.', status: 429 };
  }
  if (stand.queue.filter((entry) => entry.by === by).length >= QUEUE_PER_VISITOR) {
    return { error: `Tu as déjà ${QUEUE_PER_VISITOR} morceaux en attente. Laisse-les passer !`, status: 429 };
  }
  if (stand.queue.some((entry) => entry.id === track.id)) {
    return { error: 'Ce morceau est déjà dans la file.', status: 409 };
  }

  stand.ticket += 1;
  const entry = {
    key: `q${stand.ticket}`,
    id: track.id,
    title: track.title,
    artist: track.artist,
    category: track.category,
    // Un extrait fraîchement téléchargé n'a pas encore de partition : le
    // jukebox saura qu'il doit le transcrire avant de le jouer.
    transcribe: Boolean(track.transcribe),
    source: track.source ?? null,
    name,
    by,
    at: Date.now(),
  };
  stand.queue.push(entry);
  broadcastState();
  return { entry };
}

/* --- Demande par lien ------------------------------------------------ */

/** Au-delà, le dossier des demandes déborde : on arrête d'accepter. */
const REQUEST_FILE_LIMIT = 200;

/**
 * Un visiteur a collé un lien Spotify, Apple Music ou Deezer — ou juste un
 * titre. On le résout en extrait officiel de trente secondes, on écrit
 * l'extrait dans `tracks/Demandes/`, et on met le morceau dans la file. La
 * transcription en partition, elle, se fait dans le navigateur du jukebox :
 * c'est lui qui a le moteur et la puissance de calcul.
 */
async function handleLinkRequest(req, res, body) {
  let resolved;
  try {
    resolved = await resolveMusicRequest(body.link);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }

  let existing = 0;
  try {
    existing = (await fsp.readdir(REQUESTS_DIR)).length;
  } catch { /* le dossier n'existe pas encore */ }
  if (existing > REQUEST_FILE_LIMIT) {
    sendJson(res, 507, { error: 'Le dossier des demandes est plein. Préviens l’équipe du stand.' });
    return;
  }

  let saved;
  try {
    saved = await downloadPreview(resolved.previewUrl, resolved.artist, resolved.title, REQUESTS_DIR);
  } catch (error) {
    sendJson(res, 502, { error: error.message });
    return;
  }
  // La pochette suit l'extrait, sous le même nom de base : c'est ce qui la
  // relie au morceau. Elle n'est qu'un agrément — si elle manque, le jukebox
  // affiche la couleur tirée du titre, et la demande passe quand même.
  const cover = await downloadArtwork(resolved.artwork, saved.base, REQUESTS_DIR);
  forgetLibrary();

  const id = `${REQUEST_CATEGORY}/${saved.base}`;
  // Le même extrait peut déjà avoir été transcrit plus tôt dans la journée.
  const tracks = await libraryIndex();
  const known = tracks.get(id);

  const outcome = enqueue(
    {
      id,
      title: resolved.title,
      artist: resolved.artist,
      category: REQUEST_CATEGORY,
      transcribe: !known?.midiUrl,
      source: resolved.source,
    },
    visitorKey(req, body),
    cleanName(body.name)
  );
  if (outcome.error) {
    sendJson(res, outcome.status, { error: outcome.error });
    return;
  }

  sendJson(res, 200, {
    entry: outcome.entry,
    position: stand.queue.length,
    resolved: {
      title: resolved.title,
      artist: resolved.artist,
      source: resolved.source,
      cover: Boolean(cover),
    },
    ...standState(),
  });
}

async function handleTrackUpload(req, res, url) {
  // Cette route écrit dans `tracks/`. Tant que le serveur ne sortait pas de
  // localhost, c'était sans conséquence ; publié sur un domaine, c'est une
  // porte ouverte sur le disque. Elle est donc réservée au poste du stand.
  if (!isOperator(req, {})) {
    sendJson(res, 403, { error: 'Écriture réservée au poste du stand.' });
    return;
  }
  if (rateLimited(req)) {
    sendJson(res, 429, { error: 'Trop d’envois d’un coup.' });
    return;
  }

  const category = safeSegment(url.searchParams.get('category'), 60);
  const name = safeSegment(url.searchParams.get('name'), 120);
  if (!category || !name) {
    sendJson(res, 400, { error: 'Nom ou catégorie invalide.' });
    return;
  }

  const body = await readRawBody(req, MIDI_BODY_LIMIT);
  if (!body) {
    sendJson(res, 413, { error: 'Fichier trop volumineux (2 Mo maximum).' });
    return;
  }
  // On n'écrit dans la bibliothèque que ce qui est réellement un MIDI.
  if (body.length < 4 || body.subarray(0, 4).toString('latin1') !== 'MThd') {
    sendJson(res, 400, { error: 'Le corps de la requête n’est pas un fichier MIDI.' });
    return;
  }

  const dir = safeJoin(TRACKS_DIR, '/' + category);
  const filePath = dir && safeJoin(TRACKS_DIR, `/${category}/${name}.mid`);
  if (!dir || !filePath) {
    sendJson(res, 400, { error: 'Chemin refusé.' });
    return;
  }

  const exists = await fsp.access(filePath).then(() => true, () => false);
  if (exists && url.searchParams.get('overwrite') !== '1') {
    sendJson(res, 409, { error: 'Un morceau porte déjà ce nom dans cette catégorie.' });
    return;
  }

  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(filePath, body);
  forgetLibrary(); // la bibliothèque vient de changer sous nos pieds
  sendJson(res, 201, {
    category,
    name,
    id: `${category}/${name}`,
    bytes: body.length,
    replaced: exists,
  });
}

/**
 * Supprime un morceau arrivé par un lien de plateforme.
 *
 * DELETE /api/tracks?category=Demandes&name=…
 *
 * Deux verrous, et aucun n'est de trop pour une route qui efface des fichiers :
 * le poste du stand seul y a droit, et seule la catégorie des demandes est
 * concernée. Le reste de `tracks/` est le fonds de la bibliothèque, déposé à la
 * main : il ne s'efface pas depuis un navigateur.
 */
async function handleTrackDelete(req, res, url) {
  if (!isOperator(req, {})) {
    sendJson(res, 403, { error: 'Suppression réservée au poste du stand.' });
    return;
  }
  if (rateLimited(req)) {
    sendJson(res, 429, { error: 'Trop de suppressions d’un coup.' });
    return;
  }

  const category = safeSegment(url.searchParams.get('category'), 60);
  const name = safeSegment(url.searchParams.get('name'), 120);
  if (!category || !name) {
    sendJson(res, 400, { error: 'Nom ou catégorie invalide.' });
    return;
  }
  if (category !== REQUEST_CATEGORY) {
    sendJson(res, 403, { error: `Seuls les morceaux de « ${REQUEST_CATEGORY} » se suppriment d’ici.` });
    return;
  }

  const dir = safeJoin(TRACKS_DIR, '/' + category);
  if (!dir) {
    sendJson(res, 400, { error: 'Chemin refusé.' });
    return;
  }

  let entries = [];
  try {
    entries = await fsp.readdir(dir);
  } catch { /* le dossier n'existe plus : il n'y a rien à supprimer */ }

  // Un morceau, ce n'est pas un fichier mais un groupe de fichiers portant le
  // même nom de base : la partition, l'extrait, parfois une pochette. On les
  // enlève ensemble, sans quoi la bibliothèque garderait un demi-morceau.
  const removable = entries.filter((entry) => {
    const ext = path.extname(entry).toLowerCase();
    if (!MIDI_EXT.has(ext) && !AUDIO_EXT.has(ext) && !COVER_EXT.has(ext)) return false;
    return entry.slice(0, -ext.length) === name;
  });
  if (!removable.length) {
    sendJson(res, 404, { error: 'Ce morceau n’est plus dans la bibliothèque.' });
    return;
  }

  const removed = [];
  for (const entry of removable) {
    const filePath = safeJoin(TRACKS_DIR, `/${category}/${entry}`);
    if (!filePath) continue;
    await fsp.unlink(filePath);
    removed.push(entry);
  }
  forgetLibrary();

  // Le morceau pouvait encore attendre son tour : le laisser dans la file
  // enverrait le jukebox chercher un fichier disparu.
  const id = `${category}/${name}`;
  const before = stand.queue.length;
  stand.queue = stand.queue.filter((entry) => entry.id !== id);
  if (stand.queue.length !== before) broadcastState();

  sendJson(res, 200, { id, removed, dequeued: before - stand.queue.length });
}

async function handleStandPost(req, res, pathname, url) {
  const body = await readJsonBody(req);
  if (body === null) {
    sendJson(res, 400, { error: 'Requête illisible.' });
    return;
  }

  // Le corps est lu d'abord : le jeton de pilotage peut y être, et c'est lui
  // qui dit si l'appelant est le poste du stand ou un visiteur. La lecture est
  // bornée à quelques kilo-octets, elle ne coûte rien.
  if (rateLimited(req, body)) {
    sendJson(res, 429, { error: 'Trop de demandes d’un coup. Respire, et réessaie dans un instant.' });
    return;
  }

  /* --- Ce qu'un visiteur a le droit de faire --- */

  if (pathname === '/api/stand/queue' || pathname === '/api/stand/cheer' || pathname === '/api/stand/link') {
    if (!hasStandCode(req, url, body) && !isOperator(req, body)) {
      sendJson(res, 403, { error: 'Code du stand absent ou périmé. Rescanne le code QR affiché près du piano.' });
      return;
    }
  }

  if (pathname === '/api/stand/link') {
    await handleLinkRequest(req, res, body);
    return;
  }

  if (pathname === '/api/stand/cheer') {
    stand.cheers += 1;
    broadcast('cheer', { total: stand.cheers, at: Date.now() });
    sendJson(res, 200, { total: stand.cheers });
    return;
  }

  if (pathname === '/api/stand/queue') {
    const tracks = await libraryIndex();
    const track = tracks.get(String(body.id ?? ''));
    if (!track) {
      sendJson(res, 404, { error: 'Ce morceau n’est pas (ou plus) dans la bibliothèque.' });
      return;
    }
    const outcome = enqueue(track, visitorKey(req, body), cleanName(body.name));
    if (outcome.error) {
      sendJson(res, outcome.status, { error: outcome.error });
      return;
    }
    sendJson(res, 200, { entry: outcome.entry, position: stand.queue.length, ...standState() });
    return;
  }

  /* --- Ce qui pilote le stand : réservé au jukebox --- */

  if (!isOperator(req, body)) {
    sendJson(res, 403, { error: 'Pilotage réservé au poste du stand.' });
    return;
  }

  /**
   * L'interrupteur « Mode local » des réglages. Réservé au poste du stand :
   * personne d'autre ne doit pouvoir ouvrir la machine sur le réseau.
   */
  if (pathname === '/api/stand/local') {
    const wanted = Boolean(body.enabled);
    try {
      const state = wanted ? await openLocalMode() : await closeLocalMode();
      sendJson(res, 200, { local: state, remoteUrl: remoteUrl(req), code: STAND_CODE });
    } catch (error) {
      sendJson(res, 409, { error: `Impossible d’ouvrir le mode local : ${error.message}`, local: localMode() });
    }
    return;
  }

  if (pathname === '/api/stand/queue/next') {
    const entry = stand.queue.shift() ?? null;
    if (entry) broadcastState();
    sendJson(res, 200, { entry, ...standState() });
    return;
  }

  if (pathname === '/api/stand/queue/drop') {
    const before = stand.queue.length;
    const key = String(body.key ?? '');
    stand.queue = key === '*' ? [] : stand.queue.filter((entry) => entry.key !== key);
    if (stand.queue.length !== before) broadcastState();
    sendJson(res, 200, standState());
    return;
  }

  if (pathname === '/api/stand/now') {
    const now = body.now && typeof body.now === 'object' ? body.now : null;
    const changed = Boolean(now?.id) && now.id !== stand.now?.id;
    stand.now = now
      ? {
          id: String(now.id).slice(0, 300),
          title: String(now.title ?? '').slice(0, 200),
          artist: now.artist ? String(now.artist).slice(0, 200) : null,
          state: now.state === 'playing' ? 'playing' : 'paused',
          position: Number(now.position) || 0,
          duration: Number(now.duration) || 0,
          requested: Boolean(now.requested),
          name: cleanName(now.name),
          // Secondes restantes d'une pause de service, telles que le jukebox
          // les a comptées. Bornées : c'est une valeur qui vient d'un client.
          rest: Math.max(0, Math.min(600, Number(now.rest) || 0)),
        }
      : null;
    if (changed) {
      stand.history.push({ id: stand.now.id, title: stand.now.title, requested: stand.now.requested, at: Date.now() });
      if (stand.history.length > HISTORY_LIMIT) stand.history.shift();
    }
    broadcastState();
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: 'Route inconnue.' });
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

/**
 * Le routeur, isolé dans une fonction nommée : la seconde écoute du mode local
 * sert exactement le même site, par le même chemin de code.
 */
async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  // Le stand est la seule partie du serveur qui accepte d'être écrite :
  // ajouter un morceau à la file, publier ce qui joue. Tout le reste est
  // en lecture seule, y compris quand le serveur est ouvert au réseau local.
  if (req.method === 'POST') {
    if (pathname === '/api/transcribe') {
      try {
        await handleTranscribe(req, res);
      } catch (error) {
        console.error(error);
        if (!res.headersSent) sendJson(res, 500, { error: 'Erreur interne.' });
      }
      return;
    }
    if (pathname === '/api/tracks') {
      try {
        await handleTrackUpload(req, res, url);
      } catch (error) {
        console.error(error);
        if (!res.headersSent) sendJson(res, 500, { error: 'Erreur interne.' });
      }
      return;
    }
    if (pathname.startsWith('/api/stand/')) {
      try {
        await handleStandPost(req, res, pathname, url);
      } catch (error) {
        console.error(error);
        if (!res.headersSent) sendJson(res, 500, { error: 'Erreur interne.' });
      }
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 — route inconnue');
    return;
  }

  if (req.method === 'DELETE' && pathname === '/api/tracks') {
    try {
      await handleTrackDelete(req, res, url);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) sendJson(res, 500, { error: 'Erreur interne.' });
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD, POST, DELETE' });
    res.end();
    return;
  }

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

    if (pathname === '/api/stand') {
      const url2 = remoteUrl(req);
      sendJson(res, 200, {
        remoteUrl: url2,
        code: STAND_CODE,
        local: localMode(),
        // Le jukebox est-il reconnu comme poste de pilotage ? Sinon il lui
        // manque le jeton, et l'interface le dira au lieu d'échouer en silence.
        operator: isOperator(req, {}),
        ...standState(),
      });
      return;
    }

    if (pathname === '/api/stand/events') {
      openEventStream(req, res);
      return;
    }

    // La télécommande des visiteurs, sous une adresse courte : c'est elle qui
    // se retrouve dans le code QR, et une adresse courte fait un code plus lisible.
    if (pathname === '/r' || pathname === '/r/') {
      await sendFile(req, res, path.join(WEB_DIR, 'remote.html'), { cache: 'no-cache' });
      return;
    }

    // Le chevalet à imprimer et à poser près du piano.
    if (pathname === '/print') {
      await sendFile(req, res, path.join(WEB_DIR, 'print.html'), { cache: 'no-cache' });
      return;
    }

    if (pathname === '/api/transcribe') {
      sendJson(res, 200, await describeEngine());
      return;
    }
    if (pathname === '/api/library') {
      const [library, localSamples] = await Promise.all([scanLibrary(), hasLocalSamples()]);
      sendJson(res, 200, {
        tracks: library.tracks,
        categories: library.categories,
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
}

const server = http.createServer(handleRequest);

// Premier lancement : plutôt qu'un jukebox vide, on écrit la bibliothèque
// de départ (générée localement, à partir des partitions de `scripts/scores/`).
async function seedIfEmpty() {
  const { tracks } = await scanLibrary();
  if (tracks.length) return null;
  try {
    return await writeStarterLibrary(TRACKS_DIR);
  } catch {
    return null;
  }
}

const seeded = await seedIfEmpty();

server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log('');
  console.log('  🎹  Jukebox LEGO Grand Piano');
  console.log('  ────────────────────────────────────────────');
  console.log(`  Ouvre  ${url}  dans Chrome ou Edge.`);
  console.log(`  Morceaux : ${TRACKS_DIR}`);
  if (seeded) console.log(`  (bibliothèque vide : ${seeded.length} morceaux y ont été écrits)`);
  console.log('');
  console.log('  Le Web Bluetooth exige localhost ou HTTPS — utilise bien');
  console.log('  cette adresse, pas file:// ni l\'IP de la machine.');
  console.log('');

  console.log('  📱  Télécommande des visiteurs');
  if (PUBLIC_URL) {
    console.log(`      ${PUBLIC_URL}/r?c=${STAND_CODE}`);
  } else if (LAN_AT_START) {
    const address = lanAddress();
    console.log(`      http://${address ?? '???'}:${PORT}/r?c=${STAND_CODE}   (réseau local)`);
    console.log('      Les visiteurs en 5G n’atteindront PAS cette adresse.');
    console.log('      Pour un stand : déclare PUBLIC_URL, ou sers le site');
    console.log('      derrière un nom de domaine (VPS, tunnel).');
  } else {
    console.log('      Éteinte, pour l’instant : le serveur n’écoute que sur localhost.');
    const address = lanAddress();
    if (address) {
      console.log(`      • même Wi-Fi que le téléphone : coche « Mode local » dans les`);
      console.log(`        réglages du jukebox, et le code QR mènera à ${address}:${PORT} ;`);
    }
    console.log('      • sur un VPS : le nom de domaine suffit, rien à régler ;');
    console.log('      • visiteurs en 5G : PUBLIC_URL=https://… npm start');
    console.log('        derrière un tunnel (cloudflared, ngrok…).');
  }
  console.log(`      Code du stand : ${STAND_CODE}   (déjà inclus dans le code QR)`);
  console.log(`      Jeton de pilotage : ${STAND_OPERATOR}`);
  console.log(`      Depuis une autre machine que le serveur, ouvre le jukebox avec  ?op=${STAND_OPERATOR}`);
  console.log('');
});
