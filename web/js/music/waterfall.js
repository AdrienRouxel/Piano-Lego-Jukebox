/** Les notes MIDI à venir, sur la même horloge que le son. Aucun mouvement matériel. */
export const LOOK_AHEAD = 4;

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
    this.keys = [...keys].map(([midi, key]) => ({ midi,
      x: parseFloat(key.style.left) / 100, width: parseFloat(key.style.width) / 100,
      white: key.classList.contains('white') }));
    for (const [midi, key] of keys) key.style.setProperty('--note-color', `var(--note-${midi < 60 ? 'low' : 'high'})`);
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
        this.colors = Object.fromEntries(['roll-bg', 'roll-line', 'roll-muted', 'note-low', 'note-high'].map(name => [name, css.getPropertyValue(`--${name}`).trim()]));
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
      ctx.fillStyle = colors[note.midi < 60 ? 'note-low' : 'note-high'];
      ctx.globalAlpha = sounding ? 1 : .82;
      ctx.beginPath(); ctx.roundRect(x, top, width, Math.max(2, bottom - top), Math.min(3, width / 2)); ctx.fill();
      if (sounding && !this.reduced.matches) {
        // Impact discret à l'arrivée, sans particules ni boucle décorative.
        ctx.globalAlpha = .22;
        ctx.fillRect(x - 2, h - 5, width + 4, 5);
      }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = colors['roll-line']; ctx.fillRect(0, h - 1, w, 1);
  }
}
