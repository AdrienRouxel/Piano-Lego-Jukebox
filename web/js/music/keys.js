/**
 * Le clavier de l'écran, rendu jouable.
 *
 * C'est la fonction qui fait le plus d'effet sur un stand : un visiteur pose
 * le doigt sur une touche, le son sort de l'ordinateur — et l'arbre à cames
 * du modèle LEGO se met à tourner. Il n'y a pas de tour de passe-passe : le
 * moteur reçoit exactement la même consigne que pendant un morceau, calculée
 * par le même pilote, à partir des notes qu'on vient de jouer.
 *
 * Rappel utile à dire aux visiteurs : le 21323 n'a qu'un moteur, et il
 * entraîne tout l'arbre à cames. On ne peut donc pas lui faire enfoncer *la*
 * touche jouée — il ondule, plus ou moins vite selon ce qu'on joue.
 *
 * Trois façons de jouer, les trois branchées sur le même chemin :
 *   • à la souris ou au doigt, sur le clavier « partition » ;
 *   • au clavier de l'ordinateur, deux rangées cartographiées ;
 *   • plusieurs doigts à la fois — les accords fonctionnent.
 */

/**
 * Cartographie du clavier de l'ordinateur, par `event.code` : ce sont les
 * touches *physiques*, indépendantes de la disposition. Le même code marche
 * donc en AZERTY, en QWERTY et en QWERTZ, ce qu'un relevé de `event.key`
 * n'aurait jamais permis.
 *
 * Deux rangées, comme sur un vrai clavier : les blanches en bas, les noires
 * juste au-dessus, à leur place.
 */
const KEY_MAP = {
  // Rangée basse : do4 → mi5, les touches blanches.
  KeyZ: 60, KeyX: 62, KeyC: 64, KeyV: 65, KeyB: 67, KeyN: 69, KeyM: 71,
  Comma: 72, Period: 74, Slash: 76,
  // Rangée du dessus : les altérations, aux trous près.
  KeyS: 61, KeyD: 63, KeyG: 66, KeyH: 68, KeyJ: 70, KeyL: 73, Semicolon: 75,
  // Rangée haute : une octave de plus, pour les deux mains.
  KeyQ: 72, KeyW: 74, KeyE: 76, KeyR: 77, KeyT: 79, KeyY: 81, KeyU: 83, KeyI: 84,
  Digit2: 73, Digit3: 75, Digit5: 78, Digit6: 80, Digit7: 82,
};

/** Décroissance de l'activité après une attaque (secondes). */
const DECAY = 0.3;
/** Fond entretenu tant qu'une touche reste enfoncée. */
const SUSTAIN_LEVEL = 0.34;

export class PlayableKeys extends EventTarget {
  /**
   * @param {object} options
   * @param {HTMLElement} options.container le clavier « partition »
   * @param {Map<number, HTMLElement>} options.keys table midi → touche
   * @param {() => import('./player.js').Player|null} options.getPlayer
   */
  constructor({ container, keys, getPlayer }) {
    super();
    this.container = container;
    this.keys = keys;
    this.getPlayer = getPlayer;
    this.enabled = false;

    /** @type {Map<number, {velocity:number, at:number}>} notes tenues, par hauteur */
    this._held = new Map();
    /** @type {Map<number, number>} doigt ou souris → hauteur tenue */
    this._pointers = new Map();
    /** @type {Set<string>} codes de touches du clavier enfoncées */
    this._physical = new Set();

    this._level = 0;
    this._lastRead = performance.now();
    this._attacked = false;
    /** Lu par le pilote moteur, comme pour un morceau audio. */
    this.transient = false;
    /** Grille de temps : il n'y en a pas quand on improvise. */
    this.beats = [];

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
  }

  /* ---------------------------------------------------------------- */

  setEnabled(enabled) {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.container.dataset.playable = enabled ? '1' : '0';

    if (enabled) {
      // Le clavier n'était qu'un afficheur : il devient un instrument.
      this.container.removeAttribute('aria-hidden');
      this.container.setAttribute('role', 'group');
      this.container.setAttribute('aria-label', 'Clavier jouable — clique une touche, ou joue avec le clavier de l’ordinateur');
      this.container.addEventListener('pointerdown', this._onPointerDown);
      window.addEventListener('pointermove', this._onPointerMove);
      window.addEventListener('pointerup', this._onPointerUp);
      window.addEventListener('pointercancel', this._onPointerUp);
      window.addEventListener('keydown', this._onKeyDown);
      window.addEventListener('keyup', this._onKeyUp);
      return;
    }

    this.container.setAttribute('aria-hidden', 'true');
    this.container.removeAttribute('role');
    this.container.removeAttribute('aria-label');
    this.container.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this.releaseAll();
  }

  /** Notes tenues, dans la forme attendue par l'affichage du clavier. */
  get sounding() {
    return [...this._held].map(([midi, note]) => ({ midi, velocity: note.velocity }));
  }

  /** Vrai tant qu'une note résonne encore : le pilote moteur doit tourner. */
  get active() {
    return this._held.size > 0 || this._level > 0.04;
  }

  /* ---------------------------------------------------------------- */
  /* Source d'activité pour le pilote moteur                           */
  /* ---------------------------------------------------------------- */

  /**
   * Même contrat que la courbe d'un morceau : une valeur 0 → 1. Ici elle est
   * produite en direct — une impulsion à chaque attaque, qui retombe, plus un
   * fond tant que des touches restent enfoncées.
   */
  at() {
    const now = performance.now();
    const elapsed = Math.max(0, (now - this._lastRead) / 1000);
    this._lastRead = now;
    this._level *= Math.exp(-elapsed / DECAY);

    this.transient = this._attacked;
    this._attacked = false;
    return Math.min(1.4, Math.max(this._level, this._held.size ? SUSTAIN_LEVEL : 0));
  }

  /* ---------------------------------------------------------------- */
  /* Déclenchement                                                     */
  /* ---------------------------------------------------------------- */

  /**
   * @param {number} midi
   * @param {number} velocity 0 → 1
   */
  press(midi, velocity = 0.75) {
    if (this._held.has(midi)) return;
    const player = this.getPlayer();
    const sampler = player?.sampler;
    if (!sampler) return;
    if (player.context?.state === 'suspended') player.context.resume();

    sampler.noteOn(midi, velocity);
    this._held.set(midi, { velocity, at: performance.now() });
    this._level = Math.min(1.4, this._level + velocity);
    this._attacked = true;
    this.dispatchEvent(new CustomEvent('note', { detail: { midi, velocity } }));
  }

  release(midi) {
    if (!this._held.has(midi)) return;
    this._held.delete(midi);
    this.getPlayer()?.sampler?.noteOff(midi);
  }

  releaseAll() {
    for (const midi of [...this._held.keys()]) this.release(midi);
    this._pointers.clear();
    this._physical.clear();
  }

  /* ---------------------------------------------------------------- */
  /* Souris et doigts                                                  */
  /* ---------------------------------------------------------------- */

  /** Hauteur et nuance sous un point de l'écran. */
  _hit(x, y) {
    const element = document.elementFromPoint(x, y);
    const key = element?.closest?.('.key');
    if (!key || !this.container.contains(key)) return null;
    const midi = Number(key.dataset.midi);
    if (!Number.isFinite(midi)) return null;

    // Comme sur un vrai clavier : frapper près du bord de la touche demande
    // moins de force qu'au fond. On en fait une nuance.
    const box = key.getBoundingClientRect();
    const depth = box.height ? Math.min(1, Math.max(0, (y - box.top) / box.height)) : 0.6;
    return { midi, velocity: 0.45 + depth * 0.5 };
  }

  _onPointerDown(event) {
    const hit = this._hit(event.clientX, event.clientY);
    if (!hit) return;
    event.preventDefault();
    this._pointers.set(event.pointerId, hit.midi);
    this.press(hit.midi, hit.velocity);
  }

  _onPointerMove(event) {
    if (!this._pointers.has(event.pointerId)) return;
    const hit = this._hit(event.clientX, event.clientY);
    const previous = this._pointers.get(event.pointerId);
    if (!hit || hit.midi === previous) return;
    // Glissando : on relâche la touche qu'on quitte et on attaque la suivante.
    this.release(previous);
    this._pointers.set(event.pointerId, hit.midi);
    this.press(hit.midi, hit.velocity);
  }

  _onPointerUp(event) {
    const midi = this._pointers.get(event.pointerId);
    if (midi === undefined) return;
    this._pointers.delete(event.pointerId);
    // Deux doigts sur la même touche : elle ne s'éteint qu'au dernier.
    if (![...this._pointers.values()].includes(midi)) this.release(midi);
  }

  /* ---------------------------------------------------------------- */
  /* Clavier de l'ordinateur                                           */
  /* ---------------------------------------------------------------- */

  _onKeyDown(event) {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof Element && target.matches('input, textarea, select')) return;
    const midi = KEY_MAP[event.code];
    if (midi === undefined) return;
    event.preventDefault();
    this._physical.add(event.code);
    this.press(midi, 0.72);
  }

  _onKeyUp(event) {
    if (!this._physical.delete(event.code)) return;
    const midi = KEY_MAP[event.code];
    if (midi === undefined) return;
    // Deux touches physiques peuvent viser la même note (le do de jonction) :
    // on ne relâche que si plus aucune ne la tient.
    const stillHeld = [...this._physical].some((code) => KEY_MAP[code] === midi);
    if (!stillHeld) this.release(midi);
  }
}
