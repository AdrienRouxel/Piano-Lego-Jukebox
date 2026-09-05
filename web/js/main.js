/**
 * Point d'entrée : relie la bibliothèque, le lecteur audio, le hub Bluetooth
 * et l'interface.
 *
 *   /api/library ──► liste des morceaux
 *          │
 *          ▼
 *   Player (audio) ──► horloge commune ──► MotionDriver ──► PianoHub ──► moteur
 *          │                                    │
 *          └──────────► clavier « partition »   └──► clavier « modèle LEGO »
 */

import { PianoHub } from './lego/hub.js';
import { Player } from './music/player.js';
import { MotionDriver, DEFAULT_SETTINGS } from './music/choreography.js';
import { Warmup } from './music/warmup.js';
import { PlayableKeys } from './music/keys.js';
import { GeekMode } from './geek.js';
import { wireHubTools, HUB_TOOL_SETTINGS } from './hubtools.js';
import { DocReader } from './reader.js';
import { Playlist } from './playlist.js';
import { Stand } from './stand.js';
import { RequestPipeline } from './requests.js';
import { initConverter } from './converter.js';
import {
  buildKeyboard,
  buildCamshaft,
  paintNotes,
  formatTime,
  coverStyle,
  toast,
  logLine,
} from './ui.js';

const SETTINGS_KEY = 'lego-piano-jukebox/settings';

const el = (id) => document.getElementById(id);
const dom = {
  connect: el('btn-connect'),
  hubPill: el('hub-pill'),
  hubLabel: el('hub-label'),
  hubBattery: el('hub-battery'),

  cover: el('cover'),
  nowState: el('now-state'),
  nowTitle: el('now-title'),
  nowArtist: el('now-artist'),
  nowBadges: el('now-badges'),

  keyboardScore: el('keyboard-score'),
  keyboardLego: el('keyboard-lego'),
  vizNotes: el('viz-notes'),
  vizPower: el('viz-power'),
  powerFill: el('power-fill'),

  play: el('btn-play'),
  prev: el('btn-prev'),
  next: el('btn-next'),
  shuffle: el('btn-shuffle'),
  repeat: el('btn-repeat'),
  playable: el('btn-playable'),
  playableHint: el('playable-hint'),
  source: el('btn-source'),
  sourceLabel: el('btn-source-label'),
  seek: el('seek'),
  timeCurrent: el('time-current'),
  timeTotal: el('time-total'),
  volume: el('volume'),

  list: el('track-list'),
  empty: el('library-empty'),
  search: el('search'),
  refresh: el('btn-refresh'),
  linkToggle: el('btn-link'),
  linkForm: el('library-link'),
  linkUrl: el('library-link-url'),
  linkSend: el('library-link-send'),
  linkState: el('library-link-state'),

  drawer: el('drawer'),
  scrim: el('scrim'),
  guide: el('btn-guide'),
  openSettings: el('btn-settings'),
  closeSettings: el('btn-close-settings'),
  warmup: el('warmup'),
  warmupLine: el('warmup-line'),
  log: el('log'),

  standPanel: el('stand'),
  standButton: el('btn-stand'),
  standStatus: el('stand-status'),
  standUrl: el('stand-url'),
  standSub: el('stand-sub'),
  standCheers: el('stand-cheers'),
  cheerTotal: el('cheer-total'),
  cheerBurst: el('cheer-burst'),
  qr: el('qr'),
  queueList: el('queue-list'),
  queueCount: el('queue-count'),
  queueEmpty: el('queue-empty'),
  queueClear: el('btn-queue-clear'),
  standAlarm: el('stand-alarm'),
  operatorField: el('operator-field'),
  operatorToken: el('operator-token'),
  localField: el('local-field'),
  localSwitch: el('set-local'),
  localHint: el('local-hint'),
  rest: el('rest'),
  restCount: el('rest-count'),
  restDial: el('rest-dial-run'),
  restText: el('rest-text'),
  attractRest: el('attract-rest'),
  attractRestText: el('attract-rest-text'),
  attract: el('attract'),
  attractTitle: el('attract-title'),
  attractSub: el('attract-sub'),
  attractTop: el('attract-top'),
  attractQr: el('attract-qr'),
  attractUrl: el('attract-url'),
  attractNow: el('attract-now'),
  attractNowTitle: el('attract-now-title'),
  attractNowArtist: el('attract-now-artist'),
  unlock: el('unlock'),
  unlockForm: el('unlock-form'),
  unlockCode: el('unlock-code'),
  unlockError: el('unlock-error'),
  tally: el('tally'),
  standWork: el('stand-work'),
  standWorkLabel: el('stand-work-label'),
  standWorkFill: el('stand-work-fill'),
};

/* ------------------------------------------------------------------ */
/* État                                                                */
/* ------------------------------------------------------------------ */

/** Réglages d'interface, à côté de ceux de la chorégraphie. */
const UI_DEFAULTS = {
  volume: 0.8,
  theme: 'piano',
  geek: false,
  warmup: false,
  collapsedCategories: [],
  // Journée portes ouvertes.
  shuffle: false,
  repeat: 'off',
  kiosk: false,
  playable: false,
  showNames: true,
  resumeDelay: 25, // secondes de silence tolérées en mode borne
  venue: 'jpo', // profil de borne : 'jpo' ou 'salon'
  attractDelay: 0, // secondes avant l'écran d'appel ; 0 = jamais
  keepAwake: true,
  restMotor: false,
  restEvery: 20, // minutes de moteur avant une pause de service
  lock: false,
  lockCode: '',
  attractTitle: '',
  attractSub: '',
  attractTop: true,
  audioProfile: 'salle',
  handTrigger: false,
  ...HUB_TOOL_SETTINGS,
};

const settings = loadSettings();
const hub = new PianoHub();
const warmup = new Warmup({ overlay: dom.warmup, line: dom.warmupLine }, hub, settings);
let player = null;
let driver = null;

// Le panneau de télémétrie lit l'état des trois briques ; il ne les pilote pas.
// Le guide et la documentation, consultables sans quitter la page.
const reader = new DocReader();

const geek = new GeekMode({
  hub,
  getPlayer: () => player,
  getDriver: () => driver,
  settings,
});

/** Ordre de lecture : enchaînement, aléatoire, répétition. */
const playlist = new Playlist();
/** File d'attente des visiteurs, partagée par le serveur. */
const stand = new Stand();
/** Transcription des extraits demandés par lien, en tâche de fond. */
const requests = new RequestPipeline({
  stand,
  getLibrary: () => library,
  reloadLibrary: () => loadLibrary(),
});
/** Prénom de qui a demandé le morceau en cours, s'il en a laissé un. */
let requestedBy = null;
/** Instant du dernier silence constaté, pour la reprise automatique. */
let silentSince = 0;

let library = [];
let categories = [];
let filtered = [];
/** Catégories repliées, par nom. Repartir de zéro = tout est déplié. */
const collapsed = new Set();
let localSamples = false;
let currentIndex = -1;
let audioReady = false;
let seeking = false;

// Clavier « partition » : les 88 touches d'un vrai piano, pour qu'aucune note
// du fichier MIDI ne passe à la trappe.
const scoreKeys = buildKeyboard(dom.keyboardScore, 21, 108);
// Clavier « modèle » : les 25 touches du 21323, de do3 à do5.
const camshaft = buildCamshaft(dom.keyboardLego, 48, 25);

// Le clavier « partition » sait aussi être joué : c'est le même objet à
// l'écran, avec des écouteurs en plus quand on l'active.
const playable = new PlayableKeys({
  container: dom.keyboardScore,
  keys: scoreKeys,
  getPlayer: () => player,
});

/* ------------------------------------------------------------------ */
/* Réglages persistants                                                */
/* ------------------------------------------------------------------ */

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return { ...DEFAULT_SETTINGS, ...UI_DEFAULTS, ...stored };
  } catch {
    return { ...DEFAULT_SETTINGS, ...UI_DEFAULTS };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* mode navigation privée : tant pis */ }
}

/**
 * Applique un thème. Le script du <head> a déjà posé l'attribut au
 * chargement — cette fonction sert aux changements en cours de route.
 */
function applyTheme(theme) {
  if (theme === 'piano') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;

  // Les pochettes générées sont écrites en style inline : il faut les
  // redessiner à la main dans la palette du nouveau thème.
  const track = library[currentIndex];
  if (track && !track.coverUrl) dom.cover.style.backgroundImage = coverStyle(track.id, theme);
}

function bindThemeControls() {
  for (const input of document.querySelectorAll('input[name="theme"]')) {
    input.checked = input.value === settings.theme;
    input.addEventListener('change', () => {
      if (!input.checked) return;
      settings.theme = input.value;
      applyTheme(settings.theme);
      saveSettings();
    });
  }
  applyTheme(settings.theme);
}

/** Bascule du mode geek, installée par `bindSettingsControls`. */
let toggleGeek = () => {};

/* ------------------------------------------------------------------ */
/* Second écran                                                        */
/* ------------------------------------------------------------------ */

/**
 * La télémétrie peut être déportée dans un onglet séparé, à poser sur un
 * deuxième moniteur pendant que le jukebox reste sur le premier.
 *
 * Le panneau déporté n'est pas une copie : c'est un second `GeekMode` que
 * *cette* fenêtre construit dans le document de l'autre. Le contexte audio et
 * la connexion Bluetooth restent ici — il ne peut y en avoir qu'un exemplaire.
 */
let secondScreen = null;
let screenPanel = null;
/** Remet la case à cocher en accord avec l'état réel de la fenêtre. */
let syncScreenToggle = () => {};

function openSecondScreen() {
  if (secondScreen && !secondScreen.closed) {
    secondScreen.focus();
    return;
  }
  // Surtout pas `noopener` : c'est par `window.opener` que l'autre onglet
  // vient chercher son panneau.
  secondScreen = window.open('geek.html', 'jukebox-geek-screen', 'width=1440,height=900');
  if (!secondScreen) {
    toast('Le navigateur a bloqué l’ouverture de l’onglet. Autorise les fenêtres surgissantes pour ce site.', 'error', 7000);
    syncScreenToggle();
    return;
  }
  syncScreenToggle();
  // Rien ne nous prévient quand l'utilisateur ferme l'onglet à la main.
  clearInterval(watchScreen.timer);
  watchScreen.timer = setInterval(watchScreen, 700);
}

function closeSecondScreen() {
  clearInterval(watchScreen.timer);
  secondScreen?.close();
  secondScreen = null;
  screenPanel?.destroy();
  screenPanel = null;
  syncScreenToggle();
}

function watchScreen() {
  if (secondScreen && !secondScreen.closed) return;
  closeSecondScreen();
}

/**
 * Appelée par l'onglet du second écran, qui nous confie son document.
 * @param {Document} doc document de la fenêtre d'accueil
 * @returns {{update:(now:number)=>void, destroy:()=>void}}
 */
function attachScreen(doc) {
  screenPanel?.destroy();
  screenPanel = new GeekMode({
    hub,
    getPlayer: () => player,
    getDriver: () => driver,
    settings,
    layout: 'screen',
  });
  screenPanel.mount(doc.body);
  screenPanel.setEnabled(true);
  return {
    // Sans argument : c'est toujours l'horloge du jukebox qui fait foi, les
    // deux fenêtres n'ayant pas la même origine de temps.
    update: () => screenPanel?.update(performance.now()),
    destroy: () => {
      screenPanel?.destroy();
      screenPanel = null;
    },
  };
}

/** Libellés de la répétition, pour l'infobulle et le lecteur d'écran. */
const REPEAT_LABELS = { off: 'aucune', all: 'toute la liste', one: 'le morceau' };

function setShuffle(on) {
  settings.shuffle = on;
  playlist.shuffle = on;
  dom.shuffle.setAttribute('aria-pressed', String(on));
  saveSettings();
}

function setRepeat(mode) {
  settings.repeat = mode;
  playlist.repeat = mode;
  dom.repeat.dataset.mode = mode;
  dom.repeat.setAttribute('aria-label', `Répétition : ${REPEAT_LABELS[mode]}`);
  saveSettings();
}

/** Champs numériques exposés en pourcentage dans l'interface. */
const RATIO_FIELDS = new Set(['accent', 'sensitivity']);

function bindSettingsControls() {
  const numeric = ['minPower', 'maxPower', 'leadMs', 'accent', 'sensitivity'];
  for (const key of numeric) {
    const input = el(`set-${key}`);
    const output = el(`out-${key}`);
    const write = (value) => {
      settings[key] = RATIO_FIELDS.has(key) ? value / 100 : value;
      output.textContent = key === 'leadMs' ? `${value} ms` : `${value}${RATIO_FIELDS.has(key) ? ' %' : ''}`;
      driver?.update(settings);
      saveSettings();
    };
    input.value = String(RATIO_FIELDS.has(key) ? Math.round(settings[key] * 100) : settings[key]);
    write(Number(input.value));
    input.addEventListener('input', () => write(Number(input.value)));
  }

  for (const key of ['enabled', 'idleStop', 'ledSync', 'warmup', 'brakeOnStop', 'rampStart']) {
    const input = el(`set-${key}`);
    input.checked = Boolean(settings[key]);
    input.addEventListener('change', () => {
      settings[key] = input.checked;
      driver?.update(settings);
      if (key === 'enabled' && !input.checked) hub.stopMotor();
      saveSettings();
    });
  }

  const geekToggle = el('set-geek');
  const setGeek = (on) => {
    settings.geek = on;
    geekToggle.checked = on;
    geek.setEnabled(on);
    saveSettings();
  };
  geekToggle.addEventListener('change', () => setGeek(geekToggle.checked));
  geek.onClose = () => setGeek(false);
  toggleGeek = () => setGeek(!settings.geek);
  setGeek(Boolean(settings.geek));

  const screenToggle = el('set-geekScreen');
  screenToggle.addEventListener('change', () => {
    if (screenToggle.checked) openSecondScreen();
    else closeSecondScreen();
  });
  syncScreenToggle = () => { screenToggle.checked = Boolean(secondScreen && !secondScreen.closed); };

  const direction = el('set-direction');
  direction.checked = settings.direction === -1;
  direction.addEventListener('change', () => {
    settings.direction = direction.checked ? -1 : 1;
    driver?.update(settings);
    saveSettings();
  });

  // Garde-fou : la puissance minimale ne doit jamais dépasser la maximale.
  const minInput = el('set-minPower');
  const maxInput = el('set-maxPower');
  const reconcile = (source) => {
    if (settings.minPower <= settings.maxPower) return;
    if (source === 'min') maxInput.value = minInput.value;
    else minInput.value = maxInput.value;
    minInput.dispatchEvent(new Event('input'));
    maxInput.dispatchEvent(new Event('input'));
  };
  minInput.addEventListener('change', () => reconcile('min'));
  maxInput.addEventListener('change', () => reconcile('max'));

  // Mode borne.
  for (const input of document.querySelectorAll('input[name="venue"]')) {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      applyVenue(input.value);
      toast(`Profil « ${VENUE_PROFILES[input.value].label} » appliqué.`, 'success');
    });
  }

  // Trois curseurs qui n'écrivent qu'un nombre : même câblage pour les trois.
  for (const [key, unit, zero] of [
    ['resumeDelay', 's', null],
    ['attractDelay', 's', 'jamais'],
    ['restEvery', 'min', null],
  ]) {
    const input = el(`set-${key}`);
    const output = el(`out-${key}`);
    const write = (value) => {
      settings[key] = value;
      output.textContent = value === 0 && zero ? zero : `${value} ${unit}`;
      saveSettings();
    };
    input.value = String(settings[key]);
    write(Number(input.value));
    input.addEventListener('input', () => write(Number(input.value)));
  }

  // L'affiche : deux champs de texte, appliqués tels quels.
  for (const [key, node] of [['attractTitle', el('set-attractTitle')], ['attractSub', el('set-attractSub')]]) {
    node.value = settings[key] ?? '';
    node.addEventListener('change', () => {
      settings[key] = node.value.trim();
      renderAttractWords();
      saveSettings();
    });
  }

  const attractTop = el('set-attractTop');
  attractTop.checked = Boolean(settings.attractTop);
  attractTop.addEventListener('change', () => {
    settings.attractTop = attractTop.checked;
    saveSettings();
  });

  const audioProfile = el('set-audioProfile');
  audioProfile.value = settings.audioProfile;
  audioProfile.addEventListener('change', () => {
    settings.audioProfile = audioProfile.value;
    player?.setAudioProfile(settings.audioProfile);
    saveSettings();
  });

  const handTrigger = el('set-handTrigger');
  handTrigger.checked = Boolean(settings.handTrigger);
  handTrigger.addEventListener('change', () => {
    settings.handTrigger = handTrigger.checked;
    if (handTrigger.checked && hub.connected && hub.sensorPort === null) {
      toast('Aucun capteur détecté sur le hub : le déclencheur restera sans effet.', 'error', 7000);
    }
    saveSettings();
  });

  const keepAwake = el('set-keepAwake');
  keepAwake.checked = Boolean(settings.keepAwake);
  keepAwake.addEventListener('change', () => {
    applyKeepAwake(keepAwake.checked);
    saveSettings();
  });

  // Le bouton d'essai : on ne règle pas une pause de service à l'aveugle.
  el('btn-rest-now').addEventListener('click', () => {
    player?.pause();
    startRest();
  });

  const restMotor = el('set-restMotor');
  restMotor.checked = Boolean(settings.restMotor);
  restMotor.addEventListener('change', () => {
    settings.restMotor = restMotor.checked;
    saveSettings();
  });

  const lockCode = el('set-lockCode');
  lockCode.value = settings.lockCode ?? '';
  lockCode.addEventListener('change', () => {
    settings.lockCode = lockCode.value.replace(/\D/g, '').slice(0, 4);
    lockCode.value = settings.lockCode;
    saveSettings();
  });
  el('set-lock').addEventListener('change', (event) => applyLock(event.target.checked));

  const kiosk = el('set-kiosk');
  kiosk.addEventListener('change', () => applyKiosk(kiosk.checked));

  const playableToggle = el('set-playable');
  playableToggle.addEventListener('change', () => setPlayable(playableToggle.checked));

  const showNames = el('set-showNames');
  showNames.checked = Boolean(settings.showNames);
  showNames.addEventListener('change', () => {
    settings.showNames = showNames.checked;
    if (library[currentIndex]) renderBadges(library[currentIndex]);
    renderStandPanel();
    publishNow(true);
    saveSettings();
  });

  dom.volume.value = String(Math.round(settings.volume * 100));
  dom.volume.addEventListener('input', () => {
    settings.volume = Number(dom.volume.value) / 100;
    if (player) player.volume = settings.volume;
    saveSettings();
  });
}

/* ------------------------------------------------------------------ */
/* Bibliothèque                                                        */
/* ------------------------------------------------------------------ */

async function loadLibrary() {
  try {
    const response = await fetch('/api/library');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    library = data.tracks;
    categories = data.categories ?? [];
    localSamples = Boolean(data.localSamples);
    playlist.setTracks(library);
    restoreCollapsed();
    applyFilter();
  } catch (error) {
    dom.empty.hidden = false;
    dom.empty.textContent = `La bibliothèque n’a pas pu être lue (${error.message}). Le serveur est-il bien lancé avec « npm start » ?`;
  }
}

function applyFilter() {
  const query = dom.search.value.trim().toLowerCase();
  // La catégorie compte aussi : taper « demandes » ou « gaming » doit sortir
  // le dossier entier, ce qu'on cherche à faire dès que la bibliothèque grossit.
  filtered = query
    ? library.filter((track) =>
        `${track.artist ?? ''} ${track.title} ${track.category}`.toLowerCase().includes(query)
      )
    : library.slice();
  renderList();
}

/* --- Catégories ---------------------------------------------------- */

const CARET = '<svg class="group-caret" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 4.2 6 8l3.5-3.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Enregistre l'état des plis, pour le retrouver à la prochaine visite. */
function persistCollapsed() {
  settings.collapsedCategories = [...collapsed];
  saveSettings();
}

/**
 * Relit l'état des plis, en oubliant les catégories qui n'existent plus —
 * sinon un dossier supprimé puis recréé reviendrait replié sans raison.
 */
function restoreCollapsed() {
  collapsed.clear();
  const known = new Set(categories.map((category) => category.name));
  for (const name of settings.collapsedCategories ?? []) {
    if (known.has(name)) collapsed.add(name);
  }
  persistCollapsed();
}

function toggleCategory(name) {
  if (collapsed.has(name)) collapsed.delete(name);
  else collapsed.add(name);
  persistCollapsed();
  renderList();
}

/** Amène le morceau en cours sous les yeux, sans secousse. */
function revealCurrent() {
  const button = dom.list.querySelector('.track[aria-current="true"]');
  button?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/** Le message affiché dans une catégorie vide, qui dit où déposer ses fichiers. */
function categoryHint(name) {
  const hint = document.createElement('p');
  hint.className = 'group-hint';
  hint.innerHTML = `Catégorie vide. Dépose des fichiers <code>.mid</code> ou <code>.mp3</code> dans <code>tracks/${name}/</code>, puis clique sur « Actualiser ».`;
  return hint;
}

/** Catégorie où atterrissent les morceaux ajoutés par un lien de plateforme. */
const REQUEST_CATEGORY = 'Demandes';

/**
 * La croix qui retire un morceau demandé. Elle n'existe que pour la catégorie
 * des demandes : le reste de la bibliothèque est déposé à la main dans
 * `tracks/`, et n'a pas à s'effacer depuis un navigateur.
 */
function removeButton(track) {
  if (track.category !== REQUEST_CATEGORY) return null;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'track-remove';
  button.setAttribute('aria-label', `Supprimer « ${track.title} »`);
  button.title = 'Supprimer ce morceau — extrait et partition partent du disque';
  button.innerHTML =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>';
  button.addEventListener('click', () => removeTrack(track));
  return button;
}

/**
 * Supprime un morceau demandé, fichiers compris. Le serveur ne l'accepte que
 * pour la catégorie des demandes et depuis le poste du stand ; ici on demande
 * confirmation, parce qu'un fichier effacé ne revient pas.
 */
async function removeTrack(track) {
  const label = track.artist ? `${track.artist} — ${track.title}` : track.title;
  if (!window.confirm(`Supprimer « ${label} » ?\n\nL’extrait et sa partition seront effacés du disque.`)) return;

  const slash = track.id.indexOf('/');
  const url =
    `/api/tracks?category=${encodeURIComponent(track.id.slice(0, slash))}` +
    `&name=${encodeURIComponent(track.id.slice(slash + 1))}`;

  try {
    const response = await fetch(url, { method: 'DELETE', headers: stand.controlHeaders });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      toast(data.error ?? 'La suppression a échoué.', 'error', 6000);
      return;
    }
  } catch {
    toast('Serveur injoignable : le morceau n’a pas été supprimé.', 'error', 6000);
    return;
  }

  // Le fichier qui jouait vient de disparaître : mieux vaut arrêter net que
  // laisser le lecteur courir après une source qui n'existe plus.
  if (player?.track?.id === track.id) clearNowPlaying();

  await loadLibrary();
  // La bibliothèque a changé de taille : l'index du morceau en cours aussi.
  currentIndex = player?.track ? library.findIndex((item) => item.id === player.track.id) : -1;
  renderList();
  logLine(dom.log, `Morceau supprimé : ${label}.`, 'warn');
  toast(`« ${track.title} » supprimé.`, 'success');
}

/** Remet la scène à son état d'accueil, quand plus rien ne joue. */
function clearNowPlaying() {
  player?.unload();
  currentIndex = -1;
  requestedBy = null;
  dom.nowState.textContent = 'Prêt';
  dom.nowTitle.textContent = 'Choisis un morceau';
  dom.nowArtist.innerHTML = 'La bibliothèque se trouve dans le dossier <code>tracks/</code>';
  dom.nowBadges.textContent = '';
  dom.source.hidden = true;
  dom.cover.style.backgroundImage = '';
  dom.cover.textContent = '';
  dom.seek.value = '0';
  dom.timeCurrent.textContent = formatTime(0);
  dom.timeTotal.textContent = formatTime(0);
  paintNotes(scoreKeys, []);
}

function trackButton(track, position) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'track';
  button.setAttribute('aria-current', String(library.indexOf(track) === currentIndex));

  const tags = [
    track.midiUrl ? '<span class="tag midi">MIDI</span>' : '',
    track.audioUrl ? '<span class="tag audio">Audio</span>' : '',
  ].join('');

  button.innerHTML = `
    <span class="track-index">${position}</span>
    <span class="track-body">
      <span class="track-title"></span>
      <span class="track-artist"></span>
    </span>
    <span class="track-tags">${tags}</span>`;
  button.querySelector('.track-title').textContent = track.title;
  button.querySelector('.track-artist').textContent = track.artist ?? 'Sans interprète';
  button.addEventListener('click', () => selectTrack(library.indexOf(track), true, null));
  return button;
}

function renderList() {
  dom.list.textContent = '';

  if (!filtered.length && !categories.length) {
    dom.empty.hidden = false;
    dom.empty.innerHTML = library.length
      ? 'Aucun morceau ne correspond à ce filtre.'
      : 'Le dossier <code>tracks/</code> est vide.<br />Dépose-y des fichiers <code>.mid</code> ou <code>.mp3</code>, puis clique sur « Actualiser ».';
    return;
  }

  const filtering = dom.search.value.trim() !== '';
  const byCategory = new Map(categories.map((category) => [category.name, []]));
  for (const track of filtered) {
    if (!byCategory.has(track.category)) byCategory.set(track.category, []);
    byCategory.get(track.category).push(track);
  }
  // Pendant un filtrage, une catégorie sans résultat n'a rien à dire.
  const shown = [...byCategory].filter(([, tracks]) => tracks.length || !filtering);

  if (!shown.length) {
    dom.empty.hidden = false;
    dom.empty.innerHTML = 'Aucun morceau ne correspond à ce filtre.';
    return;
  }
  dom.empty.hidden = true;

  const current = library[currentIndex];
  const fragment = document.createDocumentFragment();

  for (const [name, tracks] of shown) {
    // Filtrer déplie tout : sinon les résultats resteraient invisibles.
    const open = filtering || !collapsed.has(name);

    const section = document.createElement('section');
    section.className = 'track-group';
    section.dataset.category = name;
    if (current?.category === name) section.dataset.playing = 'true';

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'group-head';
    head.setAttribute('aria-expanded', String(open));
    head.innerHTML = `${CARET}<span class="group-name"></span><span class="group-count"></span>`;
    head.querySelector('.group-name').textContent = name;
    head.querySelector('.group-count').textContent = filtering
      ? `${tracks.length} / ${library.filter((track) => track.category === name).length}`
      : String(tracks.length);
    head.addEventListener('click', () => toggleCategory(name));

    const panel = document.createElement('div');
    panel.className = 'group-panel';
    const list = document.createElement('ol');
    if (tracks.length) {
      tracks.forEach((track, index) => {
        const item = document.createElement('li');
        item.append(trackButton(track, index + 1));
        const remove = removeButton(track);
        if (remove) {
          item.className = 'track-line';
          item.append(remove);
        }
        list.append(item);
      });
    } else {
      const item = document.createElement('li');
      item.append(categoryHint(name));
      list.append(item);
    }
    panel.append(list);
    // Replié, le contenu sort du parcours au clavier et de la lecture d'écran.
    panel.inert = !open;
    panel.setAttribute('aria-hidden', String(!open));

    section.append(head, panel);
    fragment.append(section);
  }
  dom.list.append(fragment);
}

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

/** Le contexte audio ne peut naître que d'un geste utilisateur. */
async function ensureAudio() {
  if (audioReady) return;
  player = new Player({ useLocalSamples: localSamples });
  driver = new MotionDriver(hub, settings);

  player.addEventListener('play', onPlaybackStarted);
  player.addEventListener('pause', onPlaybackStopped);
  player.addEventListener('stop', onPlaybackStopped);
  player.addEventListener('ended', () => {
    onPlaybackStopped();
    playNext(true);
  });
  player.addEventListener('play', () => publishNow(true));
  player.addEventListener('pause', () => publishNow(true));

  dom.nowState.textContent = 'Chargement du piano…';
  const mode = await player.init((loaded, total) => {
    dom.nowState.textContent = `Chargement du piano… ${Math.round((loaded / total) * 100)} %`;
  });
  player.volume = settings.volume;
  player.setAudioProfile(settings.audioProfile);
  audioReady = true;

  dom.nowState.textContent = 'Prêt';
  // Accès depuis la console du navigateur, pratique pour mettre au point les
  // réglages moteur sans passer par l'interface.
  Object.assign(window.jukebox, { player, driver });
  if (mode === 'synth') {
    toast('Échantillons de piano indisponibles : le synthétiseur de secours prend le relais.', 'info', 6000);
  }
}

/**
 * Charge un morceau.
 *
 * @param {number} index position dans la bibliothèque
 * @param {boolean} autoplay lancer la lecture dans la foulée
 * @param {string|null} by prénom du visiteur qui l'a demandé, s'il y en a un
 */
async function selectTrack(index, autoplay = false, by = requestedBy) {
  if (index < 0 || index >= library.length) return;
  requestedBy = by;
  // Changer de morceau interrompt la mise en route en cours : le chef
  // recommencera sa scène pour celui qu'on vient de choisir.
  warmup.cancel();
  await ensureAudio();

  currentIndex = index;
  const track = library[index];
  // Lancer un morceau déplie sa catégorie : on doit voir ce qui joue.
  if (collapsed.delete(track.category)) persistCollapsed();
  renderList();
  revealCurrent();

  dom.nowTitle.textContent = track.title;
  dom.nowArtist.textContent = track.artist ?? 'Sans interprète';
  dom.cover.style.backgroundImage = track.coverUrl ? `url("${track.coverUrl}")` : coverStyle(track.id, settings.theme);
  dom.cover.textContent = track.coverUrl ? '' : '♪';

  try {
    await player.load(track);
  } catch (error) {
    toast(`Chargement impossible : ${error.message}`, 'error', 6000);
    return;
  }

  dom.timeTotal.textContent = formatTime(player.duration);
  dom.seek.value = '0';
  renderBadges(track);
  renderSourceToggle();
  paintNotes(scoreKeys, []);

  if (autoplay) startPlayback();
}

/**
 * Lance la lecture. Si la mise en route est active, le chef d'orchestre entre
 * d'abord en scène : la musique attend qu'il ait donné le départ.
 */
async function startPlayback() {
  if (!settings.warmup) {
    player.play();
    return;
  }
  dom.nowState.textContent = 'Mise en route…';
  const go = await warmup.run(player);
  // Scène annulée, ou morceau changé entre-temps : on ne lance rien.
  if (!go || !player.track) {
    if (!player.isPlaying) dom.nowState.textContent = 'Prêt';
    return;
  }
  player.play();
}

function renderBadges(track) {
  const midi = player.midi;
  const badges = [];
  // Un prénom laissé sur le téléphone d'un visiteur : c'est le moment où il
  // le voit apparaître sur l'écran du stand.
  if (requestedBy && settings.showNames) badges.push([`demandé par ${requestedBy}`, true]);
  if (player.mode === 'midi') badges.push([player.hasBothSources ? 'Partition transcrite' : 'MIDI synthétisé', true]);
  if (player.mode === 'audio+midi') badges.push(['Enregistrement d’origine', true]);
  if (player.mode === 'audio') badges.push(['Audio seul — rythme déduit du son', false]);
  if (midi) {
    badges.push([`${midi.notes.length} notes`, false]);
    badges.push([`${Math.round(midi.averageBpm)} bpm`, false]);
    badges.push([`${midi.timeSignature.numerator}/${midi.timeSignature.denominator}`, false]);
  }
  dom.nowBadges.textContent = '';
  for (const [label, accent] of badges) {
    const span = document.createElement('span');
    span.className = accent ? 'badge accent' : 'badge';
    span.textContent = label;
    dom.nowBadges.append(span);
  }
}

/**
 * Le bouton qui choisit ce qu'on entend. Il n'apparaît que pour les morceaux
 * qui ont les deux — en pratique, ceux venus d'un lien de plateforme : ailleurs
 * il n'y aurait rien à choisir.
 */
function renderSourceToggle() {
  const both = Boolean(player?.hasBothSources);
  dom.source.hidden = !both;
  if (!both) return;

  const onAudio = player.mode !== 'midi';
  dom.source.setAttribute('aria-pressed', String(onAudio));
  dom.source.firstElementChild.textContent = onAudio ? '🎹' : '🔊';
  dom.sourceLabel.textContent = onAudio ? 'Revenir à la partition' : 'Écouter l’enregistrement';
  dom.source.title = onAudio
    ? 'Repasser au piano joué depuis la partition transcrite'
    : 'Écouter l’extrait d’origine — le piano continue de suivre la partition';
}

function toggleSource() {
  player.setSource(player.mode === 'midi' ? 'audio' : 'midi');
  dom.timeTotal.textContent = formatTime(player.duration);
  renderBadges(player.track);
  renderSourceToggle();
}

/**
 * Une transcription vient de se terminer. Si elle porte sur le morceau qui
 * joue — il tournait donc en audio seul, faute de partition —, on reprend au
 * même endroit, cette fois au piano : c'est ce qu'on était venu entendre.
 */
async function adoptFreshScore(id) {
  // Le lecteur n'existe qu'après le premier geste de l'utilisateur : une
  // transcription peut très bien se terminer avant qu'on ait touché à rien.
  if (!id || player?.track?.id !== id || player.midi) return;
  const index = library.findIndex((item) => item.id === id);
  if (index < 0) return;

  const position = player.currentTime;
  const wasPlaying = player.isPlaying;
  try {
    await player.load(library[index]);
  } catch {
    return; // l'extrait continuait de jouer : mieux vaut ça qu'un silence
  }

  currentIndex = index;
  dom.timeTotal.textContent = formatTime(player.duration);
  renderBadges(library[index]);
  renderSourceToggle();
  if (position > 0.2) player.seek(Math.min(position, player.duration));
  if (wasPlaying) player.play();
  logLine(dom.log, `Partition prête : « ${library[index].title} » passe au piano.`, 'success');
}

function onPlaybackStarted() {
  dom.play.dataset.playing = '1';
  dom.play.setAttribute('aria-label', 'Pause');
  dom.nowState.textContent = 'Lecture';

  const { leader, follower } = duetCurves();
  if (leader && motorAllowed()) {
    driver.attachFollower(secondHub.connected ? secondHub : null);
    driver.start(leader, () => player.currentTime, { followerCurve: follower });
  }

  // Bilan : on note ce qui passe réellement à l'antenne.
  const track = library[currentIndex];
  if (track) {
    tally.played.push({
      title: track.title,
      artist: track.artist,
      at: Date.now(),
      requested: Boolean(requestedBy),
    });
    renderTally();
  }
}

function onPlaybackStopped() {
  dom.play.dataset.playing = '0';
  dom.play.setAttribute('aria-label', 'Lecture');
  dom.nowState.textContent = 'En pause';
  driver?.stop();
  paintNotes(scoreKeys, []);
}

async function togglePlay() {
  await ensureAudio();
  if (currentIndex < 0) {
    if (!library.length) return;
    await playNext(false);
    return;
  }
  // Pendant la mise en route, le bouton abrège l'introduction.
  if (warmup.active) {
    warmup.skip();
    return;
  }
  if (player.isPlaying) player.pause();
  else startPlayback();
}

/**
 * Morceau suivant. Les demandes des visiteurs passent avant tout le reste :
 * c'est le principe même du jukebox. Ce n'est qu'une fois la file vide que
 * l'ordre de lecture (aléatoire, répétition) reprend la main.
 *
 * @param {boolean} auto vrai quand c'est la fin d'un morceau qui appelle
 */
async function playNext(auto = false) {
  if (!library.length) return;

  // Le moteur a assez tourné : on lui laisse le temps de souffler avant
  // d'enchaîner. En dehors du mode borne, `needsRest()` reste faux.
  if (needsRest()) {
    startRest();
    return;
  }

  const entry = await stand.takeNext();
  if (entry) {
    const index = library.findIndex((track) => track.id === entry.id);
    if (index >= 0) {
      await selectTrack(index, true, entry.name ?? null);
      return;
    }
    // Le morceau a disparu du dossier entre-temps : on passe au suivant.
  }

  const index = playlist.next(currentIndex, auto);
  if (index >= 0) selectTrack(index, true, null);
  else if (auto) dom.nowState.textContent = 'Fin de la liste';
}

function playPrevious() {
  if (!library.length) return;
  // Comme sur une platine : au-delà de 3 s, on revient au début du morceau.
  if (player?.isPlaying && player.currentTime > 3) {
    player.seek(0);
    return;
  }
  const index = playlist.previous(currentIndex);
  if (index >= 0) selectTrack(index, true, null);
}

/* ------------------------------------------------------------------ */
/* Le stand : file d'attente, code QR, applaudissements                */
/* ------------------------------------------------------------------ */

/**
 * Publie l'état de lecture pour les téléphones. La cadence est réglée par le
 * module `Stand` : ici on se contente de lui donner la photo du moment.
 */
function publishNow(force = false) {
  const track = library[currentIndex];
  // Le décompte part en secondes restantes, pas en heure d'arrivée : les
  // horloges d'un téléphone et d'un ordinateur ne sont jamais tout à fait les
  // mêmes, et un compte à rebours faux est pire que pas de compte à rebours.
  const rest = Math.round(restRemaining());
  stand.publish(
    track
      ? {
          rest,
          id: track.id,
          title: track.title,
          artist: track.artist,
          state: player?.isPlaying ? 'playing' : 'paused',
          position: player?.currentTime ?? 0,
          duration: player?.duration ?? 0,
          requested: Boolean(requestedBy),
          name: settings.showNames ? requestedBy : null,
        }
      : rest
        // Rien n'est chargé, mais la pause doit tout de même s'afficher.
        ? { id: 'pause', title: '', artist: null, state: 'paused', position: 0, duration: 0, rest }
        : null,
    { force }
  );
}

function renderQueue() {
  const queue = stand.queue;
  dom.queueCount.textContent = queue.length
    ? `${queue.length} demande${queue.length > 1 ? 's' : ''}`
    : 'file vide';
  dom.queueEmpty.hidden = queue.length > 0;
  dom.queueList.textContent = '';

  queue.forEach((entry, index) => {
    const item = document.createElement('li');
    item.dataset.transcribe = entry.transcribe ? '1' : '0';
    item.innerHTML =
      '<span class="rank"></span>' +
      '<span class="label"><b></b><small></small></span>' +
      '<button class="queue-drop" type="button" aria-label="Retirer de la file">✕</button>';
    item.querySelector('.rank').textContent = String(index + 1);
    item.querySelector('b').textContent = entry.title;
    const origin = entry.name && settings.showNames ? `demandé par ${entry.name}` : null;
    const source = entry.source ? `extrait ${entry.source}` : null;
    item.querySelector('small').textContent = [entry.artist ?? entry.category, source, origin]
      .filter(Boolean)
      .join(' · ');
    item.querySelector('.queue-drop').addEventListener('click', () => stand.drop(entry.key));
    dom.queueList.append(item);
  });
}

/**
 * Explique, dans les réglages, où en est la télécommande — et quoi faire si
 * elle n'est pas joignable. Trois cas de figure très différents selon que le
 * site tourne sur un VPS, en local, ou en local derrière un tunnel.
 */
/**
 * L'interrupteur « Mode local ». Trois situations à distinguer, sans quoi on
 * laisse l'utilisateur cocher une case qui ne peut rien faire :
 *   • la machine n'est sur aucun réseau — rien à ouvrir ;
 *   • le serveur a été lancé par `npm run stand` — déjà ouvert, et pas
 *     refermable sans redémarrer ;
 *   • une adresse publique (domaine, tunnel) fait déjà le travail.
 */
function renderLocalSwitch() {
  const local = stand.local ?? {};
  const publicElsewhere = stand.available && !local.enabled;
  const locked = local.pinned || !local.supported || !stand.operator;

  dom.localSwitch.checked = Boolean(local.enabled);
  dom.localSwitch.disabled = locked;
  dom.localField.dataset.locked = locked ? '1' : '0';

  if (local.pinned) {
    dom.localHint.textContent =
      'Déjà ouvert : le serveur a été lancé avec « npm run stand », il écoute sur le réseau depuis le départ. ' +
      'Pour le refermer, relance-le avec « npm start ».';
    return;
  }
  if (!local.supported) {
    dom.localHint.textContent =
      'Indisponible : cette machine n’a aucune adresse sur un réseau local. Connecte-la au Wi‑Fi, puis rouvre les réglages.';
    return;
  }
  if (!stand.operator) {
    dom.localHint.textContent =
      'Réservé au poste du stand : sans le jeton de pilotage, ce poste ne peut pas ouvrir le serveur sur le réseau.';
    return;
  }
  if (local.enabled) {
    dom.localHint.textContent =
      `Ouvert sur http://${local.address}:${local.port} — le téléphone doit être sur le même Wi‑Fi que cet ordinateur. ` +
      'Le jukebox reste sur localhost et garde sa liaison Bluetooth. Décoche pour refermer.';
    return;
  }
  dom.localHint.innerHTML = publicElsewhere
    ? 'Inutile ici&nbsp;: le site est déjà servi par une adresse joignable de l’extérieur, et le code QR y mène. ' +
      'Coche seulement si tu veux forcer le passage par le Wi‑Fi de la maison.'
    : `Ouvre le serveur sur <code>${local.address}:${local.port}</code>, le temps de la démonstration&nbsp;: le code QR ` +
      'mène alors au téléphone posé à côté, sans tunnel ni nom de domaine. Le jukebox, lui, reste sur ' +
      '<code>localhost</code> et garde sa liaison Bluetooth. À n’allumer que sur un réseau de confiance&nbsp;— le ' +
      'dossier des morceaux et toute l’interface deviennent lisibles par le réseau.';
}

function renderStandStatus() {
  const box = dom.standStatus;
  renderLocalSwitch();
  dom.operatorField.hidden = stand.operator;
  box.dataset.ready = stand.available ? '1' : '0';
  if (stand.available) {
    // L'adresse vient de l'en-tête `Host` de la requête : c'est une donnée que
    // l'on n'écrit pas dans du HTML, on la pose en texte.
    box.textContent = 'Télécommande active : ';
    const address = document.createElement('code');
    address.textContent = stand.remoteUrl;
    box.append(
      address,
      stand.local?.enabled
        ? '. Le code QR de la scène y mène directement — à condition que le téléphone soit sur le même Wi‑Fi que cet ordinateur.'
        : '. Le code QR de la scène y mène directement — les visiteurs peuvent rester sur leur forfait mobile.'
    );
    if (!stand.operator) {
      const warning = document.createElement('span');
      warning.innerHTML =
        ' <strong>Ce poste n’a pas le jeton de pilotage</strong> : rouvre le jukebox avec ' +
        '<code>?op=…</code>, le jeton est affiché dans le terminal du serveur.';
      box.append(warning);
    }
    return;
  }
  box.innerHTML =
    'Télécommande éteinte : le serveur ne connaît aucune adresse joignable depuis un téléphone.<br />' +
    '• le téléphone est sur le même Wi‑Fi que cet ordinateur : coche <strong>Mode local</strong>, juste au‑dessus ;<br />' +
    '• sur un serveur avec un nom de domaine, il n’y a rien à faire — ouvre le jukebox par ce nom ;<br />' +
    '• visiteurs en 5G, sur un stand : <code>PUBLIC_URL=https://… npm start</code>, derrière un tunnel.';
}

/**
 * Ce qui empêche le stand de fonctionner, dit là où on le verra : sur la
 * scène, pas au fond du tiroir. Sans jeton de pilotage, par exemple, les
 * demandes des visiteurs s'accumulent sans jamais être jouées — une panne
 * silencieuse qui peut durer toute une journée.
 */
function renderStandAlarm() {
  const alarms = [];
  if (stand.available && !stand.operator) {
    alarms.push(
      'Ce poste n’a pas le jeton de pilotage : les demandes des visiteurs ne seront jamais jouées. ' +
        'Colle le jeton dans Réglages ⚙︎ → Mode borne.'
    );
  }
  if (motorBlocked) {
    alarms.push('Piles trop faibles : le moteur est coupé. Le son continue, les touches ne bougent plus.');
  }
  dom.standAlarm.hidden = alarms.length === 0;
  dom.standAlarm.textContent = alarms.join(' — ');
}

function renderStandPanel() {
  // Le panneau ne s'affiche que s'il a quelque chose à montrer : une adresse
  // à scanner, ou des demandes en attente.
  const useful = stand.available || stand.queue.length > 0 || motorBlocked;
  dom.standPanel.hidden = !useful;

  // Le mode local peut s'éteindre : le code QR d'hier ne mènerait plus nulle
  // part, et l'adresse affichée dessous non plus. On les retire ensemble.
  // (Le sourcil : l'événement « identity » a déjà pu vider `dataset.url`, donc
  // on se fie à `remoteUrl`, pas à la trace du dernier dessin.)
  if (!stand.remoteUrl) {
    stand.renderQr(dom.qr);
    delete dom.qr.dataset.url;
    dom.standUrl.textContent = '';
  }
  if (!useful) return;
  // En mode local, le téléphone DOIT être sur le Wi-Fi : dire l'inverse
  // enverrait les visiteurs scanner un code qui ne s'ouvrira jamais chez eux.
  dom.standSub.textContent = stand.local?.enabled
    ? 'Scanne ce code avec ton téléphone — connecté au même Wi‑Fi que le piano.'
    : 'Scanne ce code avec ton téléphone — pas besoin du Wi‑Fi.';

  if (stand.remoteUrl && dom.qr.dataset.url !== stand.remoteUrl) {
    stand.renderQr(dom.qr);
    dom.qr.dataset.url = stand.remoteUrl;
    dom.standUrl.textContent = stand.remoteUrl;
  }
  dom.qr.hidden = !stand.remoteUrl;
  renderQueue();
  renderStandAlarm();
}

/** Un applaudissement : la LED du hub flashe, l'écran répond. */
function onCheer(total) {
  dom.standCheers.hidden = false;
  dom.cheerTotal.textContent = String(total);
  dom.cheerBurst.dataset.pulse = '1';
  setTimeout(() => { delete dom.cheerBurst.dataset.pulse; }, 460);

  if (!hub.connected) return;
  // Un éclair blanc, puis on rend la LED à qui la pilotait — la chorégraphie
  // la reprendra d'elle-même au prochain cycle si elle tourne.
  hub.setLed(255, 255, 255);
  setTimeout(() => {
    if (hub.connected && !driver?.running) hub.setLed(0, 40, 60);
  }, 220);
}

/** Rend visible la transcription qui tourne en tâche de fond. */
function renderTranscription(message = null, ratio = 0) {
  dom.standWork.hidden = !message;
  if (!message) return;
  dom.standWorkLabel.textContent = message;
  dom.standWorkFill.style.width = `${Math.round(ratio * 100)}%`;
}

function wireRequests() {
  requests.addEventListener('start', (event) => {
    renderTranscription(`Transcription de « ${event.detail.title} »…`, 0);
  });
  requests.addEventListener('progress', (event) => {
    renderTranscription(`Transcription de « ${event.detail.current?.title ?? '' } »… ${Math.round(event.detail.progress * 100)} %`, event.detail.progress);
  });
  requests.addEventListener('done', (event) => {
    renderTranscription(null);
    toast(`« ${event.detail.title} » : ${event.detail.notes} notes transcrites.`, 'success', 5000);
    logLine(dom.log, `Transcription terminée : ${event.detail.title} (${event.detail.notes} notes).`, 'success');
    adoptFreshScore(event.detail.id);
  });
  requests.addEventListener('failed', (event) => {
    renderTranscription(null);
    logLine(dom.log, `Transcription abandonnée : ${event.detail.message}`, 'warn');
  });
  requests.addEventListener('unavailable', () => {
    renderTranscription(null);
    toast(
      'Moteur de transcription absent : les extraits demandés joueront en audio seul. Lance « npm run fetch-transcriber » pour l’installer.',
      'info',
      9000
    );
  });
  requests.addEventListener('idle', () => renderTranscription(null));
}

function wireOperatorField() {
  const apply = async () => {
    const ok = await stand.useOperatorToken(dom.operatorToken.value);
    renderStandStatus();
    renderStandPanel();
    toast(
      ok ? 'Jeton accepté : ce poste pilote le stand.' : 'Jeton refusé. Vérifie ce qu’affiche le terminal du serveur.',
      ok ? 'success' : 'error',
      6000
    );
  };
  dom.localSwitch.addEventListener('change', async () => {
    const wanted = dom.localSwitch.checked;
    dom.localSwitch.disabled = true;
    const { ok, error } = await stand.setLocalMode(wanted);
    renderStandStatus();
    renderStandPanel();
    if (!ok) {
      toast(error, 'error', 7000);
      return;
    }
    toast(
      wanted
        ? `Mode local ouvert : scanne le code QR avec un téléphone du même Wi‑Fi (${stand.local.address}).`
        : 'Mode local refermé : le serveur n’écoute plus que sur cet ordinateur.',
      'success',
      6000
    );
  });

  el('btn-operator').addEventListener('click', apply);
  dom.operatorToken.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      apply();
    }
  });
}

/* ------------------------------------------------------------------ */
/* Coller un lien Apple Music ou Spotify                               */
/* ------------------------------------------------------------------ */

/**
 * Le poste du stand a le même besoin que les visiteurs : ajouter un morceau
 * qui n'est pas dans `tracks/`. La route est donc la même — le serveur
 * reconnaît la plateforme, récupère l'extrait officiel de trente secondes et
 * le range dans « Demandes ». La transcription en partition suit toute seule,
 * portée par la file d'attente.
 *
 * Ici, le jukebox parle en tant qu'opérateur : pas de code de stand à
 * présenter, mais le jeton de pilotage s'il en a un.
 */
function sayLink(message, kind = 'info') {
  dom.linkState.hidden = !message;
  dom.linkState.dataset.kind = kind;
  dom.linkState.textContent = message ?? '';
}

function toggleLinkField(open) {
  const show = open ?? dom.linkForm.hidden;
  dom.linkForm.hidden = !show;
  dom.linkToggle.setAttribute('aria-expanded', show ? 'true' : 'false');
  if (show) dom.linkUrl.focus();
  else sayLink(null);
}

async function submitLink(event) {
  event.preventDefault();
  const value = dom.linkUrl.value.trim();
  if (!value) return;

  dom.linkSend.disabled = true;
  // Résoudre un lien demande deux ou trois allers-retours vers la plateforme :
  // le dire évite qu'on reclique en boucle.
  sayLink('On cherche ce morceau…', 'info');
  try {
    const response = await fetch('/api/stand/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...stand.controlHeaders },
      body: JSON.stringify({ link: value }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      sayLink(data.error ?? 'La demande n’est pas passée.', 'error');
      return;
    }

    const found = data.resolved ?? {};
    const label = `« ${found.title ?? value} »${found.artist ? ` de ${found.artist}` : ''}`;
    sayLink(`${label} est en file — extrait officiel de 30 s (${found.source ?? 'plateforme'}).`, 'success');
    logLine(dom.log, `Lien ajouté à la file : ${label}.`, 'success');
    dom.linkUrl.value = '';

    // L'extrait est sur le disque : la bibliothèque doit le voir, et la
    // transcription peut démarrer sans attendre le prochain événement.
    await loadLibrary();
    requests.pump();
  } catch {
    sayLink('Serveur injoignable. Le jukebox tourne-t-il avec « npm start » ?', 'error');
  } finally {
    dom.linkSend.disabled = false;
  }
}

function wireStand() {
  stand.addEventListener('queue', () => {
    renderStandPanel();
    // Une demande vient d'arriver : on transcrit sans attendre son tour.
    requests.pump();
  });
  stand.addEventListener('cheer', (event) => onCheer(event.detail.total));
  // Le serveur a redémarré, ou changé d'adresse : le code QR affiché doit suivre.
  stand.addEventListener('identity', () => {
    delete dom.qr.dataset.url;
    delete dom.attractQr.dataset.url;
    renderStandStatus();
    renderStandPanel();
    logLine(dom.log, `Identité du stand mise à jour : ${stand.remoteUrl ?? 'télécommande éteinte'}.`, 'warn');
  });
  stand.addEventListener('ready', () => {
    renderStandStatus();
    renderStandPanel();
    if (stand.available) logLine(dom.log, `Télécommande des visiteurs : ${stand.remoteUrl}`, 'success');
  });
  dom.queueClear.addEventListener('click', () => stand.drop('*'));
  stand.init();
}

/* ------------------------------------------------------------------ */
/* Deux pianos                                                         */
/* ------------------------------------------------------------------ */

/**
 * Un second 21323, connecté en plus du premier.
 *
 * Il faut être clair sur ce que « deux pianos » peut vouloir dire ici. Le
 * répertoire à deux pianos existe — Rachmaninov, Poulenc, Lutosławski — mais
 * il ne changerait rien : le modèle n'a qu'un moteur entraînant tout l'arbre à
 * cames, il ondule, il ne joue pas de notes. Deux modèles jouant deux parties
 * écrites donneraient donc… deux ondulations.
 *
 * Ce qui se voit, en revanche, c'est de partager la partition **par registre**.
 * Le piano des graves suit la main gauche : il brasse régulièrement, par
 * vagues lentes. Celui des aigus suit la mélodie : il s'agite, s'arrête, repart.
 * À dix mètres, on lit deux instruments qui se répondent — et ça marche avec
 * n'importe quel morceau, sans partition spéciale.
 *
 * Le second hub n'a pas de pilote à lui : c'est le `MotionDriver` du premier
 * qui lui envoie sa consigne dans le même cycle. Deux minuteurs indépendants se
 * décaleraient, et deux pianos en léger différé font désordre.
 */
const secondHub = new PianoHub();

function wireSecondHub() {
  const pill = el('hub-pill-2');
  const label = el('hub-label-2');
  const connectButton = el('btn-connect-2');
  const disconnectButton = el('btn-disconnect-2');

  secondHub.addEventListener('status', (event) => {
    const { status } = event.detail;
    const connected = status === 'connected';
    pill.hidden = status === 'disconnected';
    pill.dataset.state = status;
    label.textContent = connected ? secondHub.info.name ?? '2ᵉ piano' : status === 'connecting' ? 'Connexion…' : '2ᵉ piano';
    connectButton.hidden = connected;
    disconnectButton.hidden = !connected;
    driver?.attachFollower(connected ? secondHub : null);
    if (connected && secondHub.motorPort === null) {
      toast('Second piano connecté, mais aucun moteur détecté. Câble bien enfoncé ?', 'error', 7000);
    }
  });

  secondHub.addEventListener('log', (event) =>
    logLine(dom.log, `2ᵉ piano — ${event.detail.message}`, event.detail.level)
  );

  connectButton.addEventListener('click', async () => {
    if (!PianoHub.isSupported()) return;
    try {
      await secondHub.connect();
      toast('Second piano connecté.', 'success');
    } catch (error) {
      if (error.name !== 'NotFoundError') toast(error.message, 'error', 7000);
    }
  });
  disconnectButton.addEventListener('click', () => secondHub.disconnect());

  const duet = el('set-duet');
  duet.value = settings.duet;
  duet.addEventListener('change', () => {
    settings.duet = duet.value;
    driver?.update(settings);
    if (duet.value === 'off') secondHub.stopMotor();
    // Passer en « grave/aigu » change la courbe confiée à chaque piano : sans
    // relance, le choix ne prendrait effet qu'au morceau suivant.
    if (driver?.running && player?.isPlaying) {
      const { leader, follower } = duetCurves();
      if (leader) driver.start(leader, () => player.currentTime, { followerCurve: follower });
    }
    saveSettings();
  });
}

/**
 * Courbe confiée au second piano, selon la répartition choisie. En mode
 * « grave/aigu », le premier garde les graves : c'est lui qu'on a réglé, et la
 * main gauche est la partie la plus régulière — donc la plus lisible sur le
 * modèle déjà calibré.
 */
function duetCurves() {
  if (settings.duet !== 'split' || !player?.activityLow) return { leader: player?.activity, follower: null };
  return { leader: player.activityLow, follower: player.activityHigh };
}

/* ------------------------------------------------------------------ */
/* Le capteur comme bouton                                             */
/* ------------------------------------------------------------------ */

/**
 * Le 21323 embarque un capteur de distance, qui voit passer un drapeau à
 * chaque enfoncement de touche. Moteur à l'arrêt, il ne voit plus que ce qu'on
 * lui met devant — une main, par exemple. Il devient alors le bouton le plus
 * naturel du stand : on approche la main du piano, et le piano se met à jouer.
 *
 * Deux précautions, sans lesquelles c'est inutilisable :
 *   • moteur en marche, les touches défilent devant le capteur et déclencheraient
 *     en boucle : on n'arme le déclencheur que lorsque rien ne joue ;
 *   • une main qui reste devant le capteur enverrait des dizaines de mesures :
 *     il faut un front descendant franc, puis un temps mort.
 */
/** En dessous, il y a quelque chose devant le capteur (0 = collé, 10 = rien). */
const HAND_NEAR = 3;
/** Au-dessus, la voie est libre : c'est ce seuil qui réarme le déclencheur. */
const HAND_FAR = 6;
/** Temps mort après un déclenchement. */
const HAND_COOLDOWN = 4000;

let handArmed = true;
let handLastFire = 0;

function wireHandTrigger() {
  hub.addEventListener('sensor', (event) => {
    if (!settings.handTrigger) return;
    if (event.detail.mode !== 0) return; // mode comptage : pas une distance
    const value = event.detail.value;

    if (value >= HAND_FAR) {
      handArmed = true;
      return;
    }
    if (value > HAND_NEAR || !handArmed) return;

    // Front descendant franc : quelque chose vient d'arriver devant le capteur.
    handArmed = false;
    const now = performance.now();
    if (now - handLastFire < HAND_COOLDOWN) return;
    handLastFire = now;
    lastInteraction = now;
    hideAttract();

    // Une main pendant la lecture ne relance rien : ce serait insupportable.
    if (player?.isPlaying || warmup.active || restRemaining() > 0) return;
    logLine(dom.log, 'Main détectée devant le capteur : lecture lancée.');
    playNext(false);
  });
}

/* ------------------------------------------------------------------ */
/* Bilan du stand                                                      */
/* ------------------------------------------------------------------ */

/**
 * Ce que la borne a fait depuis son démarrage. Compté ici, dans la page, et
 * pas sur le serveur : c'est le poste qui joue qui sait ce qui est réellement
 * sorti des haut-parleurs, et combien de temps.
 *
 * Rien n'est envoyé nulle part. Le bilan sert à répondre, le lundi matin, à la
 * question « ça a servi à quoi, ce stand ? ».
 */
const tally = {
  startedAt: Date.now(),
  /** @type {Array<{title:string, artist:string|null, at:number, requested:boolean}>} */
  played: [],
  /** Secondes réellement jouées. */
  seconds: 0,
  /** Secondes de moteur cumulées depuis le démarrage. */
  motorSeconds: 0,
};

function renderTally() {
  const rows = [
    ['Depuis', new Date(tally.startedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })],
    ['Morceaux joués', String(tally.played.length)],
    ['Demandés par un visiteur', String(tally.played.filter((entry) => entry.requested).length)],
    ['Temps d’antenne', formatDuration(tally.seconds)],
    ['Moteur en marche', formatDuration(tally.motorSeconds)],
    ['Applaudissements', String(stand.cheers)],
    ['En file', String(stand.queue.length)],
  ];
  dom.tally.textContent = '';
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dom.tally.append(dt, dd);
  }
}

/** 3725 → « 1 h 02 min ». */
function formatDuration(seconds) {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours) return `${hours} h ${String(minutes).padStart(2, '0')} min`;
  if (minutes) return `${minutes} min ${String(total % 60).padStart(2, '0')} s`;
  return `${total} s`;
}

function tallySnapshot() {
  return {
    profil: settings.venue,
    demarre: new Date(tally.startedAt).toISOString(),
    duree: formatDuration((Date.now() - tally.startedAt) / 1000),
    morceauxJoues: tally.played.length,
    demandesVisiteurs: tally.played.filter((entry) => entry.requested).length,
    tempsAntenne: formatDuration(tally.seconds),
    moteurEnMarche: formatDuration(tally.motorSeconds),
    applaudissements: stand.cheers,
    journal: tally.played.map((entry) => ({
      heure: new Date(entry.at).toLocaleTimeString('fr-FR'),
      titre: entry.title,
      artiste: entry.artist,
      demande: entry.requested,
    })),
  };
}

function wireTally() {
  renderTally();

  el('btn-tally-copy').addEventListener('click', async () => {
    const snapshot = tallySnapshot();
    const lines = [
      `Bilan du stand — profil ${snapshot.profil}`,
      `Depuis ${new Date(tally.startedAt).toLocaleString('fr-FR')} (${snapshot.duree})`,
      `${snapshot.morceauxJoues} morceaux joués, dont ${snapshot.demandesVisiteurs} demandés par un visiteur`,
      `Temps d’antenne : ${snapshot.tempsAntenne} · moteur : ${snapshot.moteurEnMarche}`,
      `Applaudissements : ${snapshot.applaudissements}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast('Bilan copié.', 'success');
    } catch {
      toast('Le presse-papiers a été refusé. Enregistre le bilan en JSON.', 'error', 6000);
    }
  });

  el('btn-tally-save').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(tallySnapshot(), null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `bilan-stand-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  });
}

/* ------------------------------------------------------------------ */
/* Chien de garde                                                      */
/* ------------------------------------------------------------------ */

/** Horodatage de la dernière image rendue, relevé par la boucle d'affichage. */
let lastFrameStamp = performance.now();
/** Position de lecture au dernier passage du chien de garde, et son instant. */
let watchdogTime = -1;
let watchdogAt = 0;

/**
 * Une borne qui tourne neuf heures par jour finit par rencontrer ce qu'un
 * développeur ne voit jamais en dix minutes de test : une boucle d'affichage
 * arrêtée par une exception, un élément `<audio>` qui se fige, un contexte
 * audio suspendu par le système. Ce minuteur vit en dehors de la boucle
 * d'affichage — c'est la condition pour pouvoir constater sa mort.
 *
 * Il n'agit qu'en mode borne : ailleurs, un rechargement automatique serait
 * une agression pour qui met au point ses réglages.
 */
function startWatchdog() {
  setInterval(() => {
    if (!settings.kiosk) return;
    // Un onglet en arrière-plan ne reçoit plus d'images : ce n'est pas une panne.
    if (document.visibilityState !== 'visible') return;

    const now = performance.now();
    if (now - lastFrameStamp > 30000) {
      logLine(dom.log, 'Boucle d’affichage arrêtée depuis 30 s — rechargement.', 'error');
      window.location.reload();
      return;
    }

    // Lecture annoncée mais position figée : le son est mort sans le dire.
    if (player?.isPlaying && !warmup.active) {
      const time = player.currentTime;
      if (watchdogTime >= 0 && Math.abs(time - watchdogTime) < 0.05) {
        if (now - watchdogAt > 10000) {
          logLine(dom.log, 'Lecture figée : on passe au morceau suivant.', 'warn');
          watchdogTime = -1;
          player.pause();
          playNext(true);
          return;
        }
      } else {
        watchdogTime = time;
        watchdogAt = now;
      }
    } else {
      watchdogTime = -1;
    }
  }, 5000);
}

/* ------------------------------------------------------------------ */
/* Profils de borne : portes ouvertes, salon                           */
/* ------------------------------------------------------------------ */

/**
 * Les deux situations n'ont presque rien en commun, et c'est ce qui justifie
 * un profil plutôt qu'un réglage de plus :
 *
 *   Portes ouvertes — une demi-journée, dans une salle de cours, avec des
 *   étudiants derrière la table. On explique, on fait essayer, on répond aux
 *   questions. L'écran est un support de conversation.
 *
 *   Salon — trois à cinq jours, dans un hall où deux cents exposants se
 *   disputent le regard. Le stand est parfois vide, le bruit couvre le piano,
 *   le réseau sature, l'ordinateur veut s'endormir et le moteur tourne neuf
 *   heures par jour. L'écran doit se voir de loin, se défendre tout seul, et
 *   durer.
 *
 * Choisir un profil pose ces réglages-là ; chacun reste ensuite modifiable.
 */
const VENUE_PROFILES = {
  jpo: {
    label: 'portes ouvertes',
    audioProfile: 'salle',
    handTrigger: true,
    attractTop: false,
    attractDelay: 0,
    keepAwake: true,
    restMotor: false,
    showNames: true,
    resumeDelay: 25,
  },
  salon: {
    label: 'salon',
    audioProfile: 'hall',
    handTrigger: true,
    attractTop: true,
    // Une minute sans personne, et l'affiche prend l'écran.
    attractDelay: 60,
    keepAwake: true,
    restMotor: true,
    // Personne ne surveille l'écran en permanence : on n'affiche pas de texte
    // saisi par le public.
    showNames: false,
    resumeDelay: 15,
  },
};

/** Durée d'une pause de service, en secondes. */
const REST_SECONDS = 45;
/** En dessous de cette charge, le moteur cale et bourdonne : on le coupe. */
const BATTERY_FLOOR = 8;

/** Temps de moteur cumulé depuis la dernière pause, en secondes. */
let motorSeconds = 0;
/** Fin de la pause de service en cours (horloge `performance.now()`). */
let restingUntil = 0;
/** Dernier geste de l'utilisateur, pour l'écran d'appel. */
let lastInteraction = performance.now();
/** Verrou moteur, posé quand les piles sont trop faibles. */
let motorBlocked = false;

function applyVenue(name, { preset = true } = {}) {
  const profile = VENUE_PROFILES[name] ?? VENUE_PROFILES.jpo;
  settings.venue = VENUE_PROFILES[name] ? name : 'jpo';

  if (preset) {
    // Le verrouillage n'est jamais posé par un profil : il faut un code, et
    // un geste délibéré. On prépare seulement le code s'il manque.
    for (const key of ['attractDelay', 'keepAwake', 'restMotor', 'showNames', 'resumeDelay', 'audioProfile', 'handTrigger', 'attractTop']) {
      settings[key] = profile[key];
    }
    if (settings.venue === 'salon' && !settings.lockCode) {
      settings.lockCode = String(Math.floor(1000 + Math.random() * 9000));
    }
  }

  for (const input of document.querySelectorAll('input[name="venue"]')) {
    input.checked = input.value === settings.venue;
  }
  syncVenueControls();
  applyKeepAwake(settings.keepAwake);
  player?.setAudioProfile(settings.audioProfile);
  saveSettings();
}

/** Remet les curseurs et cases du panneau en accord avec les réglages. */
function syncVenueControls() {
  el('set-attractDelay').value = String(settings.attractDelay);
  el('out-attractDelay').textContent = settings.attractDelay ? `${settings.attractDelay} s` : 'jamais';
  el('set-restEvery').value = String(settings.restEvery);
  el('out-restEvery').textContent = `${settings.restEvery} min`;
  el('set-resumeDelay').value = String(settings.resumeDelay);
  el('out-resumeDelay').textContent = `${settings.resumeDelay} s`;
  el('set-keepAwake').checked = Boolean(settings.keepAwake);
  el('set-restMotor').checked = Boolean(settings.restMotor);
  el('set-showNames').checked = Boolean(settings.showNames);
  el('set-lock').checked = Boolean(settings.lock);
  el('set-lockCode').value = settings.lockCode ?? '';
  el('set-audioProfile').value = settings.audioProfile;
  el('set-handTrigger').checked = Boolean(settings.handTrigger);
  el('set-attractTop').checked = Boolean(settings.attractTop);
}

/* ------------------------------------------------------------------ */
/* Veille de l'écran                                                   */
/* ------------------------------------------------------------------ */

/**
 * Un ordinateur laissé seul éteint son écran au bout de dix minutes. Sur un
 * stand, c'est la borne qui disparaît. Le verrou d'activation le lui interdit
 * — et il faut le reprendre à chaque retour d'onglet, le navigateur le
 * relâchant dès que la page passe en arrière-plan.
 */
let wakeLock = null;

async function applyKeepAwake(on) {
  settings.keepAwake = on;
  if (!on) {
    try {
      await wakeLock?.release();
    } catch { /* déjà relâché */ }
    wakeLock = null;
    return;
  }
  if (!('wakeLock' in navigator) || wakeLock || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    // Refusé (onglet en arrière-plan, batterie faible) : on retentera au
    // prochain retour au premier plan.
    wakeLock = null;
  }
}

/* ------------------------------------------------------------------ */
/* Écran d'appel                                                       */
/* ------------------------------------------------------------------ */

/**
 * L'affiche qui prend l'écran quand personne ne touche à rien. Elle ne coupe
 * ni la musique ni le moteur : le piano continue de jouer derrière, ce qui est
 * précisément ce qu'on veut montrer.
 */
/** Le texte de l'affiche, tel que le stand a voulu l'écrire. */
function renderAttractWords() {
  if (settings.attractTitle) dom.attractTitle.textContent = settings.attractTitle;
  if (settings.attractSub) dom.attractSub.textContent = settings.attractSub;
}

/**
 * Les trois morceaux les plus demandés depuis le début de la journée.
 *
 * C'est de la preuve sociale, et elle marche : dans un hall, voir que
 * quarante personnes ont déjà choisi quelque chose donne envie de choisir à
 * son tour. Il faut au moins trois écoutes pour que le classement veuille dire
 * quelque chose — avant, il ne dit que le hasard des premiers passages.
 */
function renderAttractTop() {
  if (!settings.attractTop || tally.played.length < 3) {
    dom.attractTop.hidden = true;
    return;
  }
  const counts = new Map();
  for (const entry of tally.played) {
    const key = entry.title;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const best = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (best[0][1] < 2) {
    // Aucun morceau n'est repassé : un « classement » de trois ex æquo à une
    // écoute n'apprendrait rien à personne.
    dom.attractTop.hidden = true;
    return;
  }

  dom.attractTop.textContent = '';
  for (const [title, count] of best) {
    const item = document.createElement('li');
    item.innerHTML = '<span class="attract-top-title"></span><span class="attract-top-count"></span>';
    item.querySelector('.attract-top-title').textContent = title;
    item.querySelector('.attract-top-count').textContent = `${count}×`;
    dom.attractTop.append(item);
  }
  dom.attractTop.hidden = false;
}

function showAttract() {
  if (!dom.attract.hidden) return;
  dom.attract.dataset.remote = stand.available ? '1' : '0';
  if (stand.available && dom.attractQr.dataset.url !== stand.remoteUrl) {
    stand.renderQr(dom.attractQr);
    dom.attractQr.dataset.url = stand.remoteUrl;
    dom.attractUrl.textContent = stand.remoteUrl;
  }
  renderAttractWords();
  renderAttractTop();
  dom.attract.hidden = false;
}

function hideAttract() {
  if (dom.attract.hidden) return;
  dom.attract.hidden = true;
}

function watchAttract(now) {
  const delay = settings.attractDelay;
  if (!settings.kiosk || !delay) {
    hideAttract();
    return;
  }
  // Une scène en cours ou un panneau ouvert compte comme une présence.
  if (warmup.active || reader.isOpen || !dom.drawer.hidden || !dom.unlock.hidden) {
    lastInteraction = now;
    hideAttract();
    return;
  }
  if (now - lastInteraction < delay * 1000) {
    hideAttract();
    return;
  }
  showAttract();

  // Pendant une pause de service, c'est elle qu'il faut lire sur l'affiche :
  // un visiteur qui arrive à cet instant-là doit comprendre le silence.
  const resting = restRemaining(now) > 0;
  const track = library[currentIndex];
  const playing = Boolean(track && player?.isPlaying);
  dom.attractRest.hidden = !resting;
  dom.attractNow.hidden = resting || !playing;
  if (resting) dom.attractTop.hidden = true;
  if (!resting && playing) {
    dom.attractNowTitle.textContent = track.title;
    dom.attractNowArtist.textContent = track.artist ?? '';
  }
}

/* ------------------------------------------------------------------ */
/* Verrouillage                                                        */
/* ------------------------------------------------------------------ */

/**
 * Verrouillée, la borne ne fait plus que jouer : ni réglages, ni guide, ni
 * raccourcis. C'est ce qui permet de laisser la table sans surveillance dans
 * un hall — le piano continue, et personne ne peut ouvrir la console LWP3
 * pour voir ce qui se passe si on envoie une trame au hasard.
 */
function applyLock(on) {
  if (on && !/^\d{4}$/.test(settings.lockCode ?? '')) {
    toast('Choisis d’abord un code à quatre chiffres.', 'error', 5000);
    el('set-lock').checked = false;
    return;
  }
  settings.lock = on;
  if (on) {
    document.documentElement.dataset.locked = '1';
    openDrawer(false);
    toast(`Interface verrouillée. Ctrl+Maj+U pour reprendre la main (code ${settings.lockCode}).`, 'info', 9000);
  } else {
    delete document.documentElement.dataset.locked;
  }
  el('set-lock').checked = on;
  saveSettings();
}

function askUnlock() {
  if (!settings.lock) return;
  dom.unlock.hidden = false;
  dom.unlockError.hidden = true;
  dom.unlockCode.value = '';
  dom.unlockCode.focus();
}

function closeUnlock() {
  dom.unlock.hidden = true;
}

function wireLock() {
  dom.unlockForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (dom.unlockCode.value === settings.lockCode) {
      closeUnlock();
      applyLock(false);
      return;
    }
    dom.unlockError.hidden = false;
    dom.unlockCode.value = '';
    dom.unlockCode.focus();
  });
  el('unlock-cancel').addEventListener('click', closeUnlock);
}

/* ------------------------------------------------------------------ */
/* Ménagement du moteur et des piles                                   */
/* ------------------------------------------------------------------ */

/** Compte le temps pendant lequel le moteur a réellement tourné. */
function accumulateMotor(dt) {
  if (driver?.running && driver.power !== 0) motorSeconds += dt;
}

/** Le moteur a-t-il le droit de tourner ? Les piles ont le dernier mot. */
function motorAllowed() {
  return !motorBlocked;
}

/**
 * Sous une certaine charge, un moteur Powered Up ne développe plus assez de
 * couple pour entraîner l'arbre à cames : il cale et bourdonne. Mieux vaut
 * l'arrêter franchement et le dire, que laisser un piano qui grogne devant
 * les visiteurs.
 */
function checkBattery(level) {
  const low = level <= BATTERY_FLOOR;
  if (low === motorBlocked) return;
  motorBlocked = low;
  if (low) {
    // La mise en route fait tourner le moteur elle aussi : elle s'arrête net.
    warmup.cancel();
    driver?.stop();
    hub.stopMotor();
    toast('Piles trop faibles : le moteur est coupé pour ne pas caler. Change les piles.', 'error', 12000);
    logLine(dom.log, `Moteur coupé : charge à ${level} %.`, 'error');
  } else {
    logLine(dom.log, 'Charge revenue à un niveau utilisable : moteur réautorisé.', 'success');
  }
  renderStandAlarm();
}

/** Faut-il marquer une pause de service avant le prochain morceau ? */
function needsRest() {
  return settings.kiosk && settings.restMotor && motorSeconds >= settings.restEvery * 60;
}

function startRest() {
  motorSeconds = 0;
  restingUntil = performance.now() + REST_SECONDS * 1000;
  driver?.stop();
  dom.nowState.textContent = 'Pause de service';
  dom.restText.textContent =
    `Le moteur a tourné ${settings.restEvery} minutes sans s’arrêter. Il refroidit pour garder ` +
    'toute sa force — la musique reprend dans un instant, toute seule.';
  logLine(dom.log, `Pause de service de ${REST_SECONDS} s après ${settings.restEvery} min de moteur.`);
  // La pause est publiée tout de suite : les téléphones ne doivent pas rester
  // deux secondes devant un piano muet sans savoir pourquoi.
  publishNow(true);
}

/** Secondes restantes avant la reprise, 0 si aucune pause n'est en cours. */
function restRemaining(now = performance.now()) {
  return restingUntil > now ? (restingUntil - now) / 1000 : 0;
}

/**
 * Affiche le décompte de la pause. C'est lui qui fait toute la différence :
 * un message seul laisse penser à une panne, un décompte fait patienter.
 */
function renderRest(now) {
  const remaining = restRemaining(now);
  const active = remaining > 0;

  // On ne touche au DOM que lorsque l'état change réellement.
  if (dom.rest.hidden !== !active) {
    dom.rest.hidden = !active;
    // Sortie de pause : la scène reprend son affichage normal.
    if (!active && dom.nowState.textContent === 'Pause de service') {
      dom.nowState.textContent = player?.isPlaying ? 'Lecture' : 'Prêt';
    }
  }
  if (!active) {
    dom.attractRest.hidden = true;
    return;
  }

  const seconds = Math.ceil(remaining);
  if (dom.restCount.textContent !== String(seconds)) {
    dom.restCount.textContent = String(seconds);
    dom.attractRestText.textContent = `Reprise dans ${seconds} s`;
  }
  // Le cadran se vide au fil de la pause : 194.8 = 2 × π × 31, son périmètre.
  dom.restDial.style.strokeDashoffset = String(194.8 * (1 - remaining / REST_SECONDS));
}

/* ------------------------------------------------------------------ */
/* Mode stand                                                          */
/* ------------------------------------------------------------------ */

/**
 * Le mode stand transforme le jukebox en borne : plein écran, bibliothèque
 * masquée, lecture qui ne s'arrête jamais. C'est l'état dans lequel on laisse
 * la machine pendant une journée portes ouvertes, quand personne n'est
 * derrière le clavier.
 */
function applyKiosk(on) {
  settings.kiosk = on;
  if (on) document.documentElement.dataset.kiosk = '1';
  else delete document.documentElement.dataset.kiosk;
  dom.standButton.setAttribute('aria-pressed', String(on));
  el('set-kiosk').checked = on;
  silentSince = performance.now();

  if (on) {
    // Enchaînement continu : sans cela, la borne se tait au bout de la liste.
    setRepeat('all');
    document.documentElement.requestFullscreen?.().catch(() => {
      toast('Le plein écran a été refusé. Appuie sur F11 pour l’activer à la main.', 'info', 6000);
    });
  } else if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
  saveSettings();
}

/**
 * Reprise automatique : en mode stand, un silence prolongé relance la
 * musique. C'est le filet qui évite qu'un morceau interrompu par une fausse
 * manœuvre laisse la table muette pour le reste de l'après-midi.
 */
function watchSilence(now) {
  if (!settings.kiosk || !audioReady || !library.length) {
    silentSince = now;
    return;
  }
  // Pause de service en cours : c'est un silence voulu, pas une panne.
  if (now < restingUntil) {
    silentSince = now;
    return;
  }
  if (player?.isPlaying || warmup.active || reader.isOpen || playable.active) {
    silentSince = now;
    return;
  }
  if (now - silentSince < settings.resumeDelay * 1000) return;
  silentSince = now;
  playNext(false);
}

/* ------------------------------------------------------------------ */
/* Clavier jouable                                                     */
/* ------------------------------------------------------------------ */

/**
 * Quand un visiteur joue lui-même et qu'aucun morceau ne tourne, c'est son jeu
 * qui pilote l'arbre à cames : on démarre le pilote moteur sur la courbe
 * d'activité du clavier, exactement comme on le ferait pour une partition.
 */
function setPlayable(on) {
  settings.playable = on;
  playable.setEnabled(on);
  dom.playable.setAttribute('aria-pressed', String(on));
  dom.playableHint.hidden = !on;
  el('set-playable').checked = on;
  if (!on && driver?.running && !player?.isPlaying) driver.stop();
  saveSettings();
}

function wirePlayable() {
  playable.addEventListener('note', async () => {
    await ensureAudio();
    // Un morceau en cours garde la main sur le moteur : deux consignes
    // concurrentes feraient hoqueter l'arbre à cames.
    if (player?.isPlaying || warmup.active) return;
    if (!driver.running) driver.start(playable, () => performance.now() / 1000);
    silentSince = performance.now();
  });
}

/** Coupe le pilote moteur quand le visiteur a fini de jouer. */
function watchPlayable() {
  if (!playable.enabled || !driver?.running) return;
  if (player?.isPlaying || warmup.active) return;
  if (!playable.active) driver.stop();
}

/* ------------------------------------------------------------------ */
/* Boucle d'affichage                                                  */
/* ------------------------------------------------------------------ */

let lastFrame = performance.now();

function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  warmup.tick(now);

  if (warmup.active) {
    // Pendant la mise en route, c'est la réponse du piano qui s'affiche.
    paintNotes(scoreKeys, warmup.sounding);
    dom.vizNotes.textContent = warmup.sounding.length ? 'le piano répond' : 'mise en route';
  } else if (playable.enabled && !player?.isPlaying) {
    // Personne ne joue de morceau : le clavier appartient au visiteur.
    const touched = playable.sounding;
    paintNotes(scoreKeys, touched);
    dom.vizNotes.textContent = touched.length ? `${touched.length} note${touched.length > 1 ? 's' : ''} jouée${touched.length > 1 ? 's' : ''}` : 'à toi de jouer';
  } else if (player?.track) {
    const time = player.currentTime;
    if (!seeking) {
      dom.seek.value = String(player.duration ? Math.round((time / player.duration) * 1000) : 0);
      dom.timeCurrent.textContent = formatTime(time);
    }
    const sounding = player.isPlaying ? player.soundingNotes(time) : [];
    paintNotes(scoreKeys, sounding);
    dom.vizNotes.textContent = sounding.length
      ? `${sounding.length} note${sounding.length > 1 ? 's' : ''}`
      : player.midi ? '—' : 'pas de partition';
  }

  const power = warmup.active ? warmup.power : driver?.running ? driver.power : 0;
  camshaft.update(power, dt);
  dom.powerFill.style.width = `${Math.abs(power)}%`;
  const second = secondHub.connected && driver?.running ? driver.followerPower : null;
  dom.vizPower.textContent = power
    ? `Moteur ${Math.abs(power)} %${second === null ? '' : ` · 2ᵉ piano ${Math.abs(second)} %`}`
    : 'Moteur à l’arrêt';

  lastFrameStamp = now;
  accumulateMotor(dt);
  if (player?.isPlaying) tally.seconds += dt;
  if (driver?.running && driver.power !== 0) tally.motorSeconds += dt;

  watchPlayable();
  renderRest(now);
  watchSilence(now);
  watchAttract(now);
  publishNow();

  geek.update(now);
  // Le second écran suit l'horloge de cette fenêtre-ci, quelle que soit celle
  // qui déclenche le rafraîchissement.
  screenPanel?.update(now);

  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ */
/* Bluetooth                                                           */
/* ------------------------------------------------------------------ */

function wireHub() {
  hub.addEventListener('status', (event) => {
    const { status, name, attempt } = event.detail;
    dom.hubPill.dataset.state = status;
    if (status === 'connected') {
      dom.hubLabel.textContent = hub.info.name ?? name ?? 'Piano connecté';
      dom.connect.textContent = 'Connecté';
      dom.connect.disabled = true;
    } else if (status === 'connecting') {
      dom.hubLabel.textContent = 'Connexion…';
      dom.connect.disabled = true;
    } else if (status === 'reconnecting') {
      dom.hubLabel.textContent = `Reconnexion… (${attempt})`;
      dom.connect.disabled = true;
    } else {
      dom.hubLabel.textContent = 'Piano déconnecté';
      dom.hubBattery.hidden = true;
      dom.connect.textContent = 'Connecter le piano';
      dom.connect.disabled = false;
    }
  });

  hub.addEventListener('info', () => {
    if (hub.connected && hub.info.name) dom.hubLabel.textContent = hub.info.name;
  });

  // Le hub renvoie sa charge en continu : sans mémoire, l'avertissement de
  // piles faibles reviendrait toutes les quelques secondes pendant des heures.
  let batteryWarned = false;
  hub.addEventListener('battery', (event) => {
    const level = event.detail.level;
    dom.hubBattery.hidden = false;
    dom.hubBattery.textContent = `${level} %`;
    dom.hubBattery.dataset.low = level < 15 ? '1' : '0';
    checkBattery(level);
    if (level < 15 && !batteryWarned) {
      batteryWarned = true;
      toast('Les piles du piano sont presque vides — prévois-en de rechange.', 'info', 8000);
    }
    if (level > 20) batteryWarned = false;
  });

  hub.addEventListener('log', (event) => logLine(dom.log, event.detail.message, event.detail.level));

  hub.addEventListener('button', (event) => {
    if (event.detail.pressed) logLine(dom.log, 'Bouton du hub pressé.');
  });
}

async function connectHub() {
  try {
    await hub.connect();
    toast('Piano connecté.', 'success');
    if (hub.motorPort === null) {
      toast('Aucun moteur détecté. Le hub est-il bien celui du piano, câbles branchés ?', 'error', 7000);
    }
  } catch (error) {
    if (error.name === 'NotFoundError') {
      logLine(dom.log, 'Aucun appareil sélectionné.', 'warn');
      toast('Aucun piano sélectionné. Le hub clignote-t-il en blanc ? Voir le guide (bouton 📖).', 'info', 7000);
      return;
    }
    toast(error.message, 'error', 7000);
    logLine(dom.log, error.message, 'error');
  }
}

/* ------------------------------------------------------------------ */
/* Interface                                                           */
/* ------------------------------------------------------------------ */

function openDrawer(open) {
  dom.drawer.hidden = !open;
  dom.scrim.hidden = !open;
}

function wireUi() {
  dom.connect.addEventListener('click', connectHub);

  dom.play.addEventListener('click', togglePlay);
  dom.next.addEventListener('click', () => playNext());
  dom.prev.addEventListener('click', playPrevious);
  dom.shuffle.addEventListener('click', () => setShuffle(!settings.shuffle));
  dom.repeat.addEventListener('click', () => setRepeat(playlist.cycleRepeat()));
  dom.playable.addEventListener('click', () => setPlayable(!settings.playable));
  dom.standButton.addEventListener('click', () => applyKiosk(!settings.kiosk));

  // Sortir du plein écran (Échap, ou la barre du navigateur) sort du mode stand :
  // laisser la case cochée sans plein écran serait mensonger.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && settings.kiosk) applyKiosk(false);
  });

  dom.seek.addEventListener('pointerdown', () => { seeking = true; });
  const commitSeek = () => {
    // `change` arrive aussi quand on déplace le curseur au clavier, sans qu'un
    // pointeur soit jamais descendu : on valide dans les deux cas.
    if (!player?.track) return;
    seeking = false;
    player.seek((Number(dom.seek.value) / 1000) * player.duration);
  };
  dom.seek.addEventListener('pointerup', commitSeek);
  dom.seek.addEventListener('change', commitSeek);
  dom.seek.addEventListener('input', () => {
    if (player?.duration) dom.timeCurrent.textContent = formatTime((Number(dom.seek.value) / 1000) * player.duration);
  });

  dom.search.addEventListener('input', applyFilter);
  dom.refresh.addEventListener('click', loadLibrary);

  dom.source.addEventListener('click', toggleSource);

  dom.linkToggle.addEventListener('click', () => toggleLinkField());
  dom.linkForm.addEventListener('submit', submitLink);
  dom.linkUrl.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') toggleLinkField(false);
  });

  dom.guide.addEventListener('click', () => reader.open('guide.md'));
  dom.openSettings.addEventListener('click', () => openDrawer(true));
  dom.closeSettings.addEventListener('click', () => openDrawer(false));
  dom.scrim.addEventListener('click', () => openDrawer(false));

  document.addEventListener('keydown', (event) => {
    // `event.target` n'est pas toujours un élément (document, fenêtre) :
    // on teste prudemment avant d'appeler matches().
    const target = event.target;
    if (target instanceof Element && target.matches('input, textarea, select')) return;

    // Reprendre la main sur une borne verrouillée : la seule combinaison qui
    // passe encore, et elle demande le code.
    if (event.code === 'KeyU' && event.ctrlKey && event.shiftKey) {
      event.preventDefault();
      askUnlock();
      return;
    }
    // Verrouillée, la borne ne joue plus que de la musique.
    if (settings.lock) return;
    // Le lecteur est modal : il gère lui-même Échap, et rien d'autre ne passe.
    if (reader.isOpen) return;
    if (event.key === '?') {
      event.preventDefault();
      reader.open('guide.md');
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      togglePlay();
      return;
    }
    if (event.code === 'Escape') {
      if (warmup.active) {
        warmup.cancel();
        return;
      }
      openDrawer(false);
      return;
    }
    if (event.code === 'ArrowRight' && event.shiftKey) {
      playNext();
      return;
    }
    if (event.code === 'ArrowLeft' && event.shiftKey) {
      playPrevious();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    // P bascule le clavier jouable, et reste toujours disponible : c'est la
    // sortie de secours. Les autres raccourcis d'une seule lettre se taisent
    // pendant qu'on joue, sinon un visiteur qui cherche un sol déclencherait
    // le mode stand ou la télémétrie.
    if (event.code === 'KeyP') {
      setPlayable(!settings.playable);
      return;
    }
    if (playable.enabled) return;

    if (event.code === 'KeyG') toggleGeek();
    else if (event.code === 'KeyA') setShuffle(!settings.shuffle);
    else if (event.code === 'KeyR') setRepeat(playlist.cycleRepeat());
    else if (event.code === 'KeyS') applyKiosk(!settings.kiosk);
  });

  // Le moindre geste repousse l'écran d'appel — et le fait disparaître s'il
  // est déjà là. En capture, pour être prévenu avant que l'affiche n'avale
  // l'événement.
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
    document.addEventListener(
      type,
      () => {
        lastInteraction = performance.now();
        // On efface tout de suite plutôt que d'attendre la prochaine image :
        // une affiche qui met un instant à s'effacer donne l'impression d'un
        // écran figé, exactement ce qu'on cherche à éviter.
        hideAttract();
      },
      { capture: true, passive: true }
    );
  }

  // Le verrou d'activation se relâche dès que l'onglet passe derrière : il
  // faut le redemander en revenant, sinon l'écran s'éteindra plus tard.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && settings.keepAwake) applyKeepAwake(true);
  });

  el('btn-print').addEventListener('click', () => {
    if (!stand.available) {
      toast('La télécommande n’est pas joignable : la fiche n’aurait pas de code QR à porter.', 'error', 6000);
      return;
    }
    window.open('/print', 'jukebox-print');
  });

  // Filet de sécurité : on ne laisse jamais le moteur tourner sans surveillance,
  // ni un second écran orphelin derrière soi.
  const panic = () => {
    warmup.cancel();
    playable.releaseAll();
    driver?.stop();
    hub.stopMotor();
    secondHub.stopMotor();
    secondScreen?.close();
    // Le stand doit savoir que le jukebox s'en va : sans cela, les téléphones
    // continueraient d'afficher un morceau qui ne joue plus.
    stand.publish(null, { force: true });
  };
  window.addEventListener('pagehide', panic);
  window.addEventListener('beforeunload', panic);
}

/* ------------------------------------------------------------------ */

function boot() {
  if (!PianoHub.isSupported()) {
    dom.connect.disabled = true;
    dom.hubLabel.textContent = 'Bluetooth indisponible';
    toast(
      'Ce navigateur ne prend pas en charge le Web Bluetooth. Ouvre la page dans Chrome ou Edge pour piloter le piano — la musique, elle, fonctionne partout.',
      'error',
      9000
    );
  }
  // Accès depuis la console du navigateur dès le chargement : le lecteur s'y
  // ajoute plus tard, quand le contexte audio est créé.
  window.jukebox = { hub, secondHub, settings, geek, stand, requests, playlist, tally, attachScreen, driver: null, player: null };

  geek.mount();
  bindThemeControls();
  bindSettingsControls();
  setShuffle(Boolean(settings.shuffle));
  setRepeat(REPEAT_LABELS[settings.repeat] ? settings.repeat : 'off');
  setPlayable(Boolean(settings.playable));
  // Le profil est relu tel quel : on n'écrase pas les réglages affinés hier.
  applyVenue(settings.venue, { preset: false });
  wireHub();
  wireUi();
  wirePlayable();
  wireSecondHub();
  wireHandTrigger();
  wireRequests();
  wireLock();
  wireTally();
  wireOperatorField();
  wireStand();
  wireHubTools({
    hub,
    toast,
    settings,
    saveSettings,
    // Une commande manuelle du moteur doit arrêter la chorégraphie en cours,
    // sinon les deux se disputent la consigne.
    onManualControl: () => {
      if (player?.isPlaying) player.pause();
      driver?.stop();
    },
  });
  initConverter({ onSaved: loadLibrary });
  loadLibrary();
  requestAnimationFrame(frame);
  startWatchdog();
  // Le bilan se rafraîchit tout seul : personne ne rouvre le tiroir toutes
  // les trente secondes pour le regarder monter.
  setInterval(renderTally, 15000);

  // Le mode stand ne se rétablit pas tout seul au rechargement : le plein
  // écran exige un geste de l'utilisateur, et une borne qui redémarre à
  // moitié en mode stand serait pire que pas de mode stand du tout.
  if (settings.lock) {
    settings.lock = false;
    delete document.documentElement.dataset.locked;
  }
  if (settings.kiosk) {
    settings.kiosk = false;
    saveSettings();
    toast('Le mode stand ne se rétablit pas tout seul après un rechargement : touche S, ou le bouton de la barre.', 'info', 8000);
  }

  // Si le navigateur garde l'autorisation d'un hub déjà utilisé, on retrouve la
  // liaison sans repasser par le sélecteur.
  if (PianoHub.isSupported() && settings.autoReconnect) {
    hub.connectKnownDevice().catch(() => {});
  }
}

boot();
