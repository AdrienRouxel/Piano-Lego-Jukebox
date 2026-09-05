#!/usr/bin/env node
/**
 * Vérifie la couche protocole contre la spécification LEGO Wireless Protocol 3.0
 * (https://lego.github.io/lego-ble-wireless-protocol-docs/).
 *
 * Les trames attendues sont écrites à la main d'après la spécification, pas
 * générées par le code testé : c'est tout l'intérêt. Aucun matériel requis.
 *
 *   npm test
 */

import * as P from '../web/js/lego/protocol.js';

let ok = 0, ko = 0;
const hex = (b) => P.toHex(b).toUpperCase();
const check = (label, actual, expected) => {
  const got = typeof actual === 'string' || typeof actual === 'number' ? String(actual) : hex(actual);
  if (got === expected) { ok++; console.log(`  ✔ ${label.padEnd(46)} ${got}`); }
  else { ko++; console.log(`  ✘ ${label.padEnd(46)} attendu ${expected}\n${' '.repeat(51)}obtenu  ${got}`); }
};

console.log('\nENCODAGE');
check('moteur port A, +50 %', P.encodeMotorPower(0, 50), '08 00 81 00 10 51 00 32');
check('moteur port A, -50 %', P.encodeMotorPower(0, -50), '08 00 81 00 10 51 00 CE');
check('moteur port B, +100 % avec accusé', P.encodeMotorPower(1, 100, true), '08 00 81 01 11 51 00 64');
check('moteur : bornage à +100', P.encodeMotorPower(0, 250), '08 00 81 00 10 51 00 64');
check('frein actif port B', P.encodeMotorBrake(1), '08 00 81 01 11 51 00 7F');
check('vitesse régulée port A, 60 %', P.encodeMotorSpeed(0, 60), '09 00 81 00 10 07 3C 64 00');
check('abonnement capteur port B mode 0', P.encodePortInputFormat(1, 0, true, 1), '0A 00 41 01 00 01 00 00 00 01');
check('abonnement capteur mode 1 (comptage)', P.encodePortInputFormat(1, 1, true, 1), '0A 00 41 01 01 01 00 00 00 01');
check('désabonnement', P.encodePortInputFormat(1, 0, false, 1), '0A 00 41 01 00 01 00 00 00 00');
check('LED RGB (224, 169, 74)', P.encodeHubLedRgb(224, 169, 74), '0A 00 81 32 10 51 01 E0 A9 4A');
check('LED par index de couleur', P.encodeHubLedColor(9), '08 00 81 32 10 51 00 09');
check('demande du nom', P.encodeHubProperty(P.HubProperty.ADVERTISING_NAME, P.HubPropertyOperation.REQUEST_UPDATE), '05 00 01 01 05');
check('abonnement batterie', P.encodeHubProperty(P.HubProperty.BATTERY_VOLTAGE, P.HubPropertyOperation.ENABLE_UPDATES), '05 00 01 06 02');
check('renommage « Piano »', P.encodeSetHubName('Piano'), '0A 00 01 01 01 50 69 61 6E 6F');
check('renommage tronqué à 14 caractères', P.encodeSetHubName('AAAAAAAAAAAAAAAAAAAA').length, '19');
check('alerte tension basse : abonnement', P.encodeHubAlert(P.AlertType.LOW_VOLTAGE), '05 00 03 01 01');
check('extinction du hub', P.encodeShutdown(), '04 00 02 01');
check('déconnexion du hub', P.encodeAction(P.ActionType.DISCONNECT), '04 00 02 02');
check('info port A (modes)', P.encodePortInformationRequest(0, 1), '05 00 21 00 01');
check('info port A (combinaisons)', P.encodePortInformationRequest(0, 2), '05 00 21 00 02');
check('info mode : nom du mode 0 du port B', P.encodeModeInformationRequest(1, 0, P.ModeInformationType.NAME), '06 00 22 01 00 00');

const combo = P.encodeCombinedModeSetup(1, [[0, 0], [1, 0]]);
check('mode combiné 1/3 — verrouillage', combo[0], '05 00 42 01 02');
check('mode combiné 2/3 — mode 0, jeu 0', combo[1], '06 00 42 01 01 00');
check('mode combiné 3/3 — mode 1, jeu 0', combo[2], '06 00 42 01 01 10');
check('mode combiné 4/4 — déverrouillage', combo[3], '05 00 42 01 03');

console.log('\nDÉCODAGE');
const dec = (h) => { const b = P.parseHex(h); const d = P.decodeMessage(b); return `${d.name} | ${d.summary}`; };
const show = (label, h) => console.log(`  ${label.padEnd(34)} ${dec(h)}`);
show('moteur branché port A', '0F 00 04 00 01 01 00 00 00 00 10 00 00 00 10');
show('capteur WeDo branché port B', '0F 00 04 01 01 23 00 00 00 00 10 00 00 00 10');
show('appareil retiré', '05 00 04 01 00');
show('valeur capteur (distance 3)', '05 00 45 01 03');
show('batterie 87 %', '06 00 01 06 06 57');
show('nom du hub', '0B 00 01 01 06 50 69 61 6E 6F 21');
show('version micrologiciel', '09 00 01 03 06 24 00 00 10');
show('adresse MAC', '0B 00 01 0D 06 90 84 2B 00 11 22');
show('RSSI -60 dBm', '06 00 01 05 06 C4');
show('alerte tension basse déclenchée', '06 00 03 01 04 FF');
show('alerte revenue à la normale', '06 00 03 01 04 00');
show('erreur : commande inconnue', '05 00 05 81 05');
show('accusé : commande terminée', '05 00 82 00 0A');
show('accusé : commande annulée', '05 00 82 01 04');
show('info port : 3 modes', '0B 00 43 01 01 01 03 03 00 01 00');
show('nom du mode 0', '0B 00 44 01 00 00 44 45 54 45 43');
show('format d\'entrée du port', '0A 00 47 01 00 01 00 00 00 01');
show('tension interne', '06 00 45 3C 35 0F');
show('commande moteur (écho)', '08 00 81 00 10 51 00 32');

console.log('\nCONVERSIONS');
check('tension brute 3893 → 9,615 V', P.rawToVolts(3893).toFixed(3), '9.615');
check('courant brut 4095 → 2444 mA', Math.round(P.rawToMilliamps(4095)).toString(), '2444');
check('version 0x10000224 → 1.0.00.0224', P.decodeVersion(0x10000224), '1.0.00.0224');
check('MAC', P.decodeMacAddress([0x90, 0x84, 0x2b, 0x00, 0x11, 0x22]), '90:84:2b:00:11:22');
check('parseHex tolère « 0x » et virgules', hex(P.parseHex('0x08, 0x00, 0x81')), '08 00 81');

console.log(`\n${ok} vérifications passées, ${ko} en échec\n`);
process.exit(ko ? 1 : 0);
