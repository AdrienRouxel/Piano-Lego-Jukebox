/**
 * Ordre de lecture : enchaînement, lecture aléatoire, répétition.
 *
 * Un jukebox de stand ne doit jamais retomber dans le silence — c'est le
 * silence qui fait passer les visiteurs devant la table sans s'arrêter. Ce
 * module décide donc quel morceau vient après celui qui vient de finir, avec
 * trois réglages qui se combinent :
 *
 *   • aléatoire — un sac : on tire sans remise jusqu'à l'avoir vidé, puis on
 *     le remplit à nouveau. Personne n'entend deux fois le même morceau avant
 *     d'avoir fait le tour de la bibliothèque, ce qu'un tirage naïf ne
 *     garantit pas du tout ;
 *   • répétition « liste » — arrivé au bout, on repart au début ;
 *   • répétition « morceau » — on rejoue le même, pour un réglage moteur.
 *
 * La file d'attente des visiteurs n'est pas gérée ici : elle passe avant
 * tout le reste, et c'est le jukebox qui la consulte en premier.
 */

/** Répétitions possibles, dans l'ordre du bouton qui les fait tourner. */
export const REPEAT_MODES = ['off', 'all', 'one'];

export class Playlist {
  constructor() {
    /** @type {Array} morceaux, dans l'ordre de la bibliothèque */
    this.tracks = [];
    this.shuffle = false;
    /** @type {'off'|'all'|'one'} */
    this.repeat = 'off';
    /** Indices restant à tirer dans le sac courant. */
    this._bag = [];
  }

  /**
   * Remplace la bibliothèque. Le sac est vidé : il désignait des positions
   * qui n'ont plus le même sens.
   */
  setTracks(tracks) {
    this.tracks = tracks;
    this._bag = [];
  }

  get length() {
    return this.tracks.length;
  }

  /** Repart d'un sac plein, mélangé, sans le morceau qu'on vient d'entendre. */
  _refillBag(exclude = -1) {
    const indices = this.tracks.map((_, index) => index);
    // Mélange de Fisher-Yates : chaque ordre a exactement la même probabilité.
    for (let i = indices.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    // Enchaîner deux fois le même morceau se remarque tout de suite : si le
    // sort a mis le sortant en tête, on le renvoie au fond.
    if (indices.length > 1 && indices[0] === exclude) {
      indices.push(indices.shift());
    }
    this._bag = indices;
  }

  /**
   * Morceau suivant.
   *
   * @param {number} current index courant, -1 si rien n'est chargé
   * @param {boolean} auto vrai quand c'est la fin d'un morceau qui appelle,
   *   faux quand c'est un clic sur « suivant ». La répétition d'un seul
   *   morceau ne s'applique qu'au premier cas : un clic doit toujours avancer.
   * @returns {number} index à jouer, ou -1 s'il faut s'arrêter
   */
  next(current, auto = false) {
    if (!this.tracks.length) return -1;
    if (auto && this.repeat === 'one') return Math.max(0, current);

    if (this.shuffle) {
      if (!this._bag.length) {
        // Sac vide : on ne le remplit à nouveau que si l'on a le droit de
        // reboucler — sinon la lecture automatique s'arrête là.
        if (auto && this.repeat === 'off') return -1;
        this._refillBag(current);
      }
      const index = this._bag.shift();
      return index === current && this._bag.length ? this._bag.shift() : index;
    }

    const following = current + 1;
    if (following < this.tracks.length) return following;
    // Bout de la liste : on reboucle si on y est autorisé, ou si l'utilisateur
    // a lui-même cliqué sur « suivant ».
    if (!auto || this.repeat === 'all') return 0;
    return -1;
  }

  /**
   * Morceau précédent. En lecture aléatoire il n'y a pas d'« avant »
   * évident : on retire simplement une carte du sac, comme pour « suivant ».
   */
  previous(current) {
    if (!this.tracks.length) return -1;
    if (this.shuffle) return this.next(current, false);
    return (current - 1 + this.tracks.length) % this.tracks.length;
  }

  /** Fait tourner la répétition : aucune → liste → morceau → aucune. */
  cycleRepeat() {
    const index = REPEAT_MODES.indexOf(this.repeat);
    this.repeat = REPEAT_MODES[(index + 1) % REPEAT_MODES.length];
    return this.repeat;
  }
}
