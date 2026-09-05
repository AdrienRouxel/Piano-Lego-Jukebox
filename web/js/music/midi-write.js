/**
 * Écriture de fichiers MIDI standard (format 0).
 *
 * Ce module est volontairement sans dépendance ni API de navigateur : il sert
 * aussi bien au générateur de partitions côté Node (`scripts/midi-writer.mjs`)
 * qu'au convertisseur MP3 → MIDI côté navigateur.
 */

export const TPB = 480; // impulsions par noire

/* ------------------------------------------------------------------ */
/* Encodage MIDI                                                       */
/* ------------------------------------------------------------------ */

function varint(value) {
  const bytes = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return bytes;
}

function chunk(id, data) {
  const header = [...id].map((c) => c.charCodeAt(0));
  const length = data.length;
  return [...header, (length >> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff, ...data];
}

/** Écart minimal entre l'extinction d'une note et sa reprise, en impulsions. */
const REARTICULATION = 8;

/**
 * Rend une voix jouable : une hauteur donnée ne peut sonner qu'une fois à la fois.
 *
 * Deux accidents d'écriture arrivent vite quand mélodie et accompagnement se
 * croisent : la même note écrite deux fois au même instant — elle sonne alors
 * deux fois plus fort, et sature —, et une note tenue par-dessus sa propre
 * reprise — beaucoup de lecteurs éteignent alors les deux au premier « note off »,
 * ou laissent la première coincée. On garde la plus longue des doublées, et on
 * raccourcit ce qui déborde.
 */
function singleVoicePerPitch(notes) {
  const byPitch = new Map();
  for (const note of notes) {
    if (!byPitch.has(note.midi)) byPitch.set(note.midi, []);
    byPitch.get(note.midi).push({ ...note }); // copie : la partition d'origine n'est pas retouchée
  }

  const cleaned = [];
  for (const list of byPitch.values()) {
    list.sort((a, b) => a.tick - b.tick || b.duration - a.duration);
    let previous = null;
    for (const note of list) {
      if (previous && note.tick === previous.tick) {
        // Doublon : une seule note, la plus marquée des deux.
        previous.duration = Math.max(previous.duration, note.duration);
        previous.velocity = Math.max(previous.velocity, note.velocity);
        continue;
      }
      if (previous) {
        const room = note.tick - previous.tick - REARTICULATION;
        previous.duration = Math.max(1, Math.min(previous.duration, room));
      }
      cleaned.push(note);
      previous = note;
    }
  }
  return cleaned;
}

/**
 * @param {{name:string, bpm:number, timeSignature?:number[], notes:Array<{tick:number,duration:number,midi:number,velocity:number}>}} score
 */
export function buildMidi(score) {
  const events = [];
  for (const note of singleVoicePerPitch(score.notes)) {
    const velocity = Math.max(1, Math.min(127, Math.round(note.velocity * 127)));
    events.push({ tick: note.tick, order: 1, data: [0x90, note.midi, velocity] });
    events.push({ tick: note.tick + note.duration, order: 0, data: [0x80, note.midi, 0x40] });
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const track = [];
  // Nom de piste
  const nameBytes = [...score.name].map((c) => c.charCodeAt(0) & 0x7f);
  track.push(0x00, 0xff, 0x03, ...varint(nameBytes.length), ...nameBytes);
  // Tempo
  const microsPerBeat = Math.round(60_000_000 / score.bpm);
  track.push(0x00, 0xff, 0x51, 0x03, (microsPerBeat >> 16) & 0xff, (microsPerBeat >> 8) & 0xff, microsPerBeat & 0xff);
  // Signature rythmique
  const [num, den] = score.timeSignature ?? [4, 4];
  track.push(0x00, 0xff, 0x58, 0x04, num, Math.log2(den), 24, 8);

  let last = 0;
  for (const event of events) {
    track.push(...varint(event.tick - last), ...event.data);
    last = event.tick;
  }
  track.push(0x00, 0xff, 0x2f, 0x00); // fin de piste

  const header = chunk('MThd', [0x00, 0x00, 0x00, 0x01, (TPB >> 8) & 0xff, TPB & 0xff]);
  return Uint8Array.from([...header, ...chunk('MTrk', track)]);
}
