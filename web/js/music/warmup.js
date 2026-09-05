/**
 * Mise en route : une petite scène avant que la musique parte.
 *
 * Un chef d'orchestre entre à l'écran et demande au piano s'il est prêt. Le
 * piano répond en faisant sonner quelques touches — un arpège, puis un accord
 * affirmatif. Le chef écoute, et quand la réponse est finie il donne le départ.
 *
 * Le son sort toujours de l'ordinateur : c'est lui qui joue, dans ce projet.
 * Quand le hub est connecté, l'arbre à cames tourne en plus au rythme de la
 * réponse ; sinon on se contente du clavier à l'écran et la scène est la même.
 * Rien ici ne dépend donc du Bluetooth.
 */

/**
 * La réponse du piano, en secondes depuis son premier son : arpège de do
 * majeur qui monte, deux notes qui redescendent, puis un accord tenu — la
 * façon la plus courte de dire « oui ». Tout tient dans les 25 touches du
 * modèle 21323 (do3 → do5), sauf la basse qui ancre l'accord.
 */
const ANSWER = [
  { midi: 60, at: 0.00, dur: 0.30, vel: 0.60 },
  { midi: 64, at: 0.12, dur: 0.30, vel: 0.64 },
  { midi: 67, at: 0.24, dur: 0.30, vel: 0.68 },
  { midi: 72, at: 0.36, dur: 0.42, vel: 0.80 },
  { midi: 67, at: 0.56, dur: 0.20, vel: 0.56 },
  { midi: 64, at: 0.68, dur: 0.20, vel: 0.54 },
  { midi: 48, at: 0.86, dur: 1.10, vel: 0.74 },
  { midi: 60, at: 0.86, dur: 1.10, vel: 0.66 },
  { midi: 64, at: 0.86, dur: 1.10, vel: 0.62 },
  { midi: 67, at: 0.86, dur: 1.10, vel: 0.60 },
];

const ANSWER_DURATION = Math.max(...ANSWER.map((note) => note.at + note.dur));

/** Déroulé de la scène, en millisecondes depuis le début. */
const CUE = {
  enter: 0,
  ask: 480,
  listen: 1900,
  answer: 2050,
};
CUE.go = CUE.answer + Math.round(ANSWER_DURATION * 1000) + 180;
CUE.leave = CUE.go + 1050;
CUE.end = CUE.leave + 420;

const ASK_LINE = 'Est-ce que tu es prêt ?';
const GO_LINE = 'Alors, c’est parti !';

/** Traîne d'une attaque dans la consigne moteur (secondes). */
const MOTOR_DECAY = 0.22;

export class Warmup {
  /**
   * @param {{overlay:HTMLElement, line:HTMLElement}} dom
   * @param {import('../lego/hub.js').PianoHub} hub
   * @param {object} settings réglages partagés du jukebox
   */
  constructor(dom, hub, settings) {
    this.dom = dom;
    this.hub = hub;
    this.settings = settings;

    /** Vrai tant que la scène est à l'écran. */
    this.active = false;
    /** Consigne moteur du moment, -100 → 100 ; l'écran s'en sert aussi. */
    this.power = 0;
    /** Notes de la réponse en train de sonner, pour peindre le clavier. */
    this.sounding = [];

    this._player = null;
    this._answerAt = 0; // performance.now() du premier son de la réponse
    this._resolve = null;
    this._timers = [];
    this._droveMotor = false;

    // Un clic sur la scène passe l'introduction et enchaîne sur la musique.
    dom.overlay.addEventListener('click', () => this.skip());
  }

  /**
   * Joue la scène du début à la fin.
   * @param {import('./player.js').Player} player
   * @returns {Promise<boolean>} vrai s'il faut enchaîner sur la musique.
   */
  run(player) {
    if (this.active) return Promise.resolve(false);

    this._player = player;
    this.active = true;
    this.power = 0;
    this.sounding = [];
    this._answerAt = 0;
    this._droveMotor = false;

    return new Promise((resolve) => {
      this._resolve = resolve;
      this._show();
      this._at(CUE.ask, () => {
        this._phase('ask');
        this._say(ASK_LINE);
        this._led(70, 45, 10);
      });
      this._at(CUE.listen, () => {
        // La bulle reste, mais la question laisse place aux points de suspension.
        this._phase('listen');
        this._say('');
      });
      this._at(CUE.answer, () => this._answer());
      this._at(CUE.go, () => {
        this._phase('go');
        this._say(GO_LINE);
        this._led(10, 80, 30);
      });
      this._at(CUE.leave, () => this._phase('leave'));
      this._at(CUE.end, () => this._finish(true));
    });
  }

  /** Abrège la scène : la musique part tout de suite. */
  skip() {
    if (this.active) this._finish(true);
  }

  /** Interrompt la scène sans lancer la musique. */
  cancel() {
    if (this.active) this._finish(false);
  }

  /**
   * Avance l'état visible de la réponse. Appelé à chaque image par la boucle
   * d'affichage, qui lit ensuite `sounding` et `power`.
   */
  tick(now = performance.now()) {
    if (!this.active || !this._answerAt) return;
    const time = (now - this._answerAt) / 1000;

    this.sounding = ANSWER.filter((note) => time >= note.at && time < note.at + note.dur);

    const power = this._motorPower(time);
    if (power === this.power) return;
    this.power = power;
    // Comme la chorégraphie d'un morceau : le sens ne s'applique qu'au moteur,
    // l'arbre à cames de l'écran tourne toujours dans le même sens.
    if (this.settings.enabled && this.hub.connected) {
      this._droveMotor = true;
      this.hub.setMotorPower(power * (this.settings.direction ?? 1));
    }
  }

  /* ---------------------------------------------------------------- */

  /**
   * Consigne moteur déduite de la réponse : chaque attaque donne une impulsion
   * qui retombe. Même logique que la chorégraphie d'un morceau, en plus court.
   */
  _motorPower(time) {
    let level = 0;
    for (const note of ANSWER) {
      if (time < note.at) break; // la liste est triée par instant d'attaque
      level = Math.max(level, note.vel * Math.exp(-(time - note.at) / MOTOR_DECAY));
    }
    if (level < 0.06) return 0;
    const { minPower, maxPower } = this.settings;
    const span = Math.max(0, maxPower - minPower);
    return Math.round(minPower + span * Math.min(1, level * 1.25));
  }

  _answer() {
    const player = this._player;
    if (!player?.sampler) return;
    // Les notes sont programmées d'avance sur l'horloge audio : aucun minuteur
    // JavaScript ne vient décaler l'arpège.
    if (player.context.state === 'suspended') player.context.resume();
    const start = player.context.currentTime + 0.05;
    for (const note of ANSWER) {
      player.sampler.noteOn(note.midi, note.vel, start + note.at, note.dur);
    }
    this._answerAt = performance.now() + 50;
  }

  _show() {
    this.dom.line.textContent = '';
    this.dom.overlay.removeAttribute('data-phase');
    this.dom.overlay.hidden = false;
    // Deux images d'attente : sans cela le navigateur pose le chef à sa place
    // finale sans jouer la transition d'entrée.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (this.active) this._phase('enter');
    }));
  }

  _phase(phase) {
    this.dom.overlay.dataset.phase = phase;
  }

  _say(text) {
    this.dom.line.textContent = text;
  }

  _led(r, g, b) {
    if (this.settings.ledSync && this.hub.connected) this.hub.setLed(r, g, b);
  }

  _at(delay, action) {
    this._timers.push(setTimeout(action, delay));
  }

  _finish(completed) {
    for (const timer of this._timers) clearTimeout(timer);
    this._timers.length = 0;

    this.active = false;
    this.power = 0;
    this.sounding = [];
    this._answerAt = 0;

    this._player?.sampler?.allNotesOff();
    if (this._droveMotor) this.hub.stopMotor();
    this._led(0, 40, 60);

    this.dom.overlay.hidden = true;
    this.dom.overlay.removeAttribute('data-phase');

    const resolve = this._resolve;
    this._resolve = null;
    resolve?.(completed);
  }
}
