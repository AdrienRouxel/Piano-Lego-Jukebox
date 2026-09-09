/**
 * Le mode partition : l'écran devient un pupitre.
 *
 * Une seule et même vue sert les deux surfaces du projet, qui n'ont pourtant
 * ni le même écran ni la même horloge :
 *
 *   • le jukebox (`index.html`), où la partition lit la seconde exacte dans le
 *     lecteur audio de la page — synchronisation parfaite ;
 *   • la télécommande (`remote.html`), où le téléphone d'un visiteur n'a que
 *     le flux du stand : une position toutes les deux secondes, qu'il faut
 *     prolonger soi-même entre deux trames.
 *
 * D'où la forme de ce module : il ne sait pas d'où vient le temps. On lui
 * donne une fonction qui répond « où en est la musique », et il s'occupe du
 * reste — l'affichage, la rotation du téléphone, le tourne-page, la sortie.
 *
 * Le mode s'ouvre tout seul quand on couche un téléphone, et se referme quand
 * on le redresse ; partout ailleurs, c'est un bouton qui l'ouvre.
 */

import { ScoreView } from './music/score.js';

/**
 * Un téléphone couché : peu de hauteur, plus de largeur que de hauteur, et un
 * doigt plutôt qu'une souris. Les trois conditions comptent — un ordinateur
 * portable est large lui aussi, et n'a rien à faire en mode pupitre sans
 * qu'on le lui demande.
 */
const PHONE_LANDSCAPE = '(orientation: landscape) and (max-height: 560px) and (pointer: coarse)';

/** Pas de réglage du calage, en secondes. */
const NUDGE = 0.1;

export class ScoreMode {
  /**
   * @param {object} options
   * @param {() => number} options.clock position de lecture, en secondes
   * @param {() => boolean} [options.isPlaying] pour distinguer l'arrêt de la lecture
   * @param {boolean} [options.nudge] afficher le réglage de calage (télécommande)
   * @param {(open: boolean) => void} [options.onToggle]
   */
  constructor({ clock, isPlaying = () => true, nudge = false, onToggle = null } = {}) {
    this.clock = clock;
    this.isPlaying = isPlaying;
    this.onToggle = onToggle;
    /** Décalage manuel, en secondes : le réseau n'arrive jamais tout à fait à l'heure. */
    this.offset = 0;
    this.isOpen = false;
    this.track = null;
    this._frame = null;
    this._auto = false;
    this._openedByRotation = false;
    /** Fermé à la main : on ne rouvre pas dans le dos de qui vient de sortir. */
    this._dismissed = false;

    this._build(nudge);
    this.view = new ScoreView(this.dom.sheet, { coarse: matchMedia('(pointer: coarse)').matches });

    this._query = matchMedia(PHONE_LANDSCAPE);
    this._onOrientation = () => this._followOrientation();
    this._query.addEventListener('change', this._onOrientation);

    // Le clavier reste la sortie la plus sûre : sur un ordinateur, le bouton
    // de fermeture peut se retrouver hors de l'écran en plein écran.
    document.addEventListener('keydown', (event) => {
      if (this.isOpen && event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });

    // Tourner le téléphone change la place disponible : il faut regraver.
    const resize = () => {
      if (this.isOpen && this.view.relayout()) this._render();
    };
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  }

  /* ---------------------------------------------------------------- */
  /* Construction                                                     */
  /* ---------------------------------------------------------------- */

  _build(nudge) {
    const root = document.createElement('div');
    root.className = 'score-mode';
    root.hidden = true;
    root.setAttribute('aria-label', 'Partition');
    root.innerHTML = `
      <header class="score-bar">
        <div class="score-id">
          <strong class="score-title"></strong>
          <span class="score-artist"></span>
        </div>
        <div class="score-tools">
          ${nudge ? `
          <div class="score-nudge" role="group" aria-label="Calage de la partition">
            <button type="button" class="score-nudge-btn" data-step="-1" aria-label="Avancer la partition">−</button>
            <output class="score-nudge-value">0,0 s</output>
            <button type="button" class="score-nudge-btn" data-step="1" aria-label="Retarder la partition">+</button>
          </div>` : ''}
          <span class="score-pages" aria-live="off"></span>
          <button type="button" class="score-close" aria-label="Quitter la partition">✕</button>
        </div>
      </header>
      <div class="score-sheet"></div>
      <p class="score-note" hidden></p>`;
    document.body.append(root);

    this.dom = {
      root,
      title: root.querySelector('.score-title'),
      artist: root.querySelector('.score-artist'),
      pages: root.querySelector('.score-pages'),
      sheet: root.querySelector('.score-sheet'),
      note: root.querySelector('.score-note'),
      nudgeValue: root.querySelector('.score-nudge-value'),
    };

    root.querySelector('.score-close').addEventListener('click', () => this.close());
    for (const button of root.querySelectorAll('.score-nudge-btn')) {
      button.addEventListener('click', () => {
        this.offset += Number(button.dataset.step) * NUDGE;
        this._renderNudge();
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Morceau affiché                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Change ce qui est gravé.
   * @param {{title?: string, artist?: string|null, midi?: object|null, loading?: boolean}|null} track
   */
  setTrack(track) {
    this.track = track;
    this.dom.title.textContent = track?.title ?? '';
    this.dom.artist.textContent = track?.artist ?? '';
    this.view.setMidi(track?.midi ?? null);
    this._renderNote();
    if (this.isOpen) this._render();
    // Un morceau qui démarre alors que le téléphone est déjà couché : c'est
    // maintenant qu'il y a quelque chose à montrer.
    else this._followOrientation();
  }

  /** Vrai si le morceau en cours a une partition à montrer. */
  get hasScore() {
    return Boolean(this.track?.midi);
  }

  _renderNote() {
    const note = this.dom.note;
    this.dom.root.dataset.empty = this.hasScore ? '0' : '1';
    if (this.hasScore) {
      note.hidden = true;
      return;
    }
    note.hidden = false;
    note.textContent = this.track?.loading
      // Sur un forfait mobile, le fichier met parfois une seconde à venir :
      // mieux vaut le dire que laisser croire qu'il n'y a rien à montrer.
      ? 'Gravure de la partition…'
      : this.track
        ? 'Ce morceau n’a pas de partition : le piano le joue d’oreille, à partir de l’enregistrement.'
        : 'Aucun morceau en cours. La partition apparaîtra dès que la musique démarrera.';
  }

  _renderNudge() {
    if (!this.dom.nudgeValue) return;
    const value = Math.round(this.offset * 10) / 10;
    this.dom.nudgeValue.textContent = `${value > 0 ? '+' : ''}${value.toFixed(1).replace('.', ',')} s`;
  }

  /* ---------------------------------------------------------------- */
  /* Ouverture et fermeture                                           */
  /* ---------------------------------------------------------------- */

  open({ byRotation = false } = {}) {
    if (this.isOpen) return;
    this.isOpen = true;
    this._openedByRotation = byRotation;
    this.dom.root.hidden = false;
    document.body.dataset.score = '1';
    // La gravure a besoin de connaître la place : elle n'existe qu'une fois
    // l'élément affiché.
    this.view.relayout(true);
    this._render();
    this._frame = requestAnimationFrame(() => this._tick());
    this.onToggle?.(true);
  }

  /**
   * @param {object} [options]
   * @param {boolean} [options.dismissed] fermeture demandée par l'utilisateur
   */
  close({ dismissed = true } = {}) {
    if (!this.isOpen) return;
    this._dismissed = dismissed;
    this.isOpen = false;
    this._openedByRotation = false;
    this.dom.root.hidden = true;
    delete document.body.dataset.score;
    if (this._frame) cancelAnimationFrame(this._frame);
    this._frame = null;
    // On ne rend que le plein écran qu'on a soi-même demandé : le mode stand
    // met la page entière en plein écran, et en sortir ici le ferait tomber.
    if (document.fullscreenElement === this.dom.root) document.exitFullscreen?.().catch(() => {});
    this.onToggle?.(false);
  }

  /**
   * Ouverture demandée par un geste — un bouton, une touche. Le plein écran
   * n'est permis que dans ce cas-là : les navigateurs l'exigent. Refusé, ce
   * n'est pas grave, la partition s'affiche quand même.
   */
  openByHand() {
    this._dismissed = false;
    if (this.isOpen) return;
    this.open();
    // Inutile de le redemander si la page y est déjà — le mode stand, par
    // exemple : le pupitre couvre déjà tout l'écran.
    if (!document.fullscreenElement) {
      this.dom.root.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
    }
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.openByHand();
  }

  /**
   * Fait suivre l'orientation du téléphone : couché, le pupitre s'ouvre ;
   * redressé, il se referme — mais seulement s'il s'était ouvert tout seul.
   * Quelqu'un qui l'a demandé à la main garde ce qu'il a demandé.
   */
  autoLandscape(enabled) {
    this._auto = Boolean(enabled);
    this._followOrientation();
  }

  _followOrientation() {
    if (!this._auto) return;
    if (this._query.matches) {
      // Un pupitre vide n'a rien à montrer, et recouvrirait la page pour
      // rien : on attend qu'il y ait une partition.
      if (!this.isOpen && !this._dismissed && this.hasScore) this.open({ byRotation: true });
    } else {
      // Le téléphone redressé remet les compteurs à zéro : le prochain
      // basculement en paysage rouvrira le pupitre.
      this._dismissed = false;
      if (this.isOpen && this._openedByRotation) this.close({ dismissed: false });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Suivi                                                            */
  /* ---------------------------------------------------------------- */

  _render() {
    this._renderNote();
    this._renderNudge();
    if (this.hasScore) this.view.update(Math.max(0, this.clock() + this.offset));
    this._renderPages();
  }

  _renderPages() {
    const total = this.view.pageCount;
    this.dom.pages.textContent = total > 1 ? `${this.view.pageNumber} / ${total}` : '';
  }

  _tick() {
    if (!this.isOpen) return;
    if (this.hasScore) {
      this.view.update(Math.max(0, this.clock() + this.offset));
      this._renderPages();
    }
    this._frame = requestAnimationFrame(() => this._tick());
  }
}

/** Vrai si l'appareil est un téléphone tenu à l'horizontale. */
export function isPhoneLandscape() {
  return matchMedia(PHONE_LANDSCAPE).matches;
}
