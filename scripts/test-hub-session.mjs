/**
 * La session Bluetooth du hub, sans hub : un faux appareil GATT suffit.
 *
 *   • une session démarre au premier lien et finit d'elle-même à l'échéance ;
 *   • une coupure en cours de session reconnecte sans jamais abandonner ;
 *   • « Déconnecter » y met fin, y compris pendant une reconnexion ;
 *   • `sessionend` annulé (un morceau joue) repousse la coupure ;
 *   • le lien est entretenu par une demande de charge périodique.
 *
 * Les durées sont réduites à quelques millisecondes ; les minuteurs internes
 * sont du vrai `setTimeout`, d'où quelques attentes explicites.
 */
import assert from 'node:assert/strict';
import { PianoHub, formatMinutes } from '../web/js/lego/hub.js';
import { MessageType, HubProperty, HubPropertyOperation } from '../web/js/lego/protocol.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Un hub factice : accepte la connexion, note ce qu'on lui écrit, et peut
   lâcher le lien sur demande — comme des piles qui rendent l'âme. */
function fakeDevice() {
  const listeners = new Map();
  const device = {
    id: 'fake-hub',
    name: 'Grand Piano',
    written: [],
    connectAttempts: 0,
    /** Les tentatives numérotées jusqu'à ce rang échouent : hub hors de portée. */
    failUntil: 0,
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    drop() {
      device.gatt.connected = false;
      listeners.get('gattserverdisconnected')?.();
    },
  };
  const characteristic = {
    addEventListener() {},
    async startNotifications() {},
    async writeValueWithoutResponse(bytes) { device.written.push(new Uint8Array(bytes)); },
    async writeValue(bytes) { device.written.push(new Uint8Array(bytes)); },
  };
  device.gatt = {
    connected: false,
    async connect() {
      device.connectAttempts += 1;
      if (device.connectAttempts <= device.failUntil) throw new Error('hub hors de portée');
      device.gatt.connected = true;
      return { getPrimaryService: async () => ({ getCharacteristic: async () => characteristic }) };
    },
    disconnect() { if (device.gatt.connected) device.drop(); },
  };
  return device;
}

/** Le hub sans le sélecteur du navigateur : on lui donne l'appareil directement. */
async function attach(hub, device) {
  hub.device = device;
  hub._setStatus('connecting');
  await hub._attach();
}

const events = (hub) => {
  const seen = [];
  for (const type of ['status', 'session']) {
    hub.addEventListener(type, (event) => seen.push({ type, ...event.detail }));
  }
  return seen;
};

/* ------------------------------------------------------------------ */
/* 1. Session : démarre au premier lien, finit à l'échéance             */
/* ------------------------------------------------------------------ */
{
  const hub = new PianoHub();
  hub.sessionDuration = 60;
  const seen = events(hub);
  const device = fakeDevice();
  await attach(hub, device);

  assert.equal(hub.status, 'connected');
  assert.ok(hub.sessionStartedAt, 'la session a commencé');
  assert.ok(hub.sessionRemaining > 0 && hub.sessionRemaining <= 60, 'le compte à rebours est armé');
  assert.ok(seen.some((e) => e.type === 'session' && e.phase === 'start'));

  await sleep(120);
  assert.equal(hub.status, 'disconnected', 'la liaison est coupée à l’échéance');
  assert.equal(hub.sessionStartedAt, null, 'la session est refermée');
  assert.deepEqual(
    seen.filter((e) => e.type === 'session').map((e) => e.phase),
    ['start', 'expired', 'end']
  );
  hub._stopKeepAlive();
}

/* ------------------------------------------------------------------ */
/* 2. Coupure : on reconnecte, sans abandonner, tant que la session court */
/* ------------------------------------------------------------------ */
{
  const hub = new PianoHub();
  hub.sessionDuration = 0; // sans limite
  const device = fakeDevice();
  await attach(hub, device);
  assert.equal(device.connectAttempts, 1);
  // Les quinze prochains `connect()` échouent : bien au-delà des douze essais d'autrefois.
  device.failUntil = device.connectAttempts + 15;

  const started = hub.sessionStartedAt;
  device.drop();
  assert.equal(hub.status, 'reconnecting');
  assert.equal(hub.sessionStartedAt, started, 'la session survit à la coupure');

  // Les délais réels vont de 0,8 à 12 s : on raccourcit le premier essai à la main.
  hub._cancelReconnect();
  let attempts = 0;
  const tryAgain = async () => {
    attempts += 1;
    try {
      await hub._attach();
    } catch {
      if (hub._userDisconnect) return;
      await tryAgain();
    }
  };
  await tryAgain();
  assert.ok(attempts > 12, `a insisté ${attempts} fois, au-delà de l’ancienne limite`);
  assert.equal(hub.status, 'connected');
  assert.equal(hub.sessionStartedAt, started, 'toujours la même session');

  // « Déconnecter » ferme la session et tient tête à la reconnexion.
  await hub.disconnect();
  assert.equal(hub.status, 'disconnected');
  assert.equal(hub.sessionStartedAt, null);
  await sleep(20);
  assert.equal(hub.status, 'disconnected', 'aucune reconnexion après un arrêt volontaire');
}

/* ------------------------------------------------------------------ */
/* 3. Abandonner pendant une reconnexion                               */
/* ------------------------------------------------------------------ */
{
  const hub = new PianoHub();
  hub.sessionDuration = 0;
  const device = fakeDevice();
  await attach(hub, device);
  device.drop();
  assert.equal(hub.status, 'reconnecting');
  await hub.disconnect();
  assert.equal(hub.status, 'disconnected', 'l’état est tranché sans attendre le hub');
  assert.equal(hub._reconnectTimer, null);
}

/* ------------------------------------------------------------------ */
/* 4. `sessionend` annulé : le morceau finit d'abord                    */
/* ------------------------------------------------------------------ */
{
  const hub = new PianoHub();
  hub.sessionDuration = 30;
  let asked = 0;
  hub.addEventListener('sessionend', (event) => {
    asked += 1;
    event.preventDefault();
  });
  const device = fakeDevice();
  await attach(hub, device);
  await sleep(80);
  assert.equal(asked, 1, 'la coupure a été proposée une fois');
  assert.equal(hub.status, 'connected', 'et repoussée : la liaison tient');
  assert.ok(hub._sessionTimer, 'un nouveau rendez-vous est pris');
  await hub.disconnect();
  assert.equal(hub._sessionTimer, null);
}

/* ------------------------------------------------------------------ */
/* 5. Changer la durée en cours de session                             */
/* ------------------------------------------------------------------ */
{
  const hub = new PianoHub();
  hub.sessionDuration = 0;
  const device = fakeDevice();
  await attach(hub, device);
  assert.equal(hub.sessionRemaining, null, 'sans limite : pas de compte à rebours');
  hub.setSessionDuration(60 * 60 * 1000);
  assert.ok(hub.sessionRemaining > 59 * 60 * 1000, 'compté depuis le début de la session');
  hub.setSessionDuration(0);
  assert.equal(hub.sessionRemaining, null);
  assert.equal(hub._sessionTimer, null);
  await hub.disconnect();
}

/* ------------------------------------------------------------------ */
/* 6. Entretien du lien : une demande de charge à intervalle régulier   */
/* ------------------------------------------------------------------ */
{
  const hub = new PianoHub();
  hub.sessionDuration = 0;
  hub.keepAliveInterval = 15; // plutôt que trente secondes
  const device = fakeDevice();
  await attach(hub, device);
  await sleep(10);
  device.written.length = 0; // on oublie les demandes de la connexion
  await sleep(60);
  assert.ok(hub._keepAliveTimer, 'l’entretien est armé une fois connecté');
  const isPing = (m) => m[2] === MessageType.HUB_PROPERTIES && m[3] === HubProperty.BATTERY_VOLTAGE && m[4] === HubPropertyOperation.REQUEST_UPDATE;
  const pings = device.written.filter(isPing);
  assert.ok(pings.length >= 2, `plusieurs demandes de charge sont parties (${pings.length})`);
  assert.ok(device.written.every(isPing), 'et rien d’autre : le lien est entretenu, pas encombré');
  await hub.disconnect();
  assert.equal(hub._keepAliveTimer, null, 'et s’arrête avec la liaison');
}

/* ------------------------------------------------------------------ */
/* 7. Libellés                                                          */
/* ------------------------------------------------------------------ */
assert.equal(formatMinutes(0), '0 min');
assert.equal(formatMinutes(45), '45 min');
assert.equal(formatMinutes(60), '1 h');
assert.equal(formatMinutes(90), '1 h 30');
assert.equal(formatMinutes(125), '2 h 05');

console.log('test-hub-session : ok');
