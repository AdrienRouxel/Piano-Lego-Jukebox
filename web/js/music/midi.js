/**
 * Lecteur de fichiers MIDI standard (SMF, formats 0 et 1).
 *
 * Écrit à la main pour garder le projet sans dépendance ni étape de build.
 * On extrait ce dont le jukebox a besoin : les notes (hauteur, instant, durée,
 * vélocité), la carte des tempos, la signature rythmique, et une grille de temps
 * qui servira à accentuer la chorégraphie du piano.
 */

const HEADER = 0x4d546864; // « MThd »
const TRACK = 0x4d54726b; // « MTrk »

class Reader {
  constructor(bytes) {
    this.bytes = bytes;
    this.offset = 0;
  }
  get remaining() {
    return this.bytes.length - this.offset;
  }
  u8() {
    return this.bytes[this.offset++];
  }
  u16() {
    return (this.u8() << 8) | this.u8();
  }
  u32() {
    return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0;
  }
  bytesOf(length) {
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }
  /** Quantité à longueur variable : 7 bits utiles par octet, bit de poids fort = continuation. */
  varint() {
    let value = 0;
    for (let i = 0; i < 4; i += 1) {
      const byte = this.u8();
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) break;
    }
    return value;
  }
  ascii(length) {
    return new TextDecoder('latin1').decode(this.bytesOf(length)).replace(/\0+$/, '').trim();
  }
}

/**
 * @param {ArrayBuffer} arrayBuffer
 * @returns {object} partition normalisée
 */
export function parseMidi(arrayBuffer) {
  const reader = new Reader(new Uint8Array(arrayBuffer));

  if (reader.u32() !== HEADER) throw new Error('Ce fichier n’est pas un MIDI valide (en-tête MThd manquant).');
  const headerLength = reader.u32();
  const format = reader.u16();
  const trackCount = reader.u16();
  const division = reader.u16();
  reader.offset += headerLength - 6; // en-têtes étendus, ignorés

  // Division négative = base SMPTE (images/seconde), sinon impulsions par noire.
  const smpte = (division & 0x8000) !== 0;
  const ticksPerBeat = smpte ? 0 : division;
  const ticksPerSecond = smpte ? (256 - (division >> 8)) * (division & 0xff) : 0;

  const rawTracks = [];
  const tempoEvents = [];
  const timeSignatures = [];
  let title = null;

  for (let t = 0; t < trackCount && reader.remaining > 8; t += 1) {
    if (reader.u32() !== TRACK) break;
    const length = reader.u32();
    const end = reader.offset + length;
    const track = { name: null, instrument: null, events: [] };

    let tick = 0;
    let runningStatus = 0;
    /** @type {Map<number, Array<{tick:number, velocity:number}>>} clé = canal*128 + note */
    const pending = new Map();

    while (reader.offset < end) {
      tick += reader.varint();
      let status = reader.u8();
      if ((status & 0x80) === 0) {
        // Statut courant (running status) : l'octet lu était déjà une donnée.
        reader.offset -= 1;
        status = runningStatus;
      } else if (status < 0xf0) {
        runningStatus = status;
      }

      if (status === 0xff) {
        const type = reader.u8();
        const metaLength = reader.varint();
        const data = reader.bytesOf(metaLength);
        if (type === 0x03) track.name = new TextDecoder('latin1').decode(data).trim();
        else if (type === 0x04) track.instrument = new TextDecoder('latin1').decode(data).trim();
        else if (type === 0x51 && metaLength === 3) {
          const microsPerBeat = (data[0] << 16) | (data[1] << 8) | data[2];
          tempoEvents.push({ tick, microsPerBeat });
        } else if (type === 0x58 && metaLength >= 2) {
          timeSignatures.push({ tick, numerator: data[0], denominator: 2 ** data[1] });
        } else if (type === 0x01 && !title && metaLength) {
          title = new TextDecoder('latin1').decode(data).trim() || null;
        }
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        reader.bytesOf(reader.varint());
        continue;
      }

      const command = status & 0xf0;
      const channel = status & 0x0f;

      if (command === 0x90 || command === 0x80) {
        const note = reader.u8();
        const velocity = reader.u8();
        const key = channel * 128 + note;
        // Un « note on » de vélocité nulle vaut « note off ».
        if (command === 0x90 && velocity > 0) {
          if (!pending.has(key)) pending.set(key, []);
          pending.get(key).push({ tick, velocity });
        } else {
          const stack = pending.get(key);
          const start = stack && stack.shift();
          if (start) {
            track.events.push({
              tick: start.tick,
              endTick: tick,
              note,
              channel,
              velocity: start.velocity / 127,
            });
          }
        }
      } else if (command === 0xc0 || command === 0xd0) {
        reader.u8();
      } else if (command >= 0xa0 && command <= 0xe0) {
        reader.u8();
        reader.u8();
      }
    }

    // Notes restées ouvertes : on les ferme à la fin de la piste.
    for (const [key, stack] of pending) {
      for (const start of stack) {
        track.events.push({
          tick: start.tick,
          endTick: tick,
          note: key % 128,
          channel: Math.floor(key / 128),
          velocity: start.velocity / 127,
        });
      }
    }

    reader.offset = end;
    if (track.events.length || track.name) rawTracks.push(track);
  }

  /* --- Conversion ticks → secondes ------------------------------- */

  tempoEvents.sort((a, b) => a.tick - b.tick);
  const tempoMap = buildTempoMap(tempoEvents, ticksPerBeat, ticksPerSecond, smpte);
  const toSeconds = (tick) => tickToSeconds(tick, tempoMap);

  const tracks = rawTracks.map((track) => {
    const notes = track.events
      .map((event) => {
        const time = toSeconds(event.tick);
        return {
          time,
          duration: Math.max(0.03, toSeconds(event.endTick) - time),
          midi: event.note,
          velocity: event.velocity,
          channel: event.channel,
          isDrum: event.channel === 9,
        };
      })
      .sort((a, b) => a.time - b.time);
    return { name: track.name, instrument: track.instrument, notes };
  });

  const notes = tracks.flatMap((track) => track.notes).sort((a, b) => a.time - b.time);
  const duration = notes.reduce((max, note) => Math.max(max, note.time + note.duration), 0);

  const tempos = tempoMap.map((entry) => ({ time: entry.time, bpm: 60_000_000 / entry.microsPerBeat }));
  const signature = timeSignatures.length
    ? { numerator: timeSignatures[0].numerator, denominator: timeSignatures[0].denominator }
    : { numerator: 4, denominator: 4 };

  return {
    format,
    ticksPerBeat,
    duration,
    title,
    tracks,
    notes,
    tempos,
    timeSignature: signature,
    beats: buildBeatGrid(tempoMap, duration, signature, ticksPerBeat, smpte),
    averageBpm: tempos.length ? tempos.reduce((sum, t) => sum + t.bpm, 0) / tempos.length : 120,
  };
}

/** Table [tick de départ, instant en secondes, µs par noire] pour interpoler linéairement. */
function buildTempoMap(tempoEvents, ticksPerBeat, ticksPerSecond, smpte) {
  if (smpte) {
    // En SMPTE le temps ne dépend pas du tempo : une impulsion vaut une durée fixe.
    return [{ tick: 0, time: 0, microsPerBeat: 1_000_000 / ticksPerSecond, ticksPerBeat: 1, smpte: true, ticksPerSecond }];
  }
  const events = tempoEvents.length && tempoEvents[0].tick === 0 ? tempoEvents : [{ tick: 0, microsPerBeat: 500_000 }, ...tempoEvents];
  const map = [];
  let time = 0;
  for (let i = 0; i < events.length; i += 1) {
    if (i > 0) {
      const previous = events[i - 1];
      time += ((events[i].tick - previous.tick) * previous.microsPerBeat) / (ticksPerBeat * 1_000_000);
    }
    map.push({ tick: events[i].tick, time, microsPerBeat: events[i].microsPerBeat, ticksPerBeat });
  }
  return map;
}

function tickToSeconds(tick, tempoMap) {
  const first = tempoMap[0];
  if (first.smpte) return tick / first.ticksPerSecond;
  let entry = first;
  for (const candidate of tempoMap) {
    if (candidate.tick <= tick) entry = candidate;
    else break;
  }
  return entry.time + ((tick - entry.tick) * entry.microsPerBeat) / (entry.ticksPerBeat * 1_000_000);
}

/** Grille de temps (et de mesures) pour accentuer la chorégraphie. */
function buildBeatGrid(tempoMap, duration, signature, ticksPerBeat, smpte) {
  const beats = [];
  if (smpte || !ticksPerBeat || duration <= 0) return beats;

  let time = 0;
  let index = 0;
  let cursor = 0; // avance dans la table des tempos, sans jamais la reparcourir
  const guard = 100_000;
  while (time <= duration + 1 && beats.length < guard) {
    beats.push({ time, downbeat: index % signature.numerator === 0 });
    while (cursor < tempoMap.length - 1 && tempoMap[cursor + 1].time <= time) cursor += 1;
    time += tempoMap[cursor].microsPerBeat / 1_000_000;
    index += 1;
  }
  return beats;
}
