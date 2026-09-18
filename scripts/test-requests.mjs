import assert from 'node:assert/strict';
import { RequestPipeline } from '../web/js/requests.js';
import { readLink } from './music-links.mjs';

// Node 18 fournit EventTarget mais pas toujours CustomEvent, contrairement au
// navigateur où tourne le jukebox.
if (typeof globalThis.CustomEvent !== 'function') {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, options = {}) {
      super(type);
      this.detail = options.detail;
    }
  };
}

function pipelineFor(queue, tracks) {
  return new RequestPipeline({
    stand: { queue },
    getLibrary: () => tracks,
    reloadLibrary: async () => {},
  });
}

const readyEntry = { key: 'q1', id: 'Demandes/Prête', title: 'Prête', transcribe: true };
const ready = pipelineFor(
  [readyEntry],
  [{ id: readyEntry.id, midiUrl: '/tracks/Prête.mid', audioUrl: '/tracks/Prête.m4a' }]
);
const [firstWaiter, secondWaiter] = await Promise.all([
  ready.waitFor(readyEntry.key),
  ready.waitFor(readyEntry.key),
]);
assert.deepEqual(firstWaiter, { ok: true, status: 'ready' });
assert.deepEqual(secondWaiter, firstWaiter);
assert.deepEqual(await ready.waitFor(readyEntry.key), firstWaiter, 'le résultat reste disponible pour le lecteur');

const unavailableEntry = { key: 'q2', id: 'Demandes/Sans moteur', title: 'Sans moteur', transcribe: true };
const unavailable = pipelineFor(
  [unavailableEntry],
  [{ id: unavailableEntry.id, midiUrl: null, audioUrl: '/tracks/Sans moteur.m4a' }]
);
unavailable.available = async () => false;
assert.deepEqual(await unavailable.waitFor(unavailableEntry.key), {
  ok: false,
  status: 'unavailable',
  message: 'Aucun moteur de transcription n’est disponible.',
});

const queue = [
  { key: 'q3', id: 'Demandes/Une', title: 'Une', transcribe: true },
  { key: 'q4', id: 'Demandes/Deux', title: 'Deux', transcribe: true },
];
const sequential = pipelineFor(queue, queue.map((entry) => ({
  id: entry.id,
  midiUrl: `/${entry.title}.mid`,
  audioUrl: `/${entry.title}.m4a`,
})));
assert.deepEqual(await sequential.waitFor(queue[1].key), { ok: true, status: 'ready' });

// Un autre onglet a transcrit pendant que celui-ci échouait : la partition
// existe désormais, et l'échec mémorisé ne doit pas la faire retirer de la file.
const racedEntry = { key: 'q5', id: 'Demandes/Concurrente', title: 'Concurrente', transcribe: true };
let racedTracks = [{ id: racedEntry.id, midiUrl: null, audioUrl: '/tracks/Concurrente.m4a' }];
const raced = new RequestPipeline({
  stand: { queue: [racedEntry] },
  getLibrary: () => racedTracks,
  reloadLibrary: async () => {
    racedTracks = [{ id: racedEntry.id, midiUrl: '/tracks/Concurrente.mid', audioUrl: '/tracks/Concurrente.m4a' }];
  },
});
raced.available = async () => true;
raced._process = async () => { throw new Error('moteur rapide : HTTP 429'); };
assert.deepEqual(await raced.waitFor(racedEntry.key), { ok: true, status: 'ready' });

const lostEntry = { key: 'q6', id: 'Demandes/Perdue', title: 'Perdue', transcribe: true };
const lost = pipelineFor([lostEntry], [{ id: lostEntry.id, midiUrl: null, audioUrl: '/tracks/Perdue.m4a' }]);
lost.available = async () => true;
lost._process = async () => { throw new Error('Aucune note reconnue dans cet extrait.'); };
assert.deepEqual(await lost.waitFor(lostEntry.key), {
  ok: false,
  status: 'failed',
  message: 'Aucune note reconnue dans cet extrait.',
});
assert.equal((await lost.waitFor(lostEntry.key)).ok, false, 'sans partition sur le disque, l’échec reste un échec');

assert.deepEqual(readLink('https://music.apple.com/fr/song/sur-la-piste/6771954763')?.id, '6771954763');
assert.deepEqual(readLink('https://music.apple.com/us/song/6771954763')?.id, '6771954763');
assert.deepEqual(
  readLink('https://music.apple.com/fr/album/summergirl/6768972162?i=6771954763')?.id,
  '6771954763'
);

assert.deepEqual(readLink('https://www.deezer.com/fr/track/72203431')?.id, '72203431');
assert.deepEqual(
  readLink('https://link.deezer.com/s/34qPoOTX7y5ecnFLlc6vn'),
  { provider: 'deezer', id: null, url: 'https://link.deezer.com/s/34qPoOTX7y5ecnFLlc6vn' },
  'un lien de partage Deezer est reconnu, son identifiant viendra des redirections'
);

console.log('✓ Demandes : attente du MIDI, erreur explicite, file séquentielle, partition venue d’ailleurs, liens Apple Music et Deezer');
