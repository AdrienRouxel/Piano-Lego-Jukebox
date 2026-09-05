/**
 * Moteur audio du jukebox.
 *
 * Deux modes, choisis automatiquement :
 *   • échantillonneur — les échantillons du piano « Salamander » (licence CC-BY),
 *     transposés au demi-ton près ; c'est le rendu par défaut ;
 *   • synthétiseur de repli — une voix additive maison, si les échantillons ne
 *     sont pas disponibles (pas de réseau, pas de copie locale).
 *
 * Dans les deux cas la sortie passe par une petite réverbération générée à la
 * volée, qui suffit à donner de l'espace sans charger de fichier d'impulsion.
 */

const SAMPLE_ROOT_CDN = 'https://tonejs.github.io/audio/salamander/';
const SAMPLE_ROOT_LOCAL = 'assets/piano/';

/** Les 30 échantillons Salamander : une note toutes les tierces mineures, de La0 à Do8. */
const SAMPLE_MIDIS = Array.from({ length: 30 }, (_, i) => 21 + i * 3);
const PITCH_NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];

function sampleFileName(midi) {
  return `${PITCH_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}.mp3`;
}

export class PianoSampler {
  /** @param {AudioContext} context */
  constructor(context, { useLocalSamples = false } = {}) {
    this.context = context;
    this.root = useLocalSamples ? SAMPLE_ROOT_LOCAL : SAMPLE_ROOT_CDN;
    this.buffers = new Map(); // midi de l'échantillon → AudioBuffer
    this.mode = 'synth';
    this.ready = false;

    this.output = context.createGain();
    this.output.gain.value = 0.9;

    this.dry = context.createGain();
    this.wet = context.createGain();
    this.wet.gain.value = 0.22;
    this.reverb = context.createConvolver();
    this.reverb.buffer = createImpulseResponse(context, 2.1, 2.4);

    this.dry.connect(this.output);
    this.wet.connect(this.reverb);
    this.reverb.connect(this.output);

    /** @type {Map<number, Array<{stop:(when:number)=>void}>>} */
    this.voices = new Map();
    /** Voix dont l'extinction est déjà programmée (lecture d'une partition). */
    this._pending = new Set();

    /** Voix effectivement vivantes dans le graphe audio — la polyphonie réelle. */
    this.activeVoices = 0;
    /** Plus haute polyphonie atteinte depuis le chargement. */
    this.peakVoices = 0;
  }

  connect(destination) {
    this.output.connect(destination);
    return this;
  }

  /**
   * Charge les échantillons. Ne lève jamais : en cas d'échec on bascule
   * silencieusement sur le synthétiseur.
   * @param {(loaded:number, total:number)=>void} [onProgress]
   */
  async load(onProgress) {
    const total = SAMPLE_MIDIS.length;
    let loaded = 0;
    let failures = 0;

    await Promise.all(
      SAMPLE_MIDIS.map(async (midi) => {
        try {
          const response = await fetch(this.root + sampleFileName(midi));
          if (!response.ok) throw new Error(String(response.status));
          const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
          this.buffers.set(midi, buffer);
        } catch {
          failures += 1;
        } finally {
          loaded += 1;
          onProgress?.(loaded, total);
        }
      })
    );

    // Quelques trous sont rattrapables par transposition ; un échec massif ne l'est pas.
    this.mode = failures > total / 2 ? 'synth' : 'sampler';
    this.ready = true;
    return this.mode;
  }

  set volume(value) {
    this.output.gain.setTargetAtTime(Math.max(0, Math.min(1, value)), this.context.currentTime, 0.02);
  }

  /**
   * Déclenche une note.
   * @param {number} midi hauteur MIDI (60 = do central)
   * @param {number} velocity 0 → 1
   * @param {number} when instant absolu dans l'horloge audio
   * @param {number} [duration] si fournie, l'extinction est programmée d'avance —
   *   c'est ce qu'on veut pour jouer une partition connue, sans dépendre d'un
   *   minuteur JavaScript qui peut prendre du retard.
   */
  noteOn(midi, velocity = 0.7, when = this.context.currentTime, duration = null) {
    const voice = this.mode === 'sampler' && this.buffers.size
      ? this._playSample(midi, velocity, when)
      : this._playSynth(midi, velocity, when);
    if (!voice) return null;
    if (duration !== null) {
      voice.stop(when + duration);
      this._pending.add(voice);
      return voice;
    }
    if (!this.voices.has(midi)) this.voices.set(midi, []);
    this.voices.get(midi).push(voice);
    return voice;
  }

  noteOff(midi, when = this.context.currentTime) {
    const stack = this.voices.get(midi);
    if (!stack?.length) return;
    stack.shift().stop(when);
    if (!stack.length) this.voices.delete(midi);
  }

  allNotesOff(when = this.context.currentTime) {
    for (const stack of this.voices.values()) {
      for (const voice of stack) voice.stop(when, true);
    }
    this.voices.clear();
    for (const voice of this._pending) voice.stop(when, true);
    this._pending.clear();
  }

  _voiceStarted() {
    this.activeVoices += 1;
    this.peakVoices = Math.max(this.peakVoices, this.activeVoices);
  }

  _voiceEnded() {
    this.activeVoices = Math.max(0, this.activeVoices - 1);
  }

  _nearestSample(midi) {
    let best = null;
    let bestDistance = Infinity;
    for (const candidate of this.buffers.keys()) {
      const distance = Math.abs(candidate - midi);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    return best;
  }

  _playSample(midi, velocity, when) {
    const sampleMidi = this._nearestSample(midi);
    if (sampleMidi === null) return this._playSynth(midi, velocity, when);

    const source = this.context.createBufferSource();
    source.buffer = this.buffers.get(sampleMidi);
    source.playbackRate.value = 2 ** ((midi - sampleMidi) / 12);

    const gain = this.context.createGain();
    // Les échantillons sont enregistrés fort : on suit une loi de puissance
    // proche de la réponse d'un vrai piano plutôt qu'une simple proportion.
    const level = 0.95 * velocity ** 1.6 + 0.05;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(level, when + 0.004);

    source.connect(gain);
    gain.connect(this.dry);
    gain.connect(this.wet);
    source.start(when);
    this._voiceStarted();

    let stopped = false;
    const stop = (at, immediate = false) => {
      if (stopped) return;
      stopped = true;
      const time = Math.max(at, this.context.currentTime);
      // Les étouffoirs d'un piano ne coupent pas net : on laisse une décroissance.
      const release = immediate ? 0.08 : 0.4;
      gain.gain.cancelScheduledValues(time);
      gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), time);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + release);
      source.stop(time + release + 0.02);
    };
    source.onended = () => {
      this._voiceEnded();
      gain.disconnect();
      source.disconnect();
    };
    return { stop };
  }

  _playSynth(midi, velocity, when) {
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    const gain = this.context.createGain();
    const level = 0.42 * velocity ** 1.5 + 0.02;

    // Trois partiels légèrement désaccordés : c'est ce qui donne l'épaisseur.
    const partials = [
      { ratio: 1, gain: 1, type: 'triangle' },
      { ratio: 2.001, gain: 0.38, type: 'sine' },
      { ratio: 3.004, gain: 0.14, type: 'sine' },
    ];
    const oscillators = partials.map((partial) => {
      const osc = this.context.createOscillator();
      osc.type = partial.type;
      osc.frequency.value = frequency * partial.ratio;
      const partialGain = this.context.createGain();
      partialGain.gain.value = partial.gain;
      osc.connect(partialGain);
      partialGain.connect(gain);
      osc.start(when);
      return osc;
    });

    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(level, when + 0.006);
    // Décroissance naturelle : les aigus s'éteignent plus vite que les graves.
    const decay = 1.6 + Math.max(0, (60 - midi) / 24);
    gain.gain.exponentialRampToValueAtTime(level * 0.25, when + decay * 0.35);
    gain.connect(this.dry);
    gain.connect(this.wet);
    this._voiceStarted();

    let stopped = false;
    const stop = (at, immediate = false) => {
      if (stopped) return;
      stopped = true;
      const time = Math.max(at, this.context.currentTime);
      const release = immediate ? 0.05 : 0.35;
      gain.gain.cancelScheduledValues(time);
      gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), time);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + release);
      for (const osc of oscillators) osc.stop(time + release + 0.02);
    };
    oscillators[0].onended = () => {
      this._voiceEnded();
      gain.disconnect();
    };
    return { stop };
  }
}

/** Réverbération générée : bruit blanc décroissant, stéréo, sans fichier externe. */
function createImpulseResponse(context, seconds, decay) {
  const length = Math.floor(context.sampleRate * seconds);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const t = i / length;
      data[i] = (Math.random() * 2 - 1) * (1 - t) ** decay;
    }
  }
  return impulse;
}
