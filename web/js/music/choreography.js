/**
 * Chorégraphie : transformer de la musique en mouvement de touches.
 *
 * Rappel mécanique — dans le 21323, un seul moteur entraîne un arbre à cames
 * dont les leviers sont calés à des angles différents. Les touches se soulèvent
 * donc en vague, et la seule grandeur que l'on pilote est la vitesse de rotation.
 * Il n'existe aucun moyen d'actionner une touche précise : ce n'est pas une
 * limite de ce projet, c'est la construction du modèle.
 *
 * Ce module produit donc une « courbe d'activité » (0 → 1) à partir du morceau,
 * puis la convertit en puissance moteur, avec :
 *   • une avance réglable, pour compenser la latence Bluetooth + l'inertie ;
 *   • des accents sur les temps forts ;
 *   • un arrêt franc pendant les silences.
 */

/** Pas d'échantillonnage de la courbe d'activité (secondes). */
const STEP = 0.02;

/** Période nominale du pilote moteur (ms) — 25 Hz, la cadence du lien BLE. */
const TICK_INTERVAL = 40;

export const DEFAULT_SETTINGS = {
  enabled: true,
  minPower: 40, // en dessous, le moteur cale sous la charge de l'arbre à cames
  maxPower: 90,
  leadMs: 140, // le moteur doit partir un peu avant le son
  accent: 0.35,
  sensitivity: 0.65,
  direction: 1,
  /** Rôle du second piano : 'off', 'mirror', 'split' ou 'call'. */
  duet: 'mirror',
  idleStop: true,
  ledSync: true,
  brakeOnStop: true, // freiner en fin de morceau plutôt que laisser tourner sur l'élan
  rampStart: true, // et démarrer en douceur au lieu d'un à-coup
};

/* ------------------------------------------------------------------ */
/* Courbe d'activité                                                   */
/* ------------------------------------------------------------------ */

/**
 * Construit la courbe d'activité d'un morceau MIDI.
 * Chaque attaque de note produit une impulsion décroissante ; les notes tenues
 * entretiennent un fond. Le tout est normalisé sur le 90e centile du morceau,
 * pour qu'une pièce douce fasse bouger le piano autant qu'une pièce dense.
 *
 * Le registre peut être restreint : c'est ce qui permet de confier les graves
 * à un piano et les aigus à un autre, chacun suivant sa moitié de la partition.
 * Comme la normalisation se fait après le filtrage, une main gauche discrète
 * fait quand même bouger son piano — sans quoi le second modèle resterait
 * immobile les trois quarts du temps.
 *
 * @param {{notes:Array, duration:number, beats:Array}} midi
 * @param {{from?:number, to?:number}} [range] bornes de hauteur MIDI, incluses
 */
export function buildActivityCurve(midi, { from = 0, to = 127 } = {}) {
  const duration = Math.max(midi.duration, 0.5);
  const size = Math.ceil(duration / STEP) + 2;
  const onset = new Float32Array(size);
  const sustain = new Float32Array(size);

  for (const note of midi.notes) {
    if (note.midi < from || note.midi > to) continue;
    const index = Math.round(note.time / STEP);
    if (index < 0 || index >= size) continue;
    // Une percussion (canal 10) marque le rythme sans « tenir » de son.
    const weight = note.isDrum ? note.velocity * 0.8 : note.velocity;
    onset[index] += weight;

    const end = Math.min(size - 1, Math.round((note.time + note.duration) / STEP));
    const hold = note.isDrum ? 0 : weight * 0.22;
    for (let i = index; i <= end; i += 1) sustain[i] += hold;
  }

  // Décroissance exponentielle des attaques : ~260 ms de traîne.
  const decay = Math.exp(-STEP / 0.26);
  const curve = new Float32Array(size);
  let carried = 0;
  for (let i = 0; i < size; i += 1) {
    carried = carried * decay + onset[i];
    curve[i] = carried + sustain[i];
  }

  const scale = percentileScale(curve);
  for (let i = 0; i < size; i += 1) curve[i] = Math.min(1.6, curve[i] * scale);

  return {
    duration,
    step: STEP,
    values: curve,
    beats: midi.beats ?? [],
    at(time) {
      const index = time / STEP;
      if (index <= 0) return curve[0];
      if (index >= size - 1) return curve[size - 1];
      const low = Math.floor(index);
      const fraction = index - low;
      return curve[low] * (1 - fraction) + curve[low + 1] * fraction;
    },
  };
}

/** Facteur qui amène le 90e centile des valeurs non nulles à 1. */
function percentileScale(values) {
  const active = [];
  for (const value of values) if (value > 0.01) active.push(value);
  if (!active.length) return 1;
  active.sort((a, b) => a - b);
  const reference = active[Math.floor(active.length * 0.9)] || active[active.length - 1];
  return reference > 0 ? 1 / reference : 1;
}

/**
 * Courbe d'activité en direct, pour un morceau audio sans MIDI.
 * On suit l'énergie du signal avec une attaque rapide et une retombée lente,
 * et une normalisation glissante qui s'adapte au niveau du morceau.
 */
export class LiveActivityMeter {
  /** @param {AnalyserNode} analyser */
  constructor(analyser) {
    this.analyser = analyser;
    this.buffer = new Float32Array(analyser.fftSize);
    this.level = 0;
    this.ceiling = 0.05;
    this.beats = [];
    this._lastBeat = -1;
    this._previous = 0;
  }

  /** @returns {number} activité 0 → 1 */
  read() {
    this.analyser.getFloatTimeDomainData(this.buffer);
    let sum = 0;
    for (let i = 0; i < this.buffer.length; i += 1) sum += this.buffer[i] * this.buffer[i];
    const rms = Math.sqrt(sum / this.buffer.length);

    // Attaque immédiate, retombée douce : le mouvement suit les frappes.
    this.level = rms > this.level ? rms : this.level * 0.88 + rms * 0.12;
    // Plafond glissant : monte tout de suite, redescend lentement.
    this.ceiling = Math.max(this.level, this.ceiling * 0.999 + this.level * 0.001, 0.02);

    const activity = Math.min(1.4, this.level / this.ceiling);
    // Une hausse brusque d'énergie tient lieu de détection de temps fort.
    const isTransient = activity - this._previous > 0.18;
    this._previous = activity;
    this.transient = isTransient;
    return activity;
  }

  at() {
    return this.read();
  }
}

/* ------------------------------------------------------------------ */
/* Pilote du moteur                                                    */
/* ------------------------------------------------------------------ */

/**
 * Convertit la courbe d'activité en puissance moteur et l'envoie au hub.
 * Tourne sur son propre minuteur (~25 Hz), indépendant du rendu graphique.
 */
export class MotionDriver extends EventTarget {
  /** @param {import('../lego/hub.js').PianoHub} hub */
  constructor(hub, settings = {}) {
    super();
    this.hub = hub;
    /**
     * Second piano, facultatif. Il n'a pas de pilote à lui : c'est celui-ci
     * qui lui envoie sa consigne dans le même cycle, à quelques millisecondes
     * près — deux minuteurs indépendants se décaleraient à l'oreille comme à
     * l'œil, et deux pianos qui ondulent en léger différé font désordre.
     */
    this.follower = null;
    /** Puissance du second piano au dernier cycle, pour l'affichage. */
    this.followerPower = 0;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.curve = null;
    /** Courbe du second piano — sa moitié de partition, en mode « grave/aigu ». */
    this.followerCurve = null;
    /** Numéro de mesure de chaque temps, pour l'alternance question/réponse. */
    this._barOfBeat = null;
    this.getTime = () => 0;
    this.running = false;
    this.power = 0;
    this._timer = null;
    this._moving = false; // hystérésis : le moteur reste lancé un peu après un pic
    this._quietSince = 0;
    this._beatIndex = 0;
    this._lastLed = 0;

    /** Activité et accent du dernier cycle, plus la cadence réelle du minuteur. */
    this.activity = 0;
    this.accent = 0;
    this.beatIndex = 0;
    this.tickHz = 0;
    this.tickJitterMs = 0;
    this._lastTick = 0;
  }

  update(settings) {
    Object.assign(this.settings, settings);
  }

  /** Branche ou débranche le second piano. */
  attachFollower(hub) {
    if (this.follower && this.follower !== hub) this.follower.stopMotor();
    this.follower = hub ?? null;
    this.followerPower = 0;
  }

  /**
   * @param {{at:(t:number)=>number, beats?:Array}} curve source d'activité
   * @param {() => number} getTime position de lecture, en secondes
   * @param {{followerCurve?:object}} [options] courbe propre au second piano
   */
  start(curve, getTime, { followerCurve = null } = {}) {
    this.stop();
    this.curve = curve;
    this.followerCurve = followerCurve;
    this.getTime = getTime;

    // Table temps → mesure, calculée une fois : l'alternance question/réponse
    // change de piano tous les quatre mesures, pas toutes les N secondes.
    const beats = curve.beats ?? [];
    if (beats.length) {
      this._barOfBeat = new Int32Array(beats.length);
      let bar = -1;
      for (let i = 0; i < beats.length; i += 1) {
        if (beats[i].downbeat) bar += 1;
        this._barOfBeat[i] = Math.max(0, bar);
      }
    } else {
      this._barOfBeat = null;
    }
    this.running = true;
    this._beatIndex = 0;
    this._quietSince = performance.now();
    this._lastTick = 0;

    // Démarrage progressif : l'arbre à cames part sans à-coup, et les premières
    // notes ne trouvent pas un moteur encore immobile. La rampe est lâchée dès
    // que le premier tick calcule une consigne, elle ne fait que l'amorcer.
    if (this.settings.rampStart && this.settings.enabled && this.hub.connected) {
      this.hub.rampPower(0, this.settings.minPower * this.settings.direction, 400);
    }

    this._timer = setInterval(() => this._tick(), TICK_INTERVAL);
    this._tick();
  }

  stop() {
    const wasRunning = this.running;
    this.running = false;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this.power = 0;
    this.followerPower = 0;
    this.activity = 0;
    this.accent = 0;
    this._moving = false;
    if (this.follower?.connected) this.follower.stopMotor();

    // Freinage actif : l'arbre s'arrête net au lieu de finir sur son élan.
    // On ne freine que si le moteur tournait, pour ne pas envoyer de commande
    // inutile à chaque changement de morceau.
    if (wasRunning && this.settings.brakeOnStop && this.hub.connected) {
      this.hub.brake();
    } else {
      this.hub.stopMotor();
    }

    if (this.settings.ledSync) this.hub.setLed(0, 40, 60);
    this.dispatchEvent(new CustomEvent('power', { detail: { power: 0, activity: 0 } }));
  }

  _tick() {
    if (!this.running || !this.curve) return;

    // Cadence réellement obtenue : `setInterval` n'est pas un métronome, et
    // l'écart au pas nominal se voit sur les passages chargés.
    const wallClock = performance.now();
    if (this._lastTick) {
      const elapsed = wallClock - this._lastTick;
      this.tickHz = this.tickHz ? this.tickHz * 0.85 + (1000 / elapsed) * 0.15 : 1000 / elapsed;
      const drift = Math.abs(elapsed - TICK_INTERVAL);
      this.tickJitterMs = this.tickJitterMs * 0.85 + drift * 0.15;
    }
    this._lastTick = wallClock;

    const now = this.getTime();
    const lookAhead = now + this.settings.leadMs / 1000;
    let activity = this.curve.at(lookAhead);

    // Accent sur les temps : un coup de fouet court, plus marqué sur les temps forts.
    const accent = this._accentAt(lookAhead);
    activity = Math.min(1.5, activity + accent * this.settings.accent);

    let power = this._toPower(activity);
    // Question/réponse : chacun son tour, y compris le premier.
    if (this.settings.duet === 'call' && this.follower?.connected && !this._leaderTurn()) power = 0;
    this.power = power;
    this.activity = activity;
    this.accent = accent;
    this.beatIndex = this._beatIndex;

    if (this.settings.enabled && this.hub.connected) {
      this.hub.setMotorPower(power * this.settings.direction);
      this._updateLed(activity);
    }
    this._driveFollower(lookAhead, power, accent);
    this.dispatchEvent(new CustomEvent('power', { detail: { power, activity } }));
  }

  /**
   * Consigne du second piano, dans le même cycle que le premier.
   *
   *   miroir           les deux bougent à l'identique — le plus spectaculaire
   *                    de loin, et ça marche avec n'importe quel morceau ;
   *   grave / aigu     chacun suit sa moitié de la partition : le piano des
   *                    graves brasse régulièrement, celui des aigus s'agite
   *                    sur la mélodie. C'est là qu'on voit deux instruments ;
   *   question/réponse un piano par bloc de quatre mesures, à tour de rôle.
   */
  _driveFollower(lookAhead, leaderPower, accent) {
    const follower = this.follower;
    const mode = this.settings.duet;
    if (!follower?.connected || mode === 'off' || !this.settings.enabled) {
      this.followerPower = 0;
      return;
    }

    let power = leaderPower;
    if (mode === 'split') {
      const curve = this.followerCurve ?? this.curve;
      power = this._toPower(Math.min(1.5, curve.at(lookAhead) + accent * this.settings.accent));
    } else if (mode === 'call') {
      // Le second répond quand le premier se tait : c'est tout le principe.
      power = this._leaderTurn() ? 0 : leaderPower;
    }

    this.followerPower = power;
    follower.setMotorPower(power * this.settings.direction);
  }

  /** Vrai quand c'est au premier piano de parler (blocs de quatre mesures). */
  _leaderTurn() {
    if (!this._barOfBeat?.length) return true;
    const bar = this._barOfBeat[Math.min(this._beatIndex, this._barOfBeat.length - 1)] ?? 0;
    return Math.floor(bar / 4) % 2 === 0;
  }

  _accentAt(time) {
    const beats = this.curve.beats;
    if (!beats?.length) {
      // Sans grille de temps (morceau audio), on se fie aux transitoires.
      return this.curve.transient ? 1 : 0;
    }
    // Avance ou recule dans la grille au lieu de la reparcourir entièrement.
    while (this._beatIndex > 0 && beats[this._beatIndex].time > time) this._beatIndex -= 1;
    while (this._beatIndex < beats.length - 1 && beats[this._beatIndex + 1].time <= time) this._beatIndex += 1;
    const beat = beats[this._beatIndex];
    const since = time - beat.time;
    if (since < 0 || since > 0.11) return 0;
    const shape = 1 - since / 0.11;
    return beat.downbeat ? shape * 1.35 : shape;
  }

  _toPower(activity) {
    const { minPower, maxPower, sensitivity, idleStop } = this.settings;
    const threshold = 0.05;

    if (activity < threshold) {
      // Hystérésis : on ne coupe qu'après un vrai silence, sinon le moteur hoquette.
      if (!this._moving) return 0;
      if (performance.now() - this._quietSince > 220) {
        this._moving = false;
        return 0;
      }
      return idleStop ? Math.round(minPower * 0.7) : minPower;
    }

    this._quietSince = performance.now();
    this._moving = true;
    // Exposant < 1 : les nuances moyennes font déjà bien bouger les touches.
    const shaped = Math.min(1, activity) ** (1.35 - sensitivity);
    return Math.round(minPower + (maxPower - minPower) * shaped);
  }

  _updateLed(activity) {
    if (!this.settings.ledSync) return;
    const now = performance.now();
    if (now - this._lastLed < 250) return;
    this._lastLed = now;
    const intensity = Math.min(1, activity);
    this.hub.setLed(
      Math.round(30 + 225 * intensity),
      Math.round(80 - 50 * intensity),
      Math.round(140 - 120 * intensity)
    );
  }
}
