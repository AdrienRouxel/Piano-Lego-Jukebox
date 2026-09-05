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
  disconnect: el('btn-disconnect'),
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
  openSettings: el('btn-settings'),
  closeSettings: el('btn-close-settings'),
  testPower: el('test-power'),
  testOut: el('out-test'),
  testStop: el('btn-test-stop'),
  sensorFill: el('sensor-fill'),
  sensorValue: el('sensor-value'),
  log: el('log'),
};

/* ------------------------------------------------------------------ */
/* État                                                                */
/* ------------------------------------------------------------------ */

const settings = loadSettings();
const hub = new PianoHub();
let player = null;
let driver = null;

let library = [];
let filtered = [];
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
    return { ...DEFAULT_SETTINGS, volume: 0.8, ...stored };
  } catch {
    return { ...DEFAULT_SETTINGS, volume: 0.8 };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* mode navigation privée : tant pis */ }
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

  for (const key of ['enabled', 'idleStop', 'ledSync']) {
    const input = el(`set-${key}`);
    input.checked = Boolean(settings[key]);
    input.addEventListener('change', () => {
      settings[key] = input.checked;
      driver?.update(settings);
      if (key === 'enabled' && !input.checked) hub.stopMotor();
      saveSettings();
    });
  }

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
    localSamples = Boolean(data.localSamples);
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

function renderList() {
  dom.list.textContent = '';

  if (!filtered.length) {
    dom.empty.hidden = false;
    dom.empty.innerHTML = library.length
      ? 'Aucun morceau ne correspond à ce filtre.'
      : 'Le dossier <code>tracks/</code> est vide.<br />Dépose-y des fichiers <code>.mid</code> ou <code>.mp3</code>, puis clique sur « Actualiser ».';
    return;
  }
  dom.empty.hidden = true;

  const fragment = document.createDocumentFragment();
  filtered.forEach((track, index) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'track';
    button.setAttribute('aria-current', String(library.indexOf(track) === currentIndex));

    const tags = [
      track.midiUrl ? '<span class="tag midi">MIDI</span>' : '',
      track.audioUrl ? '<span class="tag audio">Audio</span>' : '',
    ].join('');

    button.innerHTML = `
      <span class="track-index">${index + 1}</span>
      <span class="track-body">
        <span class="track-title"></span>
        <span class="track-artist"></span>
      </span>
      <span class="track-tags">${tags}</span>`;
    button.querySelector('.track-title').textContent = track.title;
    button.querySelector('.track-artist').textContent = track.artist ?? 'Sans interprète';
    button.addEventListener('click', () => selectTrack(library.indexOf(track), true));

    item.append(button);
    fragment.append(item);
  });
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
  window.jukebox = { player, driver, hub, settings };
  if (mode === 'synth') {
    toast('Échantillons de piano indisponibles : le synthétiseur de secours prend le relais.', 'info', 6000);
  }
}

async function selectTrack(index, autoplay = false) {
  if (index < 0 || index >= library.length) return;
  await ensureAudio();

  currentIndex = index;
  const track = library[index];
  renderList();

  dom.nowTitle.textContent = track.title;
  dom.nowArtist.textContent = track.artist ?? 'Sans interprète';
  dom.cover.style.backgroundImage = track.coverUrl ? `url("${track.coverUrl}")` : coverStyle(track.id);
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

  if (autoplay) player.play();
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
  if (player.isPlaying) player.pause();
  else player.play();
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

  if (player?.track) {
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

  const power = driver?.running ? driver.power : 0;
  camshaft.update(power, dt);
  dom.powerFill.style.width = `${Math.abs(power)}%`;
  dom.vizPower.textContent = power ? `Moteur ${Math.abs(power)} %` : 'Moteur à l’arrêt';

  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ */
/* Bluetooth                                                           */
/* ------------------------------------------------------------------ */

function wireHub() {
  hub.addEventListener('status', (event) => {
    const { status, name, firmware } = event.detail;
    dom.hubPill.dataset.state = status;
    if (status === 'connected') {
      dom.hubLabel.textContent = hub.hubName ?? name ?? 'Piano connecté';
      dom.connect.textContent = 'Connecté';
      dom.connect.disabled = true;
      if (firmware) logLine(dom.log, `Micrologiciel du hub : ${firmware}`);
    } else if (status === 'connecting') {
      dom.hubLabel.textContent = 'Connexion…';
      dom.connect.disabled = true;
    } else {
      dom.hubLabel.textContent = 'Piano déconnecté';
      dom.hubBattery.hidden = true;
      dom.connect.textContent = 'Connecter le piano';
      dom.connect.disabled = false;
    }
  });

  hub.addEventListener('battery', (event) => {
    dom.hubBattery.hidden = false;
    dom.hubBattery.textContent = `${event.detail.level} %`;
    if (event.detail.level < 15) toast('Les piles du piano sont presque vides.', 'info', 6000);
  });

  hub.addEventListener('sensor', (event) => {
    // Le capteur renvoie 0 (objet très près) à 10 (rien devant).
    const value = event.detail.value;
    dom.sensorValue.textContent = String(value);
    dom.sensorFill.style.width = `${Math.max(0, 100 - value * 10)}%`;
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
  dom.disconnect.addEventListener('click', () => hub.disconnect());

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

  dom.openSettings.addEventListener('click', () => openDrawer(true));
  dom.closeSettings.addEventListener('click', () => openDrawer(false));
  dom.scrim.addEventListener('click', () => openDrawer(false));

  dom.testPower.addEventListener('input', () => {
    const value = Number(dom.testPower.value);
    dom.testOut.textContent = String(value);
    hub.setMotorPower(value);
  });
  dom.testStop.addEventListener('click', () => {
    dom.testPower.value = '0';
    dom.testOut.textContent = '0';
    hub.stopMotor();
  });

  document.addEventListener('keydown', (event) => {
    if (event.target.matches('input, textarea')) return;
    if (event.code === 'Space') {
      event.preventDefault();
      togglePlay();
    } else if (event.code === 'Escape') {
      openDrawer(false);
    } else if (event.code === 'ArrowRight' && event.shiftKey) {
      playNext();
    } else if (event.code === 'ArrowLeft' && event.shiftKey) {
      playPrevious();
    }
  });

  // Filet de sécurité : on ne laisse jamais le moteur tourner sans surveillance.
  const panic = () => {
    driver?.stop();
    hub.stopMotor();
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
  bindSettingsControls();
  wireHub();
  wireUi();
  loadLibrary();
  requestAnimationFrame(frame);
}

boot();
