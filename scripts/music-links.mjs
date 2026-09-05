/**
 * « Colle un lien Spotify » → un extrait jouable dans le jukebox.
 *
 * Ce que ce module fait, et surtout ce qu'il ne fait pas
 * ------------------------------------------------------
 * Aucune plateforme de streaming ne laisse récupérer un morceau entier : le
 * catalogue est protégé, et les conditions d'utilisation l'interdisent
 * explicitement. Contourner cela n'est pas une option, et n'aurait pas sa
 * place sur le stand d'une école.
 *
 * Ce qui est en revanche public, gratuit, sans clé d'API et prévu pour cet
 * usage, c'est **l'extrait officiel de trente secondes** que les plateformes
 * publient elles-mêmes pour être écoutées avant achat ou abonnement. C'est
 * cet extrait que l'on récupère, et lui seul.
 *
 * Le chemin est donc toujours le même :
 *
 *   lien collé ──► titre + artiste ──► extrait officiel 30 s ──► fichier local
 *                  (oEmbed, API      (recherche iTunes,        (tracks/Demandes)
 *                   publiques)        repli Deezer)
 *
 * Un texte libre (« Chopin nocturne ») fonctionne aussi : sur un stand, tout
 * le monde n'a pas un lien sous la main.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';

/** Au-delà, on considère que la plateforme ne répondra pas. */
const LOOKUP_TIMEOUT = 6000;
/** Un extrait de trente secondes pèse ~500 Ko ; au-delà, ce n'est pas un extrait. */
const PREVIEW_LIMIT = 4 * 1024 * 1024;
/** Une pochette de 600 px pèse ~100 Ko ; au-delà, ce n'est plus une vignette. */
const ARTWORK_LIMIT = 3 * 1024 * 1024;
/** Les plateformes refusent les requêtes sans identification lisible. */
const USER_AGENT = 'lego-piano-jukebox/1.0 (+demonstration pedagogique)';

/** Dossier où atterrissent les demandes des visiteurs. */
export const REQUEST_CATEGORY = 'Demandes';

/* ------------------------------------------------------------------ */
/* Lecture du lien                                                     */
/* ------------------------------------------------------------------ */

/**
 * Reconnaît la plateforme et l'identifiant du morceau.
 * @returns {{provider:string, id:string|null, url:string}|null}
 */
export function readLink(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;

  let url;
  try {
    url = new URL(text);
  } catch {
    return null; // ce n'est pas un lien : ce sera traité comme une recherche
  }

  const host = url.hostname.replace(/^www\./, '');

  // Spotify — « /intl-fr/track/<id> » aussi bien que « /track/<id> ».
  if (host === 'open.spotify.com' || host === 'spotify.link') {
    const match = /\/track\/([A-Za-z0-9]+)/.exec(url.pathname);
    return { provider: 'spotify', id: match?.[1] ?? null, url: url.href };
  }

  // Apple Music — l'identifiant du morceau est dans « ?i= », ou dans le chemin.
  if (host === 'music.apple.com' || host === 'itunes.apple.com') {
    const fromQuery = url.searchParams.get('i');
    const fromPath = /\/song\/[^/]+\/(\d+)/.exec(url.pathname)?.[1] ?? null;
    return { provider: 'apple', id: fromQuery ?? fromPath, url: url.href };
  }

  if (host === 'deezer.com' || host === 'dzr.page.link') {
    const match = /\/track\/(\d+)/.exec(url.pathname);
    return { provider: 'deezer', id: match?.[1] ?? null, url: url.href };
  }

  return { provider: 'inconnu', id: null, url: url.href };
}

/** Requête HTTP courte, qui ne lève jamais : `null` en cas d'échec. */
async function getJson(url) {
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function getText(url) {
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT),
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Titre et artiste                                                    */
/* ------------------------------------------------------------------ */

const decodeEntities = (text) =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, '’')
    .replace(/&nbsp;/g, ' ');

const metaContent = (html, property) => {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`,
    'i'
  );
  const direct = pattern.exec(html);
  if (direct) return decodeEntities(direct[1]);
  // Certaines pages écrivent l'attribut « content » avant « property ».
  const reversed = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`,
    'i'
  ).exec(html);
  return reversed ? decodeEntities(reversed[1]) : null;
};

/**
 * Spotify ne publie pas d'API sans clé, mais ses pages portent les balises
 * Open Graph que tous les réseaux sociaux lisent. On s'en sert de la même
 * façon : le titre du morceau, puis l'artiste, glané dans la description.
 */
async function describeSpotify(link) {
  const oembed = await getJson(`https://open.spotify.com/oembed?url=${encodeURIComponent(link.url)}`);
  const html = await getText(link.url);

  const title = metaContent(html ?? '', 'og:title') ?? oembed?.title ?? null;
  let artist = null;

  // « Artiste · Chanson · 2019 », la forme la plus courante de la description.
  const description = metaContent(html ?? '', 'og:description') ?? '';
  const parts = description.split('·').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) artist = parts[0].replace(/^(Listen to|Écoute[rz]?)\s+/i, '');
  // « Chanson - song and lyrics by Artiste | Spotify »
  if (!artist) artist = /(?:song and lyrics by|chanson de)\s+([^|]+)/i.exec(html ?? '')?.[1]?.trim() ?? null;

  return title ? { title, artist, artwork: oembed?.thumbnail_url ?? null } : null;
}

/** Apple Music : l'API de recherche d'iTunes répond directement, extrait compris. */
async function describeApple(link) {
  if (link.id) {
    const data = await getJson(`https://itunes.apple.com/lookup?id=${encodeURIComponent(link.id)}`);
    const result = data?.results?.find((entry) => entry.kind === 'song') ?? data?.results?.[0];
    if (result?.trackName) {
      return {
        title: result.trackName,
        artist: result.artistName ?? null,
        artwork: result.artworkUrl100 ?? null,
        previewUrl: result.previewUrl ?? null,
      };
    }
  }
  // Lien d'album sans morceau précis, ou identifiant illisible : on retombe
  // sur les balises de la page.
  const html = await getText(link.url);
  const title = metaContent(html ?? '', 'og:title');
  return title ? { title: title.replace(/\s*[-–—]\s*(Song|Chanson).*$/i, '').trim(), artist: null, artwork: null } : null;
}

/** Deezer publie une API ouverte, extrait compris. */
async function describeDeezer(link) {
  if (!link.id) return null;
  const data = await getJson(`https://api.deezer.com/track/${encodeURIComponent(link.id)}`);
  if (!data?.title) return null;
  return {
    title: data.title,
    artist: data.artist?.name ?? null,
    artwork: data.album?.cover_big ?? data.album?.cover_medium ?? null,
    previewUrl: data.preview ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Extrait officiel                                                    */
/* ------------------------------------------------------------------ */

/**
 * Cherche l'extrait de trente secondes correspondant à un titre.
 * iTunes d'abord — son catalogue est le plus large —, Deezer en second.
 */
async function findPreview(title, artist) {
  const term = [artist, title].filter(Boolean).join(' ');

  const itunes = await getJson(
    `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=5`
  );
  const song = itunes?.results?.find((entry) => entry.previewUrl);
  if (song) {
    return {
      previewUrl: song.previewUrl,
      title: song.trackName ?? title,
      artist: song.artistName ?? artist,
      artwork: song.artworkUrl100 ?? null,
      source: 'Apple Music',
    };
  }

  const deezer = await getJson(`https://api.deezer.com/search?q=${encodeURIComponent(term)}&limit=5`);
  const found = deezer?.data?.find((entry) => entry.preview);
  if (found) {
    return {
      previewUrl: found.preview,
      title: found.title ?? title,
      artist: found.artist?.name ?? artist,
      artwork: found.album?.cover_big ?? found.album?.cover_medium ?? null,
      source: 'Deezer',
    };
  }

  return null;
}

/**
 * Résout ce qu'un visiteur a collé : un lien de plateforme, ou du texte libre.
 *
 * @param {string} input
 * @returns {Promise<{title:string, artist:string|null, previewUrl:string, source:string, artwork:string|null}>}
 * @throws {Error} avec un message destiné à être affiché tel quel au visiteur
 */
export async function resolveMusicRequest(input) {
  const text = String(input ?? '').trim();
  if (text.length < 2) throw new Error('Colle un lien Spotify, Apple Music ou Deezer — ou juste un titre.');
  if (text.length > 400) throw new Error('C’est un peu long pour un lien.');

  const link = readLink(text);
  let described = null;

  if (link?.provider === 'spotify') described = await describeSpotify(link);
  else if (link?.provider === 'apple') described = await describeApple(link);
  else if (link?.provider === 'deezer') described = await describeDeezer(link);
  else if (link?.provider === 'inconnu') {
    throw new Error('Plateforme non reconnue. Un lien Spotify, Apple Music ou Deezer, ou simplement « artiste — titre ».');
  }

  // Pas un lien : le texte est la recherche.
  const title = described?.title ?? text;
  const artist = described?.artist ?? null;

  if (link && !described) {
    throw new Error('Ce lien n’a rien donné. Réessaie, ou tape simplement « artiste — titre ».');
  }

  // Certaines plateformes donnent déjà l'extrait ; sinon on le cherche.
  if (described?.previewUrl) {
    return {
      title,
      artist,
      previewUrl: described.previewUrl,
      artwork: described.artwork ?? null,
      source: link.provider === 'deezer' ? 'Deezer' : 'Apple Music',
    };
  }

  const preview = await findPreview(title, artist);
  if (!preview) {
    throw new Error(
      `Aucun extrait officiel trouvé pour « ${title} ». Certains morceaux n’en publient pas.`
    );
  }
  return { ...preview, artwork: preview.artwork ?? described?.artwork ?? null };
}

/* ------------------------------------------------------------------ */
/* Enregistrement local                                                */
/* ------------------------------------------------------------------ */

/**
 * iTunes ne publie dans ses réponses qu'une vignette de 100 pixels, alors que
 * le même fichier existe en 600 : la taille est écrite dans l'adresse, et il
 * suffit de la demander. Une adresse d'une autre forme ressort inchangée.
 */
export function bigArtwork(url) {
  if (!url) return null;
  return String(url).replace(/\/\d{2,4}x\d{2,4}([a-z-]*)\.(jpg|jpeg|png)$/i, '/600x600$1.$2');
}

/** Les seules images qu'on accepte d'écrire, avec leur signature de début. */
const ARTWORK_KINDS = [
  { extension: '.jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { extension: '.png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  {
    extension: '.webp',
    test: (b) =>
      String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF' &&
      String.fromCharCode(b[8], b[9], b[10], b[11]) === 'WEBP',
  },
];

/**
 * Télécharge la pochette et l'écrit à côté de l'extrait, sous le même nom de
 * base : c'est ainsi que la bibliothèque associe les deux, sans rien d'autre
 * qu'une convention de nommage.
 *
 * Ne lève jamais. Une pochette absente n'est pas une raison de refuser un
 * morceau : le jukebox retombe alors sur la couleur tirée du titre.
 *
 * @returns {Promise<{file:string, bytes:number}|null>}
 */
export async function downloadArtwork(artworkUrl, base, targetDir) {
  if (!artworkUrl || !base) return null;

  let bytes;
  try {
    const response = await fetch(bigArtwork(artworkUrl), {
      headers: { 'user-agent': USER_AGENT, accept: 'image/*' },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT),
    });
    if (!response.ok) return null;
    if (Number(response.headers.get('content-length') ?? 0) > ARTWORK_LIMIT) return null;

    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return null; // plateforme muette, réseau coupé : tant pis pour l'image
  }

  if (bytes.length < 64 || bytes.length > ARTWORK_LIMIT) return null;
  // On regarde les octets, pas l'adresse ni l'en-tête : c'est la seule chose
  // qui dise vraiment ce qu'on s'apprête à écrire sur le disque.
  const kind = ARTWORK_KINDS.find((candidate) => candidate.test(bytes));
  if (!kind) return null;

  const file = `${base}${kind.extension}`;
  try {
    await fsp.mkdir(targetDir, { recursive: true });
    await fsp.writeFile(path.join(targetDir, file), bytes);
  } catch {
    return null;
  }
  return { file, bytes: bytes.length };
}

/** Nom de fichier sûr : ni séparateur, ni caractère de contrôle, ni point initial. */
export function safeBaseName(artist, title) {
  const clean = (value) =>
    String(value ?? '')
      .replace(/[ -]/g, '')
      .replace(/[/\\:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const base = [clean(artist), clean(title)].filter(Boolean).join(' - ') || 'Demande';
  return base.replace(/^\.+/, '').slice(0, 110);
}

/**
 * Télécharge l'extrait et l'écrit dans `tracks/Demandes/`. Le fichier prend le
 * nom « Artiste - Titre », celui-là même que la bibliothèque sait relire.
 *
 * @returns {Promise<{file:string, base:string, bytes:number}>}
 */
export async function downloadPreview(previewUrl, artist, title, targetDir) {
  const response = await fetch(previewUrl, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('L’extrait n’a pas pu être téléchargé.');

  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > PREVIEW_LIMIT) throw new Error('Le fichier proposé est trop gros pour un extrait.');

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > PREVIEW_LIMIT) throw new Error('Le fichier proposé est trop gros pour un extrait.');
  if (bytes.length < 2048) throw new Error('L’extrait reçu est vide.');

  // L'extension suit ce que la plateforme sert : AAC chez Apple, MP3 chez Deezer.
  const extension = /\.mp3(\?|$)/i.test(previewUrl) ? '.mp3' : '.m4a';
  const base = safeBaseName(artist, title);
  const file = `${base}${extension}`;

  await fsp.mkdir(targetDir, { recursive: true });
  await fsp.writeFile(path.join(targetDir, file), bytes);
  return { file, base, bytes: bytes.length };
}
