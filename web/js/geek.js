/**
 * Mode geek — télémétrie temps réel du jukebox.
 *
 * Pensé pour une journée portes ouvertes : le panneau montre ce qui se passe
 * réellement sous l'interface, de la fenêtre FFT aux trames Bluetooth brutes.
 *
 * Règle du module : **rien n'est inventé**. Chaque valeur affichée est soit lue
 * directement dans une API du navigateur (Web Audio, Web Bluetooth, Performance),
 * soit calculée à partir d'un compteur incrémenté au bon endroit du code. Les
 * rares grandeurs dérivées d'un modèle — la vitesse de l'arbre à cames — sont
 * annoncées comme des estimations.
 *
 *   AnalyserNode ──► spectre, RMS, crête, centroïde
 *   Player       ──► ordonnanceur, dérive d'horloge, polyphonie
 *   MotionDriver ──► activité, consigne PWM, cadence du minuteur
 *   PianoHub     ──► trames GATT, latence d'écriture, débit
 */

import { CAMSHAFT_MAX_TURNS_PER_SECOND } from './ui.js';
import { LPF2_SERVICE, LPF2_CHARACTERISTIC, SensorMode } from './lego/protocol.js';

/** Rafraîchissement des valeurs chiffrées (Hz). Les courbes, elles, suivent le rendu. */
const READOUT_HZ = 10;
/** Nombre de trames Bluetooth conservées à l'écran. */
const FRAME_LINES = 18;

/* ------------------------------------------------------------------ */
/* Couleurs                                                            */
/* ------------------------------------------------------------------ */

/**
 * Les courbes sont dessinées sur un canvas, qui ne comprend pas les variables
 * CSS : on résout les teintes du thème une fois pour toutes.
 *
 * La clé de cache contient le thème du document concerné. Un changement de
 * thème produit donc naturellement une nouvelle clé, et le second écran — qui
 * vit dans un autre document — a ses propres entrées.
 */
const paletteCache = new Map();

/**
 * @param {string} name variable CSS, par exemple `--geek-power`
 * @param {string} fallback teinte de repli si la variable est absente
 * @param {HTMLElement} [root] racine du document à interroger
 */
function themeColor(name, fallback, root = document.documentElement) {
  const key = `${root.dataset.theme ?? ''}|${name}`;
  if (!paletteCache.has(key)) {
    const view = root.ownerDocument.defaultView ?? window;
    const value = view.getComputedStyle(root).getPropertyValue(name).trim();
    paletteCache.set(key, value || fallback);
  }
  return paletteCache.get(key);
}

/* ------------------------------------------------------------------ */
/* Petits utilitaires de formatage                                     */
/* ------------------------------------------------------------------ */

const nf = (value, digits = 0) =>
  Number.isFinite(value) ? value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';

const dbfs = (amplitude) => (amplitude > 1e-6 ? `${nf(20 * Math.log10(amplitude), 1)} dBFS` : '−∞ dBFS');

const bytes = (count) => (count < 1024 ? `${nf(count)} o` : `${nf(count / 1024, 1)} kio`);

function clockTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest < 10 ? '0' : ''}${nf(rest, 3)}`;
}

/* ------------------------------------------------------------------ */
/* Courbe défilante                                                    */
/* ------------------------------------------------------------------ */

/**
 * Un oscilloscope minuscule : une valeur poussée par image, tracée de gauche
 * à droite, avec une échelle verticale soit fixe, soit auto-adaptative.
 */
class Trace {
  constructor(canvas, { color, fallback, max = 1, autoScale = false, fill = true } = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.colorVar = color;
    this.fallback = fallback;
    this.max = max;
    this.baseMax = max;
    this.autoScale = autoScale;
    this.fill = fill;
    this.values = [];
    this.width = 0;
    this.height = 0;
  }

  push(value) {
    this.values.push(Number.isFinite(value) ? value : 0);
    // On ne garde qu'un point par colonne de pixels : le reste serait invisible.
    const limit = Math.max(32, this.width || 160);
    while (this.values.length > limit) this.values.shift();
  }

  /** Racine du document qui affiche ce canvas — la fenêtre peut être une autre. */
  get root() {
    return this.canvas.ownerDocument.documentElement;
  }

  _resize() {
    const view = this.canvas.ownerDocument.defaultView ?? window;
    const ratio = Math.min(2, view.devicePixelRatio || 1);
    const box = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(box.width));
    const height = Math.max(1, Math.round(box.height));
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.canvas.width = width * ratio;
    this.canvas.height = height * ratio;
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  /** @param {boolean} clear faux quand une autre courbe partage déjà ce canvas */
  draw(clear = true) {
    this._resize();
    const { context: ctx, width: w, height: h, values } = this;
    if (clear) ctx.clearRect(0, 0, w, h);
    if (values.length < 2) return;

    if (this.autoScale) {
      const peak = Math.max(this.baseMax, ...values);
      // Le plafond monte tout de suite et redescend doucement : l'échelle ne saute pas.
      this.max = peak > this.max ? peak : this.max * 0.98 + peak * 0.02;
    }
    const scale = this.max || 1;
    const step = w / (values.length - 1);
    const y = (value) => h - 1 - (Math.min(1, Math.abs(value) / scale) * (h - 2));

    ctx.beginPath();
    ctx.moveTo(0, y(values[0]));
    for (let i = 1; i < values.length; i += 1) ctx.lineTo(i * step, y(values[i]));

    const color = themeColor(this.colorVar, this.fallback, this.root);
    if (this.fill) {
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(0, y(values[0]));
      for (let i = 1; i < values.length; i += 1) ctx.lineTo(i * step, y(values[i]));
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.stroke();
  }
}

/* ------------------------------------------------------------------ */
/* Description du panneau                                              */
/* ------------------------------------------------------------------ */

/**
 * Le panneau est décrit ici, puis construit une fois pour toutes. Chaque champ
 * porte une clé ; la boucle de rafraîchissement se contente d'écrire dedans.
 */
const CARDS = [
  {
    title: 'Chaîne audio · DSP',
    traces: [
      { key: 'spectrum', kind: 'spectrum', height: 44 },
      { key: 'wave', kind: 'wave', height: 26 },
    ],
    fields: [
      ['sampleRate', 'Échantillonnage'],
      ['fft', 'Fenêtre FFT'],
      ['binWidth', 'Résolution'],
      ['latency', 'Latence matérielle'],
      ['rms', 'Niveau RMS'],
      ['peak', 'Crête'],
      ['centroid', 'Centroïde spectral'],
      ['reduction', 'Compression'],
      ['voices', 'Polyphonie'],
      ['ctxState', 'Contexte audio'],
    ],
  },
  {
    title: 'Ordonnanceur · partition',
    traces: [{ key: 'notes', kind: 'trace', color: '--geek-notes', fallback: '#e0a94a', max: 12, autoScale: true, height: 32 }],
    fields: [
      ['clock', 'Horloge de référence'],
      ['position', 'Position'],
      ['lookahead', 'Anticipation'],
      ['ticks', 'Cycles ordonnanceur'],
      ['scheduled', 'Notes programmées'],
      ['dropped', 'Notes manquées'],
      ['drift', 'Dérive d’horloge'],
      ['tempo', 'Tempo'],
      ['beat', 'Temps'],
      ['density', 'Densité'],
    ],
  },
  {
    title: 'Chorégraphie · moteur',
    traces: [{ key: 'power', kind: 'trace', color: '--geek-power', fallback: '#74e0a6', max: 100, height: 32 }],
    fields: [
      ['activity', 'Activité'],
      ['accent', 'Accent'],
      ['pwm', 'Consigne PWM'],
      ['window', 'Plage de puissance'],
      ['lead', 'Avance appliquée'],
      ['latencyBudget', 'Latence mesurée'],
      ['tickHz', 'Cadence pilote'],
      ['jitter', 'Gigue minuteur'],
      ['shaft', 'Arbre à cames (est.)'],
      ['profile', 'Profil de démarrage'],
      ['sensorMode', 'Mode du capteur'],
      ['sensor', 'Capteur'],
      ['motorState', 'État de sortie'],
    ],
  },
  {
    title: 'Liaison Bluetooth LE',
    traces: [{ key: 'ble', kind: 'trace', color: '--geek-ble', fallback: '#6fa8dc', max: 8, autoScale: true, height: 32 }],
    fields: [
      ['gatt', 'Service GATT'],
      ['link', 'État du lien'],
      ['fw', 'Micrologiciel'],
      ['protocol', 'Protocole LWP'],
      ['rssi', 'Puissance du signal'],
      ['tx', 'Trames émises'],
      ['rx', 'Trames reçues'],
      ['throughput', 'Débit montant'],
      ['gattLatency', 'Latence d’écriture'],
      ['queue', 'File d’attente'],
      ['feedback', 'Accusés attendus'],
      ['reconnects', 'Reconnexions'],
      ['ports', 'Ports détectés'],
    ],
  },
  {
    title: 'Alimentation · alertes',
    // Deux grandeurs sur un même cadre : la tension chute quand le courant
    // grimpe, et c'est exactement ce qu'on veut donner à voir.
    traces: [
      { key: 'voltage', kind: 'trace', color: '--geek-power', fallback: '#74e0a6', max: 9, autoScale: true, height: 42, fill: false },
      { key: 'current', kind: 'trace', color: '--geek-fps', fallback: '#e07a5f', max: 200, autoScale: true, overlay: true },
    ],
    fields: [
      ['voltage', 'Tension'],
      ['current', 'Courant'],
      ['draw', 'Puissance'],
      ['batteryLevel', 'Charge'],
      ['batteryType', 'Piles'],
      ['alert1', 'Tension basse'],
      ['alert2', 'Courant élevé'],
      ['alert3', 'Signal faible'],
      ['alert4', 'Surpuissance'],
    ],
  },
  {
    title: 'Rendu · machine',
    traces: [{ key: 'fps', kind: 'trace', color: '--geek-fps', fallback: '#e07a5f', max: 70, height: 32 }],
    fields: [
      ['fps', 'Images par seconde'],
      ['frameTime', 'Temps par image'],
      ['p95', 'Temps par image (p95)'],
      ['longFrames', 'Images > 32 ms'],
      ['heap', 'Tas JavaScript'],
      ['cores', 'Cœurs logiques'],
      ['deviceMemory', 'Mémoire appareil'],
      ['viewport', 'Zone d’affichage'],
      ['uptime', 'Durée de session'],
      ['agent', 'Moteur de rendu'],
    ],
  },
];

/* ------------------------------------------------------------------ */

export class GeekMode {
  /**
   * @param {object} sources
   * @param {import('./lego/hub.js').PianoHub} sources.hub
   * @param {() => (import('./music/player.js').Player | null)} sources.getPlayer
   * @param {() => (import('./music/choreography.js').MotionDriver | null)} sources.getDriver
   * @param {object} sources.settings réglages du jukebox, lus pour l'affichage
   * @param {'bar'|'screen'} [sources.layout] `bar` : bandeau en bas de la page.
   *   `screen` : plein écran, pour un second moniteur.
   */
  constructor({ hub, getPlayer, getDriver, settings, layout = 'bar' }) {
    this.hub = hub;
    this.getPlayer = getPlayer;
    this.getDriver = getDriver;
    this.settings = settings;
    this.layout = layout;
    this.frameLines = layout === 'screen' ? 28 : FRAME_LINES;
    /**
     * Intervalle minimal entre deux rafraîchissements (ms). Le second écran est
     * animé par deux boucles à la fois — celle du jukebox et la sienne — parce
     * qu'un navigateur gèle `requestAnimationFrame` dans une fenêtre masquée.
     * Ce plancher évite que les deux se cumulent en doublant la cadence.
     */
    this.minFrameMs = layout === 'screen' ? 14 : 1;

    this.enabled = false;
    this.root = null;
    /** Document et fenêtre d'affichage — pas forcément ceux du jukebox. */
    this.document = document;
    this.window = window;
    this.fields = new Map();
    this.traces = new Map();
    /** Courbes dans l'ordre de tracé : celles qui partagent un canvas suivent. */
    this._traceOrder = [];

    this._bootAt = performance.now();
    this._frameTimes = [];
    this._longFrames = 0;
    this._lastReadout = 0;
    this._lastFrameAt = 0;
    this._pendingFrames = [];

    // Instantané des compteurs BLE, pour en déduire un débit par différence.
    this._blePrevious = { at: performance.now(), txBytes: 0 };

    // Analyse spectrale : deux tampons réutilisés, jamais réalloués.
    this._spectrum = null;
    this._waveform = null;

    // Écouteurs gardés sous la main : le second écran se détache à sa fermeture.
    this._onRaw = (event) => this._onFrame(event.detail);
    // `raw` porte déjà la trame décodée : le hub la produit pour sa console.
    this.hub.addEventListener('raw', this._onRaw);

    // Le détail des tentatives de reconnexion ne vit que dans l'événement.
    this._reconnect = { attempt: 0, delay: 0, recovered: 0 };
    this._onStatus = (event) => {
      const { status, attempt, delay } = event.detail;
      if (status === 'reconnecting') this._reconnect = { ...this._reconnect, attempt, delay };
      else if (status === 'connected' && this._reconnect.attempt) {
        this._reconnect = { attempt: 0, delay: 0, recovered: this._reconnect.recovered + 1 };
      }
    };
    this.hub.addEventListener('status', this._onStatus);
  }

  /** Détache le panneau du hub et le retire du document. */
  destroy() {
    this.hub.removeEventListener('raw', this._onRaw);
    this.hub.removeEventListener('status', this._onStatus);
    this.enabled = false;
    this.root?.remove();
    this.root = null;
  }

  /* ---------------------------------------------------------------- */
  /* Construction du panneau                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Construit le panneau dans le document du parent — celui de la page, ou
   * celui de la fenêtre du second écran.
   */
  mount(parent = document.body) {
    if (this.root) return this.root;

    // Tout ce qui suit doit naître dans le bon document : le second écran est
    // une autre fenêtre, avec son propre `document` et son propre `devicePixelRatio`.
    const doc = parent.ownerDocument;
    this.document = doc;
    this.window = doc.defaultView;
    const full = this.layout === 'screen';

    const root = doc.createElement('section');
    root.className = full ? 'geek geek-full' : 'geek';
    root.id = 'geek';
    root.hidden = !full;
    root.setAttribute('aria-label', 'Télémétrie temps réel');

    const head = doc.createElement('header');
    head.className = 'geek-head';
    head.innerHTML = `
      <span class="geek-led" aria-hidden="true"></span>
      <span class="geek-name">Geek mode</span>
      <span class="geek-tagline">télémétrie temps réel · tout ce qui est affiché est mesuré</span>
      ${full ? '<span class="geek-now" id="geek-now"></span>' : ''}
      ${full
        ? '<button class="geek-close geek-wide-btn" type="button" id="geek-fullscreen">Plein écran</button>'
        : '<button class="geek-close" type="button" aria-label="Fermer la télémétrie">×</button>'}`;
    if (full) {
      this.nowPlaying = head.querySelector('#geek-now');
      head.querySelector('#geek-fullscreen').addEventListener('click', () => this._toggleFullscreen());
    } else {
      head.querySelector('.geek-close').addEventListener('click', () => this.onClose?.());
    }
    root.append(head);

    const grid = doc.createElement('div');
    grid.className = 'geek-grid';

    for (const card of CARDS) {
      const article = doc.createElement('article');
      article.className = 'geek-card';

      const title = doc.createElement('h4');
      title.textContent = card.title;
      article.append(title);

      let canvas = null;
      for (const spec of card.traces ?? []) {
        // `overlay` réutilise le cadre précédent : deux grandeurs superposées.
        if (!spec.overlay || !canvas) {
          canvas = doc.createElement('canvas');
          canvas.className = 'geek-canvas';
          canvas.style.height = `${full ? Math.round(spec.height * 1.4) : spec.height}px`;
          canvas.setAttribute('aria-hidden', 'true');
          article.append(canvas);
        }
        if (spec.kind === 'trace') {
          const trace = new Trace(canvas, spec);
          trace.clears = !spec.overlay;
          this.traces.set(spec.key, trace);
          this._traceOrder.push(trace);
        } else {
          this.traces.set(spec.key, { kind: spec.kind, context: canvas.getContext('2d'), canvas });
        }
      }

      const list = doc.createElement('dl');
      list.className = 'geek-metrics';
      for (const [key, label] of card.fields) {
        const term = doc.createElement('dt');
        term.textContent = label;
        const value = doc.createElement('dd');
        value.textContent = '—';
        list.append(term, value);
        this.fields.set(key, value);
      }
      article.append(list);
      grid.append(article);
    }

    // Le flux brut mérite toute la largeur : une trame tient sur une ligne.
    const stream = doc.createElement('article');
    stream.className = 'geek-card geek-card-wide';
    stream.innerHTML = `
      <h4>Flux Bluetooth brut <span class="geek-note">LEGO Wireless Protocol 3.0</span></h4>
      <div class="geek-stream" role="log" aria-live="off"></div>
      <p class="hint geek-idle">Aucune trame : le piano n’est pas connecté. Chaque ligne montrera l’octet-à-octet d’un message échangé avec le hub, suivi de sa traduction.</p>`;
    this.stream = stream.querySelector('.geek-stream');
    this.streamIdle = stream.querySelector('.geek-idle');
    grid.append(stream);

    root.append(grid);
    parent.append(root);
    this.root = root;
    return root;
  }

  /**
   * Bascule le vrai plein écran de la fenêtre. Le navigateur l'exige depuis un
   * geste utilisateur : c'est pourquoi c'est un bouton, et pas un réglage.
   */
  _toggleFullscreen() {
    const doc = this.document;
    if (doc.fullscreenElement) doc.exitFullscreen?.();
    else doc.documentElement.requestFullscreen?.().catch(() => { /* refusé : tant pis */ });
  }

  /** Rappelle en tête de panneau ce que joue le jukebox, resté sur l'autre écran. */
  _updateNowPlaying() {
    if (!this.nowPlaying) return;
    const player = this.getPlayer();
    const track = player?.track;
    if (!track) {
      this.nowPlaying.textContent = 'aucun morceau';
      return;
    }
    const state = player.isPlaying ? '▶' : '⏸';
    this.nowPlaying.textContent = `${state} ${track.title}${track.artist ? ` — ${track.artist}` : ''}`;
  }

  /* ---------------------------------------------------------------- */

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.root) this.root.hidden = !this.enabled;
    this.document.body.classList.toggle('geek-on', this.enabled);
    this._lastFrameAt = 0;
    if (!this.enabled) {
      this._pendingFrames.length = 0;
      if (this.stream) {
        this.stream.textContent = '';
        this.streamIdle.hidden = false;
      }
    }
  }

  _onFrame(detail) {
    if (!this.enabled) return;
    this._pendingFrames.push(detail);
    if (this._pendingFrames.length > this.frameLines) this._pendingFrames.splice(0, this._pendingFrames.length - this.frameLines);
    // La latence de la dernière écriture GATT, relevée juste après l'envoi.
    if (detail.direction === 'tx') this.traces.get('ble')?.push(this.hub.stats.lastWriteMs);
  }

  /* ---------------------------------------------------------------- */
  /* Boucle de rafraîchissement                                       */
  /* ---------------------------------------------------------------- */

  /**
   * Appelée à chaque image par la boucle principale.
   * @param {number} now horodatage `performance.now()`
   */
  update(now) {
    // Le coût du panneau doit rester nul quand il est fermé.
    if (!this.enabled || !this.root) return;

    // La boucle d'affichage plafonne son `dt` à 100 ms pour éviter les sauts
    // d'animation ; on remesure ici, sinon les images longues seraient tronquées.
    if (!this._lastFrameAt) {
      this._lastFrameAt = now;
      return;
    }
    const frameMs = now - this._lastFrameAt;
    // Trop tôt : on laisse le repère en place pour que l'écart s'accumule.
    if (frameMs < this.minFrameMs) return;
    this._lastFrameAt = now;
    this._frameTimes.push(frameMs);
    if (this._frameTimes.length > 120) this._frameTimes.shift();
    if (frameMs > 32) this._longFrames += 1;
    this.traces.get('fps').push(frameMs > 0 ? 1000 / frameMs : 0);

    const driver = this.getDriver();
    this.traces.get('power').push(driver?.running ? Math.abs(driver.power) : 0);

    const hub = this.hub;
    this.traces.get('voltage').push(hub.info.voltage ?? 0);
    this.traces.get('current').push(hub.info.current ?? 0);

    const player = this.getPlayer();
    // Notes de la partition en train de sonner : la courbe du travail confié
    // à l'ordonnanceur. `soundingNotes` est idempotente pour un même instant.
    this.traces.get('notes').push(player?.isPlaying ? player.soundingNotes().length : 0);

    this._drawSpectrum(player);
    this._drawWaveform(player);
    for (const trace of this._traceOrder) trace.draw(trace.clears);

    if (now - this._lastReadout < 1000 / READOUT_HZ) return;
    this._lastReadout = now;
    this._readAudio(player);
    this._readScheduler(player);
    this._readMotion(driver);
    this._readBluetooth(now);
    this._readPower();
    this._readMachine(now);
    this._updateNowPlaying();
    this._flushFrames();
  }

  set(key, value) {
    const node = this.fields.get(key);
    if (node && node.textContent !== value) node.textContent = value;
  }

  /* ---------------------------------------------------------------- */
  /* Spectre                                                          */
  /* ---------------------------------------------------------------- */

  /** Prépare un canvas et rend son contexte, à l'échelle de l'écran. */
  _canvasContext(key) {
    const { canvas, context: ctx } = this.traces.get(key);
    const ratio = Math.min(2, this.window.devicePixelRatio || 1);
    const box = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(box.width));
    const h = Math.max(1, Math.round(box.height));
    if (canvas.width !== w * ratio || canvas.height !== h * ratio) {
      canvas.width = w * ratio;
      canvas.height = h * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  _drawSpectrum(player) {
    const { ctx, w, h } = this._canvasContext('spectrum');
    const analyser = player?.analyser;
    if (!analyser) return;
    this._ensureBuffers(analyser);
    analyser.getByteFrequencyData(this._spectrum);

    // Barres réparties logarithmiquement : c'est ainsi que l'oreille entend,
    // et les graves d'un piano ne mangent plus tout l'affichage.
    const bars = 56;
    const bins = this._spectrum.length;
    const gap = 1;
    const barWidth = (w - gap * (bars - 1)) / bars;
    ctx.fillStyle = themeColor('--geek-notes', '#e0a94a', this.document.documentElement);
    for (let i = 0; i < bars; i += 1) {
      const from = Math.floor(bins ** (i / bars)) - 1;
      const to = Math.max(from + 1, Math.floor(bins ** ((i + 1) / bars)) - 1);
      let peak = 0;
      for (let bin = Math.max(0, from); bin < Math.min(bins, to); bin += 1) {
        if (this._spectrum[bin] > peak) peak = this._spectrum[bin];
      }
      const height = (peak / 255) * (h - 1);
      ctx.globalAlpha = 0.3 + (peak / 255) * 0.7;
      ctx.fillRect(i * (barWidth + gap), h - height, barWidth, height);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Forme d'onde du signal, tracée telle quelle. C'est le même tampon que celui
   * qui sert au calcul du niveau RMS : ce que l'on voit est ce que l'on entend.
   */
  _drawWaveform(player) {
    const { ctx, w, h } = this._canvasContext('wave');
    const analyser = player?.analyser;
    if (!analyser) return;
    this._ensureBuffers(analyser);
    analyser.getFloatTimeDomainData(this._waveform);

    const middle = h / 2;
    const buffer = this._waveform;
    const step = buffer.length / w;
    ctx.beginPath();
    for (let x = 0; x < w; x += 1) {
      // Une colonne de pixels couvre plusieurs échantillons : on prend l'extrême,
      // sinon les aigus disparaissent entre deux points.
      let extreme = 0;
      const from = Math.floor(x * step);
      const to = Math.min(buffer.length, Math.floor((x + 1) * step));
      for (let i = from; i < to; i += 1) {
        if (Math.abs(buffer[i]) > Math.abs(extreme)) extreme = buffer[i];
      }
      const y = middle - extreme * (middle - 1);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = themeColor('--geek-power', '#74e0a6', this.document.documentElement);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  _ensureBuffers(analyser) {
    if (this._spectrum?.length !== analyser.frequencyBinCount) {
      this._spectrum = new Uint8Array(analyser.frequencyBinCount);
      this._floatSpectrum = new Float32Array(analyser.frequencyBinCount);
    }
    if (this._waveform?.length !== analyser.fftSize) {
      this._waveform = new Float32Array(analyser.fftSize);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Lectures                                                         */
  /* ---------------------------------------------------------------- */

  _readAudio(player) {
    const context = player?.context;
    if (!context) {
      this.set('ctxState', 'pas encore ouvert');
      this.set('sampleRate', '—');
      return;
    }
    const analyser = player.analyser;
    this._ensureBuffers(analyser);

    this.set('sampleRate', `${nf(context.sampleRate)} Hz`);
    this.set('fft', `${analyser.fftSize} pts → ${analyser.frequencyBinCount} raies`);
    this.set('binWidth', `${nf(context.sampleRate / analyser.fftSize, 1)} Hz par raie`);

    // `baseLatency` : le tampon du graphe. `outputLatency` : ce que le système
    // ajoute jusqu'au haut-parleur. Le second n'existe pas partout.
    const base = (context.baseLatency ?? 0) * 1000;
    const output = (context.outputLatency ?? 0) * 1000;
    this.set('latency', output ? `${nf(base, 1)} + ${nf(output, 1)} = ${nf(base + output, 1)} ms` : `${nf(base, 1)} ms`);

    analyser.getFloatTimeDomainData(this._waveform);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < this._waveform.length; i += 1) {
      const value = this._waveform[i];
      sum += value * value;
      const magnitude = Math.abs(value);
      if (magnitude > peak) peak = magnitude;
    }
    this.set('rms', dbfs(Math.sqrt(sum / this._waveform.length)));
    this.set('peak', dbfs(peak));
    this.set('centroid', this._spectralCentroid(context, analyser));

    // Réduction de gain du limiteur : négative dès que les accords tapent fort.
    const reduction = player.limiter?.reduction;
    this.set('reduction', Number.isFinite(reduction) ? `${nf(reduction, 1)} dB` : '—');

    const sampler = player.sampler;
    this.set('voices', sampler ? `${sampler.activeVoices} voix (crête ${sampler.peakVoices})` : '—');
    this.set('ctxState', `${context.state} · quantum 128`);
  }

  _spectralCentroid(context, analyser) {
    analyser.getFloatFrequencyData(this._floatSpectrum);
    const binWidth = context.sampleRate / analyser.fftSize;
    let weighted = 0;
    let total = 0;
    for (let i = 0; i < this._floatSpectrum.length; i += 1) {
      const db = this._floatSpectrum[i];
      if (db <= -100) continue; // plancher de l'analyseur : que du bruit
      const magnitude = 10 ** (db / 20);
      weighted += magnitude * (i * binWidth);
      total += magnitude;
    }
    return total > 1e-9 ? `${nf(weighted / total)} Hz` : 'silence';
  }

  _readScheduler(player) {
    if (!player?.track) {
      this.set('clock', 'à l’arrêt');
      this.set('position', '—');
      return;
    }
    const CLOCKS = {
      midi: 'AudioContext',
      audio: 'HTMLMediaElement',
      'audio+midi': 'HTMLMedia + MIDI',
    };
    const stats = player.stats;
    const time = player.currentTime;

    this.set('clock', CLOCKS[player.mode] ?? player.mode);
    this.set('position', `${clockTime(time)} / ${clockTime(player.duration)}`);
    this.set('lookahead', `${nf(player.scheduleAhead * 1000)} ms`);
    this.set('ticks', `${nf(stats.schedulerTicks)} à 40 Hz`);
    this.set(
      'scheduled',
      player.midi ? `${nf(stats.notesScheduled)} / ${nf(player.midi.notes.length)}` : 'aucune partition'
    );
    this.set('dropped', nf(stats.notesDropped));
    this.set('drift', player.isPlaying ? `${player.clockDriftMs >= 0 ? '+' : '−'}${nf(Math.abs(player.clockDriftMs), 2)} ms` : '—');

    const midi = player.midi;
    if (!midi) {
      this.set('tempo', 'déduit du signal');
      this.set('beat', '—');
      this.set('density', '—');
      return;
    }
    this.set('tempo', `${nf(midi.averageBpm, 1)} bpm · ${midi.timeSignature.numerator}/${midi.timeSignature.denominator}`);

    const driver = this.getDriver();
    const beats = midi.beats;
    if (driver?.running && beats.length) {
      const index = Math.min(driver.beatIndex, beats.length - 1);
      const measure = Math.floor(index / midi.timeSignature.numerator) + 1;
      const inMeasure = (index % midi.timeSignature.numerator) + 1;
      this.set('beat', `mesure ${measure}, temps ${inMeasure}${beats[index].downbeat ? ' (fort)' : ''}`);
    } else {
      this.set('beat', `${nf(beats.length)} temps dans la grille`);
    }
    // Densité : notes attaquées dans la seconde écoulée. Bon marqueur de virtuosité.
    this.set('density', `${nf(countNotesIn(midi.notes, time - 1, time))} notes/s`);
  }

  _readMotion(driver) {
    if (!driver) {
      this.set('motorState', 'pilote inactif');
      return;
    }
    const settings = this.settings;
    const power = driver.running ? driver.power : 0;

    this.set('activity', nf(driver.activity, 3));
    this.set('accent', nf(driver.accent, 3));
    this.set('pwm', `${nf(power)} % ${settings.direction === -1 ? '(sens inversé)' : ''}`.trim());
    this.set('window', `${nf(settings.minPower)} → ${nf(settings.maxPower)} %`);
    this.set('lead', `${nf(settings.leadMs)} ms`);
    this.set('tickHz', driver.running ? `${nf(driver.tickHz, 1)} Hz` : '—');
    this.set('jitter', driver.running ? `± ${nf(driver.tickJitterMs, 2)} ms` : '—');
    // Vitesse déduite du modèle d'animation, pas mesurée sur le vrai moteur.
    this.set('shaft', `≈ ${nf((Math.abs(power) / 100) * CAMSHAFT_MAX_TURNS_PER_SECOND * 60)} tr/min`);

    // Ce que l'avance a réellement à rattraper : la latence de la carte son plus
    // celle du lien BLE. L'inertie du moteur, elle, ne se mesure pas d'ici.
    this.set('latencyBudget', this._latencyBudget());

    const profile = [settings.rampStart ? 'rampe' : 'départ direct', settings.brakeOnStop ? 'freinage' : 'roue libre'];
    this.set('profile', profile.join(' · '));

    const counting = this.hub.sensorMode === SensorMode.COUNT;
    this.set('sensorMode', this.hub.sensorPort === null ? 'aucun capteur' : counting ? 'comptage de passages' : 'distance');
    const reading = this.hub.lastSensorValue;
    this.set('sensor', reading === null ? 'aucune mesure' : counting ? `${nf(reading)} passages` : `${reading} / 10`);

    if (!settings.enabled) this.set('motorState', 'pilotage désactivé');
    else if (!this.hub.connected) this.set('motorState', 'hub absent (simulation)');
    else if (this.hub.motorPort === null) this.set('motorState', 'aucun moteur sur A/B');
    else this.set('motorState', `port ${this.hub.motorPort === 0 ? 'A' : 'B'} · consigne ${nf(this.hub.currentPower)} %`);
  }

  /**
   * Somme des retards mesurés entre la décision et le son, comparée à l'avance
   * configurée. Seuls des chiffres relevés entrent dedans : rien n'est deviné.
   */
  _latencyBudget() {
    const context = this.getPlayer()?.context;
    if (!context) return '—';
    const audio = ((context.baseLatency ?? 0) + (context.outputLatency ?? 0)) * 1000;
    const ble = this.hub.connected ? this.hub.stats.avgWriteMs : 0;
    // « audio + BLE », dans cet ordre : c'est ce que l'avance doit rattraper.
    return `${nf(audio, 1)} + ${nf(ble, 1)} ms`;
  }

  /** État du lien, tentative de reconnexion comprise. */
  _linkState() {
    const hub = this.hub;
    if (hub.status === 'reconnecting') {
      return `reconnexion · essai ${this._reconnect.attempt} dans ${nf(this._reconnect.delay / 1000, 1)} s`;
    }
    return hub.connected ? `connecté · ${hub.info.name ?? 'hub'}` : hub.status;
  }

  _readBluetooth(now) {
    const hub = this.hub;
    const stats = hub.stats;

    const info = hub.info;

    this.set('gatt', `${LPF2_SERVICE.slice(0, 8)} / ${LPF2_CHARACTERISTIC.slice(0, 8)}`);
    this.set('link', this._linkState());
    this.set('fw', info.firmware ?? '—');
    this.set('protocol', info.protocol ? `v${info.protocol}` : '—');
    // Le RSSI est négatif : plus il est proche de zéro, plus le hub est près.
    this.set('rssi', Number.isFinite(info.rssi) ? `${info.rssi} dBm` : '—');
    this.set('tx', `${nf(stats.txFrames)} (${bytes(stats.txBytes)})`);
    this.set('rx', `${nf(stats.rxFrames)} (${bytes(stats.rxBytes)})`);

    const elapsed = (now - this._blePrevious.at) / 1000;
    if (elapsed > 0.2) {
      this._throughput = (stats.txBytes - this._blePrevious.txBytes) / elapsed;
      this._blePrevious = { at: now, txBytes: stats.txBytes };
    }
    this.set('throughput', `${nf(this._throughput ?? 0)} o/s · ${nf(stats.motorWrites)} consignes`);
    this.set(
      'gattLatency',
      stats.txFrames
        ? `${nf(stats.avgWriteMs, 2)} ms moy · ${nf(stats.maxWriteMs, 2)} ms max${stats.writeErrors ? ` · ${stats.writeErrors} échec(s)` : ''}`
        : '—'
    );
    this.set('queue', `${hub.queueDepth} message(s)`);
    this.set('feedback', `${hub.pendingFeedback} commande(s)`);
    this.set(
      'reconnects',
      this._reconnect.recovered || this._reconnect.attempt
        ? `${this._reconnect.recovered} rétabli(s)${this._reconnect.attempt ? ` · essai ${this._reconnect.attempt}` : ''}`
        : hub.autoReconnect ? 'aucune · veille active' : 'désactivée'
    );

    const ports = [...hub.ports.entries()].map(([port, info]) => `${portName(port)}:${info.label}`);
    this.set('ports', ports.length ? ports.join(' · ') : 'aucun');
  }

  /**
   * Le hub mesure lui-même sa tension et son courant, et lève quatre alertes.
   * C'est la seule fenêtre qu'on ait sur l'état physique du modèle : le courant
   * grimpe dès que l'arbre à cames force, la tension s'affaisse en retour.
   */
  _readPower() {
    const { info, alerts } = this.hub;
    const volts = info.voltage;
    const milliamps = info.current;

    this.set('voltage', Number.isFinite(volts) ? `${nf(volts, 2)} V` : '—');
    this.set('current', Number.isFinite(milliamps) ? `${nf(milliamps)} mA` : '—');
    this.set(
      'draw',
      Number.isFinite(volts) && Number.isFinite(milliamps) ? `${nf((volts * milliamps) / 1000, 2)} W` : '—'
    );
    this.set('batteryLevel', Number.isFinite(info.battery) ? `${info.battery} %` : '—');
    this.set('batteryType', info.batteryType ?? '—');

    for (const type of [1, 2, 3, 4]) {
      this.set(`alert${type}`, this.hub.connected ? (alerts[type] ? '⚠ DÉCLENCHÉE' : 'normale') : '—');
      const node = this.fields.get(`alert${type}`);
      if (node) node.classList.toggle('geek-alert', Boolean(alerts[type]));
    }
  }

  _readMachine(now) {
    const times = this._frameTimes;
    if (times.length) {
      const mean = times.reduce((sum, value) => sum + value, 0) / times.length;
      const sorted = [...times].sort((a, b) => a - b);
      this.set('fps', `${nf(1000 / mean, 1)} i/s`);
      this.set('frameTime', `${nf(mean, 2)} ms`);
      this.set('p95', `${nf(sorted[Math.floor(sorted.length * 0.95)], 2)} ms`);
    }
    this.set('longFrames', nf(this._longFrames));

    // `performance.memory` n'existe que sur les navigateurs Chromium.
    const memory = performance.memory;
    this.set(
      'heap',
      memory
        ? `${nf(memory.usedJSHeapSize / 1048576, 1)} / ${nf(memory.jsHeapSizeLimit / 1048576)} Mio`
        : 'non exposé'
    );
    this.set('cores', navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency}` : 'non exposé');
    this.set('deviceMemory', navigator.deviceMemory ? `≥ ${navigator.deviceMemory} Gio` : 'non exposé');
    const view = this.window;
    this.set('viewport', `${view.innerWidth} × ${view.innerHeight} · DPR ${nf(view.devicePixelRatio, 2)}`);

    const seconds = (now - this._bootAt) / 1000;
    const minutes = Math.floor(seconds / 60);
    this.set('uptime', minutes ? `${minutes} min ${nf(seconds % 60)} s` : `${nf(seconds)} s`);
    this.set('agent', renderingEngine());
  }

  _flushFrames() {
    if (!this._pendingFrames.length || !this.stream) return;
    const doc = this.document;
    const fragment = doc.createDocumentFragment();
    // Les trames les plus récentes en haut : à 25 Hz, un défilement serait illisible.
    for (const frame of this._pendingFrames.reverse()) {
      const line = doc.createElement('div');
      line.className = `geek-frame ${frame.direction}`;

      const hex = doc.createElement('b');
      hex.textContent = `${frame.direction === 'tx' ? '▲' : '▼'} ${frame.hex.padEnd(29, ' ')}`;
      const name = doc.createElement('span');
      name.textContent = frame.name;
      const summary = doc.createElement('i');
      summary.textContent = `  ${frame.summary}`;

      line.append(hex, name, summary);
      fragment.append(line);
    }
    this._pendingFrames.length = 0;
    this.stream.prepend(fragment);
    while (this.stream.childElementCount > this.frameLines) this.stream.lastElementChild.remove();
    this.streamIdle.hidden = true;
  }
}

/* ------------------------------------------------------------------ */

/** Notes dont l'attaque tombe dans l'intervalle ]from, to]. */
function countNotesIn(notes, from, to) {
  let count = 0;
  // Les notes sont triées : on s'arrête dès qu'on dépasse la fenêtre.
  for (const note of notes) {
    if (note.time > to) break;
    if (note.time > from) count += 1;
  }
  return count;
}

function portName(port) {
  if (port === 0x00) return 'A';
  if (port === 0x01) return 'B';
  if (port === 0x32) return 'LED';
  if (port === 0x3b) return 'I';
  if (port === 0x3c) return 'U';
  return `0x${port.toString(16)}`;
}

function renderingEngine() {
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) return 'Gecko';
  if (/Edg\//.test(ua)) return 'Blink (Edge)';
  if (/Chrome\//.test(ua)) return 'Blink (Chrome)';
  if (/Safari\//.test(ua)) return 'WebKit';
  return 'inconnu';
}
