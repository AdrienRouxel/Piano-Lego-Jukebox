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
import { GeekMode } from './geek.js';
import { wireHubTools, HUB_TOOL_SETTINGS } from './hubtools.js';
import { DocReader } from './reader.js';
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
  seek: el('seek'),
  timeCurrent: el('time-current'),
  timeTotal: el('time-total'),
  volume: el('volume'),

  list: el('track-list'),
  empty: el('library-empty'),
  search: el('search'),
  refresh: el('btn-refresh'),

  drawer: el('drawer'),
  scrim: el('scrim'),
  guide: el('btn-guide'),
  openSettings: el('btn-settings'),
  closeSettings: el('btn-close-settings'),
  warmup: el('warmup'),
  warmupLine: el('warmup-line'),
  log: el('log'),
};

/* ------------------------------------------------------------------ */
/* État                                                                */
/* ------------------------------------------------------------------ */

/** Réglages d'interface, à côté de ceux de la chorégraphie. */
const UI_DEFAULTS = { volume: 0.8, theme: 'piano', geek: false, warmup: false, collapsedCategories: [], ...HUB_TOOL_SETTINGS };

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
    restoreCollapsed();
    applyFilter();
  } catch (error) {
    dom.empty.hidden = false;
    dom.empty.textContent = `La bibliothèque n’a pas pu être lue (${error.message}). Le serveur est-il bien lancé avec « npm start » ?`;
  }
}

function applyFilter() {
  const query = dom.search.value.trim().toLowerCase();
  filtered = query
    ? library.filter((track) => `${track.artist ?? ''} ${track.title}`.toLowerCase().includes(query))
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
  button.addEventListener('click', () => selectTrack(library.indexOf(track), true));
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

  dom.nowState.textContent = 'Chargement du piano…';
  const mode = await player.init((loaded, total) => {
    dom.nowState.textContent = `Chargement du piano… ${Math.round((loaded / total) * 100)} %`;
  });
  player.volume = settings.volume;
  audioReady = true;

  dom.nowState.textContent = 'Prêt';
  // Accès depuis la console du navigateur, pratique pour mettre au point les
  // réglages moteur sans passer par l'interface.
  Object.assign(window.jukebox, { player, driver });
  if (mode === 'synth') {
    toast('Échantillons de piano indisponibles : le synthétiseur de secours prend le relais.', 'info', 6000);
  }
}

async function selectTrack(index, autoplay = false) {
  if (index < 0 || index >= library.length) return;
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
  if (player.mode === 'midi') badges.push(['MIDI synthétisé', true]);
  if (player.mode === 'audio+midi') badges.push(['Audio + partition MIDI', true]);
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

function onPlaybackStarted() {
  dom.play.dataset.playing = '1';
  dom.play.setAttribute('aria-label', 'Pause');
  dom.nowState.textContent = 'Lecture';

  const curve = player.activity;
  if (curve) driver.start(curve, () => player.currentTime);
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
    await selectTrack(0, true);
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

function playNext(auto = false) {
  if (!library.length) return;
  const next = (currentIndex + 1) % library.length;
  // En fin de liste, une lecture automatique s'arrête au lieu de reboucler.
  if (auto && next === 0 && currentIndex === library.length - 1) return;
  selectTrack(next, true);
}

function playPrevious() {
  if (!library.length) return;
  // Comme sur une platine : au-delà de 3 s, on revient au début du morceau.
  if (player?.isPlaying && player.currentTime > 3) {
    player.seek(0);
    return;
  }
  selectTrack((currentIndex - 1 + library.length) % library.length, true);
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
  dom.vizPower.textContent = power ? `Moteur ${Math.abs(power)} %` : 'Moteur à l’arrêt';

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

  hub.addEventListener('battery', (event) => {
    dom.hubBattery.hidden = false;
    dom.hubBattery.textContent = `${event.detail.level} %`;
    if (event.detail.level < 15) toast('Les piles du piano sont presque vides.', 'info', 6000);
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

  dom.seek.addEventListener('pointerdown', () => { seeking = true; });
  const commitSeek = () => {
    if (!seeking || !player?.track) return;
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

  dom.guide.addEventListener('click', () => reader.open('guide.md'));
  dom.openSettings.addEventListener('click', () => openDrawer(true));
  dom.closeSettings.addEventListener('click', () => openDrawer(false));
  dom.scrim.addEventListener('click', () => openDrawer(false));

  document.addEventListener('keydown', (event) => {
    // `event.target` n'est pas toujours un élément (document, fenêtre) :
    // on teste prudemment avant d'appeler matches().
    const target = event.target;
    if (target instanceof Element && target.matches('input, textarea, select')) return;
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
    } else if (event.code === 'Escape') {
      if (warmup.active) {
        warmup.cancel();
        return;
      }
      openDrawer(false);
    } else if (event.code === 'ArrowRight' && event.shiftKey) {
      playNext();
    } else if (event.code === 'ArrowLeft' && event.shiftKey) {
      playPrevious();
    } else if (event.code === 'KeyG' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      toggleGeek();
    }
  });

  // Filet de sécurité : on ne laisse jamais le moteur tourner sans surveillance,
  // ni un second écran orphelin derrière soi.
  const panic = () => {
    warmup.cancel();
    driver?.stop();
    hub.stopMotor();
    secondScreen?.close();
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
  window.jukebox = { hub, settings, geek, attachScreen, driver: null, player: null };

  geek.mount();
  bindThemeControls();
  bindSettingsControls();
  wireHub();
  wireUi();
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
  loadLibrary();
  requestAnimationFrame(frame);

  // Si le navigateur garde l'autorisation d'un hub déjà utilisé, on retrouve la
  // liaison sans repasser par le sélecteur.
  if (PianoHub.isSupported() && settings.autoReconnect) {
    hub.connectKnownDevice().catch(() => {});
  }
}

boot();
