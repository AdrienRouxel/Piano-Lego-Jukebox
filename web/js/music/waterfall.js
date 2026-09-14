/** Les notes MIDI à venir, sur la même horloge que le son. Aucun mouvement matériel. */
export const LOOK_AHEAD = 4;

const FALLBACK_VELOCITY_PALETTE = [
  { at: 0, color: '#6d5dfc' },
  { at: .48, color: '#e13ea9' },
  { at: .76, color: '#ff623f' },
  { at: 1, color: '#ffe66d' },
];

const clamp01 = (value) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : .7));

function colorChannels(color) {
  const hex = color.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map(char => char + char).join('') : hex;
    return [0, 2, 4].map(index => parseInt(full.slice(index, index + 2), 16));
  }
  const rgb = color.match(/^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)/i);
  return rgb ? rgb.slice(1, 4).map(Number) : null;
}

function mixColor(from, to, amount) {
  const a = colorChannels(from), b = colorChannels(to);
  if (!a || !b) return from;
  const channels = a.map((value, index) => Math.round(value + (b[index] - value) * amount));
  return `#${channels.map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

function colorWithAlpha(color, alpha) {
  const channels = colorChannels(color);
  return channels ? `rgba(${channels.join(', ')}, ${clamp01(alpha)})` : color;
}

/** Une frappe douce reste violette ; une frappe forte monte jusqu'au jaune. */
export function velocityColor(velocity, palette = FALLBACK_VELOCITY_PALETTE) {
  const value = clamp01(velocity);
  const upperIndex = palette.findIndex(stop => stop.at >= value);
  if (upperIndex <= 0) return palette[0].color;
  if (upperIndex < 0) return palette.at(-1).color;
  const lower = palette[upperIndex - 1], upper = palette[upperIndex];
  return mixColor(lower.color, upper.color, (value - lower.at) / (upper.at - lower.at));
}

export function indexNotes(notes) {
  const sorted = notes.filter(n => Number.isFinite(n.time) && Number.isFinite(n.duration)
    && n.duration > 0 && n.midi >= 21 && n.midi <= 108).slice().sort((a, b) => a.time - b.time);
  let end = -Infinity;
  return sorted.map(note => ({ note, end: end = Math.max(end, note.time + note.duration) }));
}

/** Recherche par fin cumulée : garde aussi une note longue commencée avant la fenêtre. */
export function visibleNotes(index, time, ahead = LOOK_AHEAD) {
  let lo = 0, hi = index.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (index[mid].end <= time) lo = mid + 1;
    else hi = mid;
  }
  const result = [];
  for (let i = lo; i < index.length && index[i].note.time <= time + ahead; i++) {
    const note = index[i].note;
    if (note.time + note.duration > time) result.push(note);
  }
  return result;
}

export function noteBounds(note, time, height, ahead = LOOK_AHEAD) {
  const bottom = height * (1 - (note.time - time) / ahead);
  const top = height * (1 - (note.time + note.duration - time) / ahead);
  return { top: Math.max(0, top), bottom: Math.min(height, bottom) };
}

export class NoteWaterfall {
  constructor(canvas, empty, keys) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.empty = empty;
    this.message = empty.querySelector('p');
    this.hint = empty.querySelector('span');
    this.choose = empty.querySelector('button');
    this.keys = [...keys].map(([midi, key]) => ({ midi, element: key,
      x: parseFloat(key.style.left) / 100, width: parseFloat(key.style.width) / 100,
      white: key.classList.contains('white') }));
    for (const key of keys.values()) key.style.setProperty('--note-color', 'var(--note-medium)');
    this.width = this.height = 0;
    this.index = [];
    this.source = null;
    this.enabled = false;
    this.lastTime = -1;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      this.width = width; this.height = height;
      const ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      this.context?.setTransform(ratio, 0, 0, ratio, 0, 0);
      this.lastTime = -1;
    });
    this.observer.observe(canvas.parentElement);
    const theme = () => {
      this.enabled = document.documentElement.dataset.theme === 'moderne';
      if (this.enabled) {
        const css = getComputedStyle(canvas);
        this.colors = Object.fromEntries(['roll-bg', 'roll-line', 'roll-muted', 'note-soft', 'note-medium', 'note-loud', 'note-strong'].map(name => [name, css.getPropertyValue(`--${name}`).trim()]));
        this.palette = [
          { at: 0, color: this.colors['note-soft'] },
          { at: .48, color: this.colors['note-medium'] },
          { at: .76, color: this.colors['note-loud'] },
          { at: 1, color: this.colors['note-strong'] },
        ];
      }
      this.lastTime = -1;
    };
    document.addEventListener('jukebox:themechange', theme);
    this.reduced.addEventListener('change', () => { this.lastTime = -1; });
    theme();
  }

  update(player, improvising = false) {
    if (!this.enabled || !this.context || !this.width || !this.height || document.hidden) return;
    const source = improvising ? null : player?.midi?.notes ?? null;
    if (source !== this.source) {
      this.source = source;
      this.index = indexNotes(source ?? []);
      this.lastTime = -1;
    }
    const state = improvising ? 'live' : !player?.track ? 'empty' : this.index.length ? 'score' : player.track.midiUrl && !player.midi ? 'loading' : 'audio';
    if (state !== this.state) {
      this.state = state;
      this.empty.hidden = state === 'score';
      this.choose.hidden = state !== 'empty';
      this.message.textContent = state === 'live' ? 'À toi de jouer.' : state === 'loading' ? 'Chargement de la partition…' : state === 'audio' ? 'Ce morceau n’a pas de notes MIDI.' : 'La musique prend forme ici.';
      this.hint.textContent = state === 'live' ? 'Tes notes s’allument sur le clavier. Aucune note à anticiper en jeu libre.'
        : state === 'loading' ? 'Les notes apparaîtront dès que le morceau sera prêt.'
        : state === 'audio' ? 'Choisis un morceau avec une partition pour afficher les notes à venir.'
        : 'Choisis un morceau pour voir les notes descendre vers le clavier.';
      this.lastTime = -1;
    }
    // L'accessibilité conserve les notes actuelles, sans déplacement continu.
    const time = player?.currentTime ?? 0;
    const visualTime = this.reduced.matches ? Math.floor(time * 4) / 4 : time;
    if (visualTime === this.lastTime && this.playing === player?.isPlaying) return;
    this.lastTime = visualTime;
    this.playing = player?.isPlaying;
    this.draw(visualTime);
  }

  draw(time) {
    const ctx = this.context, w = this.width, h = this.height, colors = this.colors;
    ctx.clearRect(0, 0, w, h);
    // Des couloirs réels, alignés sur les 52 touches blanches du clavier.
    ctx.strokeStyle = colors['roll-line'];
    ctx.lineWidth = .5;
    for (const key of this.keys.filter(k => k.white)) {
      ctx.globalAlpha = key.midi % 12 === 0 ? .42 : .12;
      ctx.beginPath(); ctx.moveTo(key.x * w, 0); ctx.lineTo(key.x * w, h); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const notes = this.reduced.matches ? visibleNotes(this.index, time, 0) : visibleNotes(this.index, time);
    for (const note of notes) {
      const key = this.keys[note.midi - 21];
      if (!key) continue;
      const { top, bottom } = this.reduced.matches ? { top: h - 9, bottom: h } : noteBounds(note, time, h);
      if (bottom <= top) continue;
      const x = key.x * w + 1, width = Math.max(2, key.width * w - 2);
      const sounding = note.time <= time && this.playing;
      const velocity = clamp01(note.velocity);
      const color = velocityColor(velocity, this.palette);
      if (sounding) key.element.style.setProperty('--note-color', color);
      if (sounding && !this.reduced.matches) {
        const center = x + width / 2;
        const radius = 13 + velocity * 27;
        const impact = ctx.createRadialGradient(center, h - 2, 0, center, h - 2, radius);
        impact.addColorStop(0, colorWithAlpha(color, .56 + velocity * .3));
        impact.addColorStop(.34, colorWithAlpha(color, .24 + velocity * .2));
        impact.addColorStop(1, colorWithAlpha(color, 0));
        ctx.globalAlpha = 1;
        ctx.fillStyle = impact;
        ctx.fillRect(center - radius, h - radius, radius * 2, radius);
      }
      const noteGradient = ctx.createLinearGradient(0, top, 0, bottom);
      noteGradient.addColorStop(0, mixColor(color, '#ffffff', .14));
      noteGradient.addColorStop(.68, color);
      noteGradient.addColorStop(1, mixColor(color, '#ffeeb0', sounding ? .24 : .08));
      ctx.fillStyle = noteGradient;
      ctx.globalAlpha = sounding ? 1 : .72 + velocity * .22;
      ctx.beginPath(); ctx.roundRect(x, top, width, Math.max(2, bottom - top), Math.min(3, width / 2)); ctx.fill();
      if (sounding && !this.reduced.matches) {
        // Le trait d'impact reste bref et lisible, même sans particules.
        ctx.globalAlpha = .28 + velocity * .26;
        ctx.fillStyle = color;
        ctx.fillRect(x - 2, h - 5, width + 4, 5);
      }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = colors['roll-line']; ctx.fillRect(0, h - 1, w, 1);
  }
}
