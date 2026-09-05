/**
 * Fabrique et met à jour les éléments visuels : les deux claviers, les
 * pochettes générées, les notifications et le journal.
 */

/**
 * Vitesse de l'arbre à cames à pleine puissance, en tours par seconde.
 * Le moteur ne tourne pas en prise directe : le train d'engrenages qui le
 * sépare de l'axe divise sa vitesse nominale, et l'ondulation des touches est
 * bien plus lente que le moteur. Estimation à recaler en filmant le modèle.
 */
export const CAMSHAFT_MAX_TURNS_PER_SECOND = 0.9;

/**
 * Position de la came, entre 0 et 1, à partir de laquelle elle commence à
 * soulever la touche — puis à partir de laquelle la touche est franchement
 * enfoncée. Le second seuil est haut : sur l'axe réel, seul le sommet de chaque
 * levier tient une touche en bas, et il n'y en a que quelques-unes à la fois.
 */
const LIFT_START = 0.55;
const PRESS_START = 0.86;

const WHITE_PITCH_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);
const NOTE_LABELS = ['do', 'do♯', 'ré', 'ré♯', 'mi', 'fa', 'fa♯', 'sol', 'sol♯', 'la', 'la♯', 'si'];

export const isWhiteKey = (midi) => WHITE_PITCH_CLASSES.has(((midi % 12) + 12) % 12);

/**
 * Construit un clavier entre deux notes MIDI et renvoie la table des touches.
 * @returns {Map<number, HTMLElement>}
 */
export function buildKeyboard(container, lowMidi, highMidi) {
  container.textContent = '';
  const keys = new Map();

  let whiteCount = 0;
  for (let midi = lowMidi; midi <= highMidi; midi += 1) if (isWhiteKey(midi)) whiteCount += 1;
  const whiteWidth = 100 / whiteCount;
  const blackWidth = whiteWidth * 0.62;

  let whiteIndex = 0;
  for (let midi = lowMidi; midi <= highMidi; midi += 1) {
    const key = document.createElement('span');
    key.className = `key ${isWhiteKey(midi) ? 'white' : 'black'}`;
    key.dataset.midi = String(midi);
    // La classe de hauteur (do = 0 … si = 11) sert au thème LEGO, qui donne
    // une couleur de brique à chacun des douze demi-tons.
    key.dataset.pitchClass = String(((midi % 12) + 12) % 12);

    if (isWhiteKey(midi)) {
      key.style.left = `${whiteIndex * whiteWidth}%`;
      key.style.width = `${whiteWidth}%`;
      whiteIndex += 1;
    } else {
      // Une touche noire chevauche la frontière entre deux touches blanches.
      key.style.left = `${whiteIndex * whiteWidth - blackWidth / 2}%`;
      key.style.width = `${blackWidth}%`;
      key.style.height = '58%';
    }
    container.append(key);
    keys.set(midi, key);
  }
  return keys;
}

/**
 * Le clavier « modèle LEGO » : 25 touches soulevées par un arbre à cames.
 *
 * Chaque levier est calé à un angle différent de ses voisins — c'est ce qui
 * produit la vague désordonnée du vrai modèle. On reproduit cette répartition
 * avec l'angle d'or, qui étale les phases sans jamais les aligner.
 */
export function buildCamshaft(container, lowMidi = 48, count = 25) {
  const keys = buildKeyboard(container, lowMidi, lowMidi + count - 1);
  const entries = [...keys.entries()].map(([midi, element], index) => ({
    element,
    phase: (index * 2.399963) % (Math.PI * 2), // angle d'or, en radians
    midi,
  }));

  let angle = 0;
  let amplitude = 0; // 0 = clavier au repos, 1 = arbre en pleine rotation

  return {
    /**
     * @param {number} power puissance moteur, -100 → 100
     * @param {number} dt secondes écoulées depuis la dernière image
     */
    update(power, dt) {
      angle += (power / 100) * CAMSHAFT_MAX_TURNS_PER_SECOND * Math.PI * 2 * dt;
      const target = power === 0 ? 0 : 1;
      // Quand le moteur s'arrête, les touches retombent — sans à-coup.
      amplitude += (target - amplitude) * Math.min(1, dt * (target ? 14 : 5));

      for (const entry of entries) {
        const lift = Math.sin(angle + entry.phase);
        // Le mouvement suit la came sur toute sa montée ; la mise en couleur,
        // elle, attend le sommet — sans quoi un tiers du clavier reste allumé
        // en permanence, ce qui ne ressemble ni au modèle ni à la partition.
        const depth = lift > LIFT_START ? ((lift - LIFT_START) / (1 - LIFT_START)) * amplitude : 0;
        entry.element.style.transform = depth > 0.01 ? `translateY(${(depth * 5).toFixed(2)}px)` : '';
        entry.element.dataset.on = lift > PRESS_START && amplitude > 0.2 ? '1' : '0';
      }
    },
    reset() {
      angle = 0;
      amplitude = 0;
      for (const entry of entries) {
        entry.element.style.transform = '';
        entry.element.dataset.on = '0';
      }
    },
  };
}

/** Met en surbrillance les notes qui sonnent, et éteint les autres. */
export function paintNotes(keys, notes) {
  const active = new Set(notes.map((note) => note.midi));
  for (const [midi, key] of keys) {
    const on = active.has(midi);
    if ((key.dataset.on === '1') !== on) key.dataset.on = on ? '1' : '0';
  }
  return active;
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function noteName(midi) {
  return `${NOTE_LABELS[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Couleurs de la charte Epitech utilisables en aplat de pochette. */
const EPITECH_COVER_COLORS = ['#013afb', '#ff5f3a', '#00ff97', '#ff1ef7', '#7eb9a6'];
/** Couleurs de briques, dans l'ordre où on les trouve dans une boîte. */
const LEGO_COVER_COLORS = ['#e3000b', '#ffcf00', '#006db7', '#00852b', '#ff8c01', '#f2f3f2'];

/**
 * Les quatre tenons d'une brique 2×2, en surimpression : un disque clair
 * pour le dessus, une ombre en dessous pour le relief.
 */
const LEGO_STUDS = [28, 72]
  .flatMap((x) => [26, 70].map((y) => [x, y]))
  .flatMap(([x, y]) => [
    // Le disque passe devant : l'ombre, décalée, ne dépasse que par le bas.
    `radial-gradient(circle at ${x}% ${y}%, #ffffff4d 0 15%, transparent 15.5%)`,
    `radial-gradient(circle at ${x}% ${y + 3}%, #00000038 0 15%, transparent 15.5%)`,
  ])
  .join(', ');

/**
 * Pochette déterministe, tirée du nom du morceau.
 *
 * Le thème par défaut mélange deux teintes voisines ; les deux autres
 * découpent la pochette en diagonale, dans leur palette — surimpression
 * carrée pour Epitech, deux briques accolées pour LEGO.
 */
export function coverStyle(id, theme = 'piano') {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;

  if (theme === 'epitech') {
    const color = EPITECH_COVER_COLORS[hash % EPITECH_COVER_COLORS.length];
    return `linear-gradient(135deg, ${color} 0 50%, #181818 50% 100%)`;
  }

  if (theme === 'lego') {
    const count = LEGO_COVER_COLORS.length;
    const first = hash % count;
    // Le décalage évite qu'une pochette tombe sur deux briques identiques.
    const second = (first + 1 + ((hash >> 8) % (count - 1))) % count;
    // Deux briques accolées, coiffées de quatre tenons.
    return `${LEGO_STUDS}, linear-gradient(135deg, ${LEGO_COVER_COLORS[first]} 0 50%, ${LEGO_COVER_COLORS[second]} 50% 100%)`;
  }

  const hue = hash % 360;
  const hue2 = (hue + 40 + (hash >> 8) % 60) % 360;
  return `linear-gradient(140deg, hsl(${hue} 34% 32%), hsl(${hue2} 30% 16%))`;
}

/* ---------------------------------------------------------------- */

let toastContainer = null;

export function toast(message, kind = 'info', duration = 4200) {
  toastContainer ??= document.getElementById('toasts');
  const element = document.createElement('div');
  element.className = `toast ${kind}`;
  element.textContent = message;
  toastContainer.append(element);
  setTimeout(() => {
    element.style.transition = 'opacity .25s';
    element.style.opacity = '0';
    setTimeout(() => element.remove(), 280);
  }, duration);
}

export function logLine(container, message, level = 'info') {
  const line = document.createElement('div');
  line.className = level;
  const time = new Date().toLocaleTimeString('fr-FR', { hour12: false });
  line.textContent = `${time}  ${message}`;
  container.append(line);
  while (container.childElementCount > 200) container.firstElementChild.remove();
  container.scrollTop = container.scrollHeight;
}
