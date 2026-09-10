/**
 * Télécommande des visiteurs.
 *
 * Servie sur `/r`, ouverte depuis un téléphone en scannant le code QR affiché
 * près du piano. Elle ne touche ni au Bluetooth ni au son : elle dépose une
 * demande dans la file du serveur, et le jukebox — resté sur l'ordinateur du
 * stand, seul à parler au piano — la joue quand son tour vient.
 *
 *   téléphone (5G) ──POST /api/stand/queue──► serveur ──SSE──► jukebox ──► piano
 *        ▲                                       │
 *        └──────────────── SSE ──────────────────┘
 *
 * Les visiteurs sont sur leur forfait mobile, pas sur le Wi-Fi du stand : la
 * page doit être joignable depuis l'extérieur, et rester légère. D'où
 * l'absence de police, d'image et de dépendance — tout tient en quelques Ko.
 *
 * Le code du stand voyage dans l'adresse du code QR (`?c=…`) : c'est lui qui
 * distingue « quelqu'un devant le piano » de « quelqu'un qui a trouvé
 * l'adresse ». On le range dès le chargement, car le visiteur peut très bien
 * recharger la page ensuite sans le paramètre.
 */

/* Les deux marques de la liste, dessinées dans le même trait que le reste
   de l'application : une page qui grave ses têtes de note ne colle pas un
   glyphe pris à Unicode. */
const GO_ADD = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5.5v13M5.5 12h13"/></svg>';
const GO_DONE = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.6 4.4 4.4L19 7.4"/></svg>';

const el = (id) => document.getElementById(id);

const dom = {
  now: el('now'),
  nowTitle: el('now-title'),
  nowArtist: el('now-artist'),
  nowFill: el('now-fill'),
  queueBlock: el('queue-block'),
  queueList: el('queue-list'),
  queueCount: el('queue-count'),
  name: el('name'),
  cheer: el('cheer'),
  cheerCount: el('cheer-count'),
  locked: el('locked'),
  linkForm: el('link-form'),
  link: el('link'),
  linkSend: el('link-send'),
  linkState: el('link-state'),
  search: el('search'),
  chips: el('chips'),
  tracks: el('tracks'),
  empty: el('empty'),
  scoreOpen: el('score-open'),
  scoreHint: el('score-hint'),
  toasts: el('toasts'),
};

/** Toutes les catégories confondues. */
const ALL = '__all__';

let library = [];
let categories = [];
let category = ALL;
/** Clés des morceaux déjà dans la file, pour marquer la liste. */
let queued = new Set();

/**
 * Code du stand. Il arrive par l'adresse du code QR ; on le garde pour que
 * recharger la page, ou revenir dessus plus tard, continue de marcher.
 */
const standCode = (() => {
  const KEY = 'lego-piano-jukebox/stand-code';
  const fromUrl = new URL(window.location.href).searchParams.get('c');
  try {
    if (fromUrl) localStorage.setItem(KEY, fromUrl);
    return fromUrl ?? localStorage.getItem(KEY) ?? '';
  } catch {
    return fromUrl ?? '';
  }
})();

/** Prénom, retenu d'une visite à l'autre pour ne pas le retaper. */
const NAME_KEY = 'lego-piano-jukebox/name';

/**
 * Jeton de ce téléphone. Il ne sert qu'à deux choses : plafonner le nombre de
 * demandes simultanées d'une même personne, et reconnaître ses propres
 * demandes dans la file. Il n'identifie personne — c'est un tirage au hasard,
 * qui ne quitte pas ce navigateur autrement que sous cette forme.
 */
const visitor = (() => {
  const KEY = 'lego-piano-jukebox/visitor';
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return saved;
    const fresh = `v${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // Navigation privée : un jeton par chargement de page, c'est déjà ça.
    return `v${Math.random().toString(36).slice(2, 10)}`;
  }
})();

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

function toast(message, kind = 'info', duration = 3600) {
  const element = document.createElement('div');
  element.className = `toast ${kind}`;
  element.textContent = message;
  dom.toasts.append(element);
  setTimeout(() => {
    element.style.transition = 'opacity .25s';
    element.style.opacity = '0';
    setTimeout(() => element.remove(), 280);
  }, duration);
}

/* ------------------------------------------------------------------ */
/* Bibliothèque                                                        */
/* ------------------------------------------------------------------ */

async function loadLibrary() {
  try {
    const response = await fetch('/api/library');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    library = data.tracks ?? [];
    categories = (data.categories ?? []).filter((entry) => entry.count > 0);
    renderChips();
    renderTracks();
    // La première trame du serveur arrive souvent avant la bibliothèque :
    // c'est seulement maintenant qu'on sait si le morceau a une partition.
    refreshScore(lastNow);
  } catch (error) {
    dom.empty.hidden = false;
    dom.empty.textContent = `La bibliothèque est injoignable (${error.message}). Le jukebox est-il allumé ?`;
  }
}

function renderChips() {
  dom.chips.textContent = '';
  const entries = [[ALL, 'Tout'], ...categories.map((entry) => [entry.name, entry.name])];
  for (const [value, label] of entries) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.role = 'tab';
    chip.setAttribute('aria-selected', String(value === category));
    chip.textContent = label;
    chip.addEventListener('click', () => {
      category = value;
      renderChips();
      renderTracks();
    });
    dom.chips.append(chip);
  }
}

function matching() {
  const query = dom.search.value.trim().toLowerCase();
  return library.filter((track) => {
    if (category !== ALL && track.category !== category) return false;
    if (!query) return true;
    return `${track.artist ?? ''} ${track.title}`.toLowerCase().includes(query);
  });
}

function renderTracks() {
  const tracks = matching();
  dom.tracks.textContent = '';
  dom.empty.hidden = tracks.length > 0;
  if (!tracks.length) {
    dom.empty.textContent = library.length
      ? 'Aucun morceau ne correspond.'
      : 'La bibliothèque est vide pour le moment.';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const track of tracks) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'track';
    button.dataset.id = track.id;
    button.dataset.queued = queued.has(track.id) ? '1' : '0';
    button.innerHTML =
      '<span class="body"><span class="title"></span><span class="artist"></span></span>' +
      `<span class="go" aria-hidden="true">${queued.has(track.id) ? GO_DONE : GO_ADD}</span>`;
    button.querySelector('.title').textContent = track.title;
    button.querySelector('.artist').textContent = track.artist ?? track.category;
    button.addEventListener('click', () => request(track, button));
    fragment.append(button);
  }
  dom.tracks.append(fragment);
}

/* ------------------------------------------------------------------ */
/* Demande d'un morceau                                                */
/* ------------------------------------------------------------------ */

async function request(track, button) {
  if (queued.has(track.id)) {
    toast('Ce morceau est déjà dans la file.', 'info');
    return;
  }
  button.disabled = true;
  try {
    const response = await fetch('/api/stand/queue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: track.id, by: visitor, code: standCode, name: currentName() }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 403) lockOut(data.error);
      toast(data.error ?? 'La demande n’est pas passée.', 'error', 5000);
      return;
    }
    apply(data);
    const rank = data.position;
    toast(
      rank <= 1
        ? `« ${track.title} » passe juste après le morceau en cours.`
        : `« ${track.title} » est en file, position ${rank}.`,
      'success'
    );
    // Une petite vibration confirme le geste sur les téléphones qui la gèrent.
    navigator.vibrate?.(18);
  } catch {
    toast('Connexion perdue. Reste sur le Wi-Fi du stand et réessaie.', 'error', 5000);
  } finally {
    button.disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* État partagé                                                        */
/* ------------------------------------------------------------------ */

/**
 * Décompte de la pause de service.
 *
 * Le serveur envoie des secondes restantes, pas une heure d'arrivée : l'horloge
 * d'un téléphone et celle de l'ordinateur du stand ne sont jamais tout à fait
 * les mêmes. On repart donc de la valeur reçue et on décompte ici, quitte à se
 * recaler à chaque message — il en arrive un toutes les deux secondes.
 */
let restEndsAt = 0;
let restTimer = null;

function tickRest() {
  const remaining = Math.max(0, Math.ceil((restEndsAt - Date.now()) / 1000));
  if (remaining <= 0) {
    clearInterval(restTimer);
    restTimer = null;
    dom.now.dataset.rest = '0';
    return;
  }
  dom.nowTitle.textContent = 'Le piano souffle un instant';
  dom.nowArtist.textContent = `Le moteur refroidit — reprise dans ${remaining} s`;
  dom.nowFill.style.transform = 'scaleX(1)';
}

function showRest(seconds) {
  restEndsAt = Date.now() + seconds * 1000;
  dom.now.dataset.rest = '1';
  dom.now.dataset.state = 'paused';
  tickRest();
  restTimer ??= setInterval(tickRest, 1000);
}

/** Dernier « en ce moment » reçu du serveur. */
let lastNow = null;

/** Applique un instantané reçu du serveur : ce qui joue, et la file. */
function apply(state) {
  const now = state.now;

  // Le pupitre se recale avant tout le reste : une pause de service sort de
  // cette fonction plus bas, et un curseur qu'on aurait oublié de recaler
  // continuerait d'avancer sur un piano muet.
  lastNow = now ?? null;
  resync(now);
  refreshScore(now);

  // Une pause de service prend le pas sur le morceau : c'est la seule chose
  // qu'un visiteur devant un piano muet a besoin de lire.
  if (now?.rest > 0) {
    showRest(now.rest);
    applyQueue(state);
    return;
  }
  if (restTimer) {
    clearInterval(restTimer);
    restTimer = null;
  }
  restEndsAt = 0;
  dom.now.dataset.rest = '0';

  dom.now.dataset.state = now?.state ?? 'paused';
  dom.nowTitle.textContent = now?.title ?? 'Le jukebox n’a pas encore démarré';
  dom.nowArtist.textContent = now?.artist ?? '';
  const progress = now?.duration ? Math.min(1, now.position / now.duration) : 0;
  dom.nowFill.style.transform = `scaleX(${progress.toFixed(4)})`;

  applyQueue(state);
}

/** La file et le compteur d'applaudissements, communs aux deux cas. */
function applyQueue(state) {
  dom.cheerCount.textContent = state.cheers ? String(state.cheers) : '';

  const queue = state.queue ?? [];
  queued = new Set(queue.map((entry) => entry.id));

  dom.queueBlock.hidden = queue.length === 0;
  dom.queueCount.textContent = queue.length ? `· ${queue.length}` : '';
  dom.queueList.textContent = '';
  queue.forEach((entry, index) => {
    const item = document.createElement('li');
    item.dataset.mine = entry.by === visitor ? '1' : '0';
    item.innerHTML = '<span class="rank"></span><span class="label"><b></b><small></small></span>';
    item.querySelector('.rank').textContent = String(index + 1);
    item.querySelector('b').textContent = entry.title;
    const origin = entry.by === visitor ? 'ta demande' : entry.name ? `demandé par ${entry.name}` : null;
    item.querySelector('small').textContent = [entry.artist ?? entry.category, origin].filter(Boolean).join(' · ');
    dom.queueList.append(item);
  });

  // Les pastilles « déjà demandé » de la liste doivent suivre.
  for (const button of dom.tracks.querySelectorAll('.track')) {
    const inQueue = queued.has(button.dataset.id);
    button.dataset.queued = inQueue ? '1' : '0';
    button.querySelector('.go').innerHTML = inQueue ? GO_DONE : GO_ADD;
  }
}

/* ------------------------------------------------------------------ */
/* Envoi d'un lien de plateforme                                       */
/* ------------------------------------------------------------------ */

function sayLink(message, kind = 'info') {
  dom.linkState.hidden = !message;
  dom.linkState.dataset.kind = kind;
  dom.linkState.textContent = message ?? '';
}

/**
 * Le serveur fait tout le travail lourd : reconnaître la plateforme, retrouver
 * le titre, récupérer l'extrait officiel de trente secondes, l'écrire à côté
 * des autres morceaux. La transcription en partition, elle, se fera sur
 * l'ordinateur du stand pendant que la musique continue.
 *
 * Ici, on se contente d'attendre poliment : la résolution du lien passe par
 * deux ou trois requêtes vers l'extérieur, ce n'est pas instantané.
 */
async function sendLink(event) {
  event.preventDefault();
  const value = dom.link.value.trim();
  if (!value) return;

  dom.linkSend.disabled = true;
  sayLink('On cherche ce morceau', 'working');
  try {
    const response = await fetch('/api/stand/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ link: value, by: visitor, code: standCode, name: currentName() }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 403) lockOut(data.error);
      sayLink(data.error ?? 'La demande n’est pas passée.', 'error');
      return;
    }
    apply(data);
    const found = data.resolved ?? {};
    sayLink(
      `« ${found.title} »${found.artist ? ` de ${found.artist}` : ''} est en file — extrait officiel de 30 s (${found.source}).`,
      'success'
    );
    dom.link.value = '';
    navigator.vibrate?.(18);
  } catch {
    sayLink('Connexion perdue. Réessaie dans un instant.', 'error');
  } finally {
    dom.linkSend.disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* Prénom                                                              */
/* ------------------------------------------------------------------ */

/**
 * Le prénom est facultatif et n'est pas une identité : il s'affiche sur
 * l'écran du stand pendant le morceau, puis disparaît. Le serveur le filtre
 * à son tour — ici on se contente de ne pas envoyer n'importe quoi.
 */
function currentName() {
  const value = dom.name.value.replace(/[^\p{L}\p{M}\s'’-]/gu, '').trim().slice(0, 14);
  return value.length >= 2 ? value : null;
}

function restoreName() {
  try {
    dom.name.value = localStorage.getItem(NAME_KEY) ?? '';
  } catch { /* navigation privée */ }
  dom.name.addEventListener('change', () => {
    try {
      localStorage.setItem(NAME_KEY, dom.name.value);
    } catch { /* tant pis */ }
  });
}

/* ------------------------------------------------------------------ */
/* Applaudissements                                                     */
/* ------------------------------------------------------------------ */

/**
 * Un applaudissement fait clignoter la LED du hub, à l'autre bout de la
 * chaîne. C'est la démonstration la plus courte du projet : un doigt sur un
 * téléphone en 5G, et une diode s'allume dans un piano en briques.
 */
async function cheer() {
  dom.cheer.disabled = true;
  navigator.vibrate?.(12);
  try {
    const response = await fetch('/api/stand/cheer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ by: visitor, code: standCode }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (response.status === 403) lockOut(data.error);
      else if (response.status === 429) toast('Doucement sur les applaudissements !', 'info');
      return;
    }
  } catch { /* réseau capricieux : l'applaudissement suivant repartira */ } finally {
    // Un court verrou évite le martèlement, sans casser l'élan.
    setTimeout(() => { dom.cheer.disabled = false; }, 700);
  }
}

/* ------------------------------------------------------------------ */
/* État partagé                                                         */
/* ------------------------------------------------------------------ */

/** Le code du stand ne passe pas : on le dit clairement plutôt que d'échouer. */
function lockOut(message) {
  dom.locked.hidden = false;
  dom.locked.textContent = message ?? 'Rescanne le code QR affiché près du piano.';
}

/**
 * Flux d'événements. `EventSource` se reconnecte tout seul quand le réseau
 * mobile hoquette ou que le téléphone se met en veille : c'est précisément
 * pourquoi on l'a préféré à un WebSocket ici.
 */
function listen() {
  const source = new EventSource('/api/stand/events');
  source.addEventListener('state', (event) => {
    try {
      apply(JSON.parse(event.data));
    } catch { /* trame incomplète : la suivante arrive vite */ }
  });
  source.addEventListener('cheer', (event) => {
    try {
      const { total } = JSON.parse(event.data);
      dom.cheerCount.textContent = total ? String(total) : '';
      dom.cheer.dataset.pulse = '1';
      setTimeout(() => { delete dom.cheer.dataset.pulse; }, 420);
    } catch { /* trame incomplète */ }
  });
}

/* ------------------------------------------------------------------ */
/* Mode partition                                                      */
/* ------------------------------------------------------------------ */

/**
 * Le pupitre, vu du téléphone.
 *
 * Ici, aucune horloge commune avec le jukebox : le serveur relaie une position
 * toutes les deux secondes, et le voyage — Wi-Fi du stand, 5G du visiteur,
 * serveur au milieu — prend le temps qu'il prend. On prolonge donc la dernière
 * position reçue avec l'horloge du téléphone, et on se recale à chaque trame :
 * entre deux, deux quartz ne dérivent que de quelques millisecondes.
 *
 * Reste le retard du réseau, lui constant : la position reçue décrit toujours
 * un passé proche. On l'anticipe par défaut d'un dixième et demi de seconde,
 * et les deux boutons de la barre laissent affiner à l'oreille — c'est plus
 * honnête qu'un calcul qui prétendrait mesurer une latence qu'on ne mesure pas.
 */
const NETWORK_LEAD = 0.2;

/** Un téléphone couché : les mêmes conditions que dans `score-mode.js`. */
const PHONE_LANDSCAPE = matchMedia('(orientation: landscape) and (max-height: 560px) and (pointer: coarse)');

/** Dernière position connue, et l'instant local où on l'a apprise. */
const sync = { position: 0, at: performance.now(), playing: false };
/** Partition gravée, et le morceau dont elle vient. */
let scoreMode = null;
let scoreModeReady = null;
let scoreTrackId = null;
let scoreLoading = false;

/** Où en est la musique, maintenant, selon ce que le téléphone peut en savoir. */
function clock() {
  if (!sync.playing) return sync.position;
  return sync.position + (performance.now() - sync.at) / 1000;
}

/** Recale l'horloge sur une trame du serveur, sans à-coup quand c'est possible. */
function resync(now) {
  const playing = now?.state === 'playing';
  const position = Number(now?.position) || 0;
  const gap = position - clock();
  // Un écart minime se résorbe en douceur : un curseur qui sursaute à chaque
  // trame est plus gênant qu'un curseur légèrement en avance.
  sync.position = Math.abs(gap) < 0.4 ? clock() + gap * 0.25 : position;
  sync.at = performance.now();
  sync.playing = playing;
}

/** La piste de la bibliothèque qui correspond à ce qui joue, si on la connaît. */
function currentTrack(now) {
  return now?.id ? library.find((track) => track.id === now.id) ?? null : null;
}

/**
 * Met le bouton et la partition en accord avec le morceau en cours.
 * Le module n'est téléchargé qu'au moment où il sert : sur un forfait mobile,
 * une page qui charge un graveur de partitions pour ne rien afficher serait
 * un mauvais calcul.
 */
async function refreshScore(now) {
  const track = currentTrack(now);
  const offered = Boolean(track?.midiUrl);
  dom.scoreOpen.hidden = !offered;
  dom.scoreHint.hidden = !offered;

  if (!scoreMode) {
    // Téléphone déjà couché quand la musique démarre : la rotation n'aura
    // pas lieu, c'est donc ici qu'il faut y penser.
    if (offered && PHONE_LANDSCAPE.matches) {
      await ensureScoreMode();
      await refreshScore(now);
    }
    return;
  }
  if (!offered) {
    scoreMode.setTrack(track ? { title: track.title, artist: track.artist, midi: null } : null);
    scoreTrackId = null;
    return;
  }
  if (track.id === scoreTrackId || scoreLoading) return;

  scoreLoading = true;
  scoreMode.setTrack({ title: track.title, artist: track.artist, midi: null, loading: true });
  try {
    const { parseMidi } = await import('./music/midi.js');
    const response = await fetch(track.midiUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const midi = parseMidi(await response.arrayBuffer());
    scoreTrackId = track.id;
    scoreMode.setTrack({ title: track.title, artist: track.artist, midi });
  } catch {
    scoreTrackId = null;
    scoreMode.setTrack({ title: track.title, artist: track.artist, midi: null });
  } finally {
    scoreLoading = false;
  }
}

/**
 * Charge le pupitre au premier besoin, et le branche sur l'orientation.
 *
 * La promesse est retenue, pas seulement son résultat : une trame du serveur
 * et un doigt sur le bouton peuvent se croiser pendant le téléchargement du
 * module, et deux pupitres se retrouveraient alors dans la page.
 */
function ensureScoreMode() {
  scoreModeReady ??= (async () => {
    const { ScoreMode } = await import('./score-mode.js');
    scoreMode = new ScoreMode({
      clock,
      isPlaying: () => sync.playing,
      // Seule la télécommande a besoin du réglage : le jukebox, lui, lit
      // l'heure exacte dans son propre lecteur.
      nudge: true,
    });
    scoreMode.offset = NETWORK_LEAD;
    scoreMode.autoLandscape(true);
    return scoreMode;
  })();
  return scoreModeReady;
}

async function openScore() {
  const mode = await ensureScoreMode();
  await refreshScore(lastNow);
  // `openByHand` et non `toggle` : entre le doigt et la gravure, le pupitre a
  // pu s'ouvrir de lui-même — un téléphone déjà couché — et il serait absurde
  // que le bouton « Suivre la partition » le referme.
  mode.openByHand();
}

/**
 * Tant que le module n'est pas chargé, c'est cette écoute-ci qui guette la
 * rotation du téléphone — sans quoi il faudrait le télécharger d'avance,
 * pour rien, sur chacun des téléphones qui ouvrent la télécommande.
 */
function watchRotation() {
  PHONE_LANDSCAPE.addEventListener('change', async () => {
    if (!PHONE_LANDSCAPE.matches || scoreMode || !currentTrack(lastNow)?.midiUrl) return;
    const mode = await ensureScoreMode();
    await refreshScore(lastNow);
    // La partition est prête, et le téléphone toujours couché : on ouvre.
    // Une fois le module en place, c'est lui qui suivra les rotations.
    if (PHONE_LANDSCAPE.matches && !mode.isOpen) mode.open({ byRotation: true });
  });
}

/* ------------------------------------------------------------------ */

if (!standCode) {
  lockOut('Ouvre cette page en scannant le code QR affiché près du piano : c’est lui qui porte le code du stand.');
}

dom.search.addEventListener('input', renderTracks);
dom.cheer.addEventListener('click', cheer);
dom.linkForm.addEventListener('submit', sendLink);
dom.scoreOpen.addEventListener('click', openScore);
restoreName();
loadLibrary();
listen();
watchRotation();
