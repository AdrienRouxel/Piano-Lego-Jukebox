/**
 * Le stand vu par HTTP : un seul jukebox publie « ce qui joue », et le dépôt
 * d'une partition lève le drapeau `transcribe` des demandes qui l'attendaient.
 *
 * Le serveur est lancé tel quel, sur un port libre, avec le code de stand déjà
 * enregistré sur cette machine pour ne pas le réécrire. Aucun matériel.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SESSION_FILE = path.join(ROOT, '.stand-session.json');
const REQUESTS_DIR = path.join(ROOT, 'tracks', 'Demandes');
const TEST_NAME = '__test-stand__ - Drapeau';
/** Le plus petit fichier MIDI valide : un en-tête et une piste vide. */
const MIDI = Buffer.from([
  0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 0x60,
  0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 4, 0, 0xff, 0x2f, 0,
]);

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/* Le code du stand : celui du fichier local s'il existe, sinon un code d'essai
   dont on efface la trace en sortant. */
let code = null;
let sessionCreated = false;
try {
  code = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')).code ?? null;
} catch { /* pas encore de session */ }
if (!code) {
  code = 'TESTS';
  sessionCreated = true;
}

const port = await freePort();
const server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
  env: { ...process.env, PORT: String(port), STAND_CODE: code, HOST: '' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const base = `http://127.0.0.1:${port}`;

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('le serveur ne démarre pas')), 15000);
  server.stdout.on('data', (chunk) => {
    if (String(chunk).includes('Jukebox LEGO Grand Piano')) {
      clearTimeout(timer);
      resolve();
    }
  });
  server.once('exit', (status) => reject(new Error(`serveur terminé (${status})`)));
});

const json = async (route, body, method = 'POST') => {
  const response = await fetch(base + route, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
};
const state = async () => (await json('/api/stand', undefined, 'GET')).data;
const publish = (source, now) => json('/api/stand/now', { source, now });
const playing = (id) => ({ id, title: id, state: 'playing', position: 1, duration: 30 });
const paused = (id) => ({ id, title: id, state: 'paused', position: 1, duration: 30 });

try {
  /* --- Un seul jukebox dirige ------------------------------------------ */

  let { data } = await publish('A', playing('Piano/Un'));
  assert.equal(data.conductor, true, 'le premier venu dirige');
  assert.equal((await state()).now.id, 'Piano/Un');

  ({ data } = await publish('B', paused('Piano/Deux')));
  assert.equal(data.conductor, false, 'un second poste à l’arrêt ne prend pas la main');
  assert.equal((await state()).now.id, 'Piano/Un', 'les téléphones voient toujours A');

  ({ data } = await publish('B', playing('Piano/Deux')));
  assert.equal(data.conductor, false, 'ni un second poste qui joue pendant que le premier joue');
  assert.equal((await state()).now.id, 'Piano/Un');

  ({ data } = await publish('A', paused('Piano/Un')));
  assert.equal(data.conductor, true, 'A garde la main en pause');
  ({ data } = await publish('B', playing('Piano/Deux')));
  assert.equal(data.conductor, true, 'ce qui sonne l’emporte sur ce qui est à l’arrêt');
  assert.equal((await state()).now.id, 'Piano/Deux');
  ({ data } = await publish('A', paused('Piano/Un')));
  assert.equal(data.conductor, false, 'A, à l’arrêt, est désormais ignoré');
  assert.equal((await state()).now.id, 'Piano/Deux');

  ({ data } = await publish('B', null));
  assert.equal(data.conductor, true, 'B se retire');
  assert.equal((await state()).now, null);
  ({ data } = await publish('A', paused('Piano/Un')));
  assert.equal(data.conductor, true, 'la place est libre : A reprend');
  assert.equal((await state()).now.id, 'Piano/Un');

  // Une page d'une version antérieure, sans identifiant : elle dirige seule.
  ({ data } = await publish(undefined, null));
  assert.equal(data.conductor, false);
  ({ data } = await publish('A', null));
  assert.equal(data.conductor, true);
  ({ data } = await publish(undefined, playing('Piano/Trois')));
  assert.equal(data.conductor, true);
  ({ data } = await publish(undefined, null));

  console.log('✓ Stand : un seul jukebox publie ce qui joue');

  /* --- La partition déposée lève le drapeau transcribe ----------------- */

  await fsp.mkdir(REQUESTS_DIR, { recursive: true });
  await fsp.writeFile(path.join(REQUESTS_DIR, `${TEST_NAME}.mp3`), Buffer.from('extrait factice'));
  const id = `Demandes/${TEST_NAME}`;

  ({ data } = await json('/api/stand/queue', { id, code, by: 'test' }));
  assert.equal(data.entry?.id, id);
  assert.equal(data.entry.transcribe, true, 'un extrait sans partition doit être transcrit');

  const upload = await fetch(
    `${base}/api/tracks?category=Demandes&name=${encodeURIComponent(TEST_NAME)}&overwrite=1`,
    { method: 'POST', headers: { 'content-type': 'audio/midi' }, body: MIDI }
  );
  assert.equal(upload.status, 201);
  const queued = (await state()).queue.find((entry) => entry.id === id);
  assert.equal(queued?.transcribe, false, 'la partition existe : plus rien à attendre');

  const removal = await json(`/api/tracks?category=Demandes&name=${encodeURIComponent(TEST_NAME)}`, undefined, 'DELETE');
  assert.equal(removal.status, 200);
  assert.equal(removal.data.dequeued, 1);
  assert.equal((await state()).queue.some((entry) => entry.id === id), false);

  console.log('✓ Stand : le dépôt de la partition lève le drapeau de transcription');

  /* --- La file revient au jukebox qui dirige --------------------------- */

  const { tracks } = (await json('/api/library', undefined, 'GET')).data;
  assert.ok(tracks.length, 'la bibliothèque de test est vide');
  const wanted = tracks[0].id;

  ({ data } = await publish('A', playing('Piano/Un')));
  assert.equal(data.conductor, true);
  ({ data } = await json('/api/stand/queue', { id: wanted, code, by: 'test' }));
  assert.equal(data.entry?.id, wanted);

  let next = await json('/api/stand/queue/next', { source: 'B' });
  assert.equal(next.status, 409, 'un poste qui ne dirige pas ne prend rien');
  assert.equal(next.data.conductor, false);
  assert.equal(next.data.queue.length, 1, 'la demande reste en file');

  next = await json('/api/stand/queue/next', { source: 'A' });
  assert.equal(next.status, 200);
  assert.equal(next.data.entry?.id, wanted, 'le poste qui dirige la reçoit');
  assert.equal((await state()).queue.length, 0);

  ({ data } = await publish('A', null)); // A se retire : la place est libre
  ({ data } = await json('/api/stand/queue', { id: wanted, code, by: 'test' }));
  assert.equal(data.entry?.id, wanted);
  next = await json('/api/stand/queue/next', { source: 'B' });
  assert.equal(next.status, 200, 'personne ne dirige : le premier venu sert');
  assert.equal(next.data.entry?.id, wanted);

  console.log('✓ Stand : la file revient au jukebox que suivent les téléphones');
} finally {
  server.kill();
  for (const ext of ['.mp3', '.mid']) await fsp.rm(path.join(REQUESTS_DIR, TEST_NAME + ext), { force: true });
  if (sessionCreated) await fsp.rm(SESSION_FILE, { force: true });
}
