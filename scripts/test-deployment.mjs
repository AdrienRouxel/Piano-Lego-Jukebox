#!/usr/bin/env node
// Vérification explicite d'une URL déployée ; aucun pilotage matériel.
import assert from 'node:assert/strict';

const base = new URL(process.argv[2]);
assert.equal(base.protocol, 'https:');
async function get(route, options = {}) {
  return fetch(new URL(route, base), { signal: AbortSignal.timeout(30000), ...options });
}

for (const route of ['/', '/r', '/print', '/geek.html', '/js/main.js', '/moderne.css', '/api/docs']) {
  const res = await get(route);
  assert.equal(res.status, 200, route);
  assert.ok((await res.arrayBuffer()).byteLength > 0, route);
  console.log(`OK ${route}`);
}
const library = await (await get('/api/library')).json();
assert.ok(library.tracks.length > 0);
for (const track of library.tracks) {
  const route = track.midiUrl || track.audioUrl;
  const res = await get(route);
  assert.equal(res.status, 200, route);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.ok(bytes.length > 0);
  if (track.midiUrl) assert.equal(bytes.subarray(0, 4).toString(), 'MThd', route);
}
console.log(`OK ${library.tracks.length} morceaux`);
const stand = await (await get('/api/stand')).json();
assert.equal('operator' in stand, false);
assert.equal(new URL(stand.remoteUrl).origin, base.origin);
assert.equal(new URL(stand.remoteUrl).protocol, 'https:');
const control = await get('/api/stand/queue/drop', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ key: '__deployment_probe__' }),
});
assert.equal(control.status, 200);
const visitor = await get('/api/stand/cheer', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
});
assert.equal(visitor.status, 403);
console.log('OK pilotage admin direct, accès visiteur protégé et QR HTTPS');

const engineResponse = await get('/api/transcribe');
assert.equal(engineResponse.status, 200);
const engine = await engineResponse.json();
assert.equal(engine.available, true);
assert.equal(engine.backend, 'onnx');
console.log(`OK moteur de transcription ${engine.backend} (${engine.system} ${engine.machine})`);

/** Petit la 440 Hz : assez long pour vérifier une vraie inférence, pas seulement l'installation. */
function sineWav(seconds = 2, rate = 22050, frequency = 440) {
  const count = Math.round(seconds * rate);
  const wav = Buffer.alloc(44 + count * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + count * 2, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i += 1) {
    const edge = Math.min(1, i / 1000, (count - i - 1) / 1000);
    wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * frequency * i) / rate) * edge * 24000), 44 + i * 2);
  }
  return wav;
}

const inferenceResponse = await get('/api/transcribe', {
  method: 'POST',
  headers: { 'content-type': 'audio/wav' },
  body: sineWav(),
});
assert.equal(inferenceResponse.status, 200);
const inference = await inferenceResponse.json();
assert.equal(inference.backend, 'onnx');
assert.ok(inference.notes.some((note) => Math.abs(note.midi - 69) <= 1));
console.log(`OK inférence réelle (${inference.notes.length} note${inference.notes.length > 1 ? 's' : ''})`);

// Deux télécommandes doivent recevoir leur état pendant que l'API reste disponible.
const controllers = [new AbortController(), new AbortController()];
try {
  await Promise.all(controllers.map(async (controller) => {
    const res = await get('/api/stand/events', {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const reader = res.body.getReader();
    let text = '';
    while (!text.includes('event: state')) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      text += new TextDecoder().decode(chunk.value);
    }
  }));
  assert.equal((await get('/api/library')).status, 200);
  console.log('OK deux flux simultanés et API disponible');
} finally {
  controllers.forEach((controller) => controller.abort());
}
