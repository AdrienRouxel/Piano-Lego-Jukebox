/**
 * LEGO Wireless Protocol 3.0 — le strict nécessaire pour le Grand Piano 21323.
 *
 * Le piano embarque un « Powered Up 2-port Hub » (référence commerciale 88009,
 * pièce bb0892c01), alimenté par 6 piles AAA, avec :
 *   • port A ou B : un moteur simple (Simple Medium Linear Motor, sans encodeur)
 *     qui entraîne l'arbre à cames soulevant les touches ;
 *   • l'autre port : un capteur de distance WeDo 2.0 qui voit passer un drapeau
 *     lorsqu'une touche est enfoncée ;
 *   • port 50 : la LED RGB du bouton.
 *
 * Le protocole est publié par LEGO :
 * https://lego.github.io/lego-ble-wireless-protocol-docs/
 *
 * Format d'un message : [longueur, hubId(0x00), type, ...charge utile]
 */

export const LPF2_SERVICE = '00001623-1212-efde-1623-785feabcd123';
export const LPF2_CHARACTERISTIC = '00001624-1212-efde-1623-785feabcd123';

export const MessageType = {
  HUB_PROPERTIES: 0x01,
  HUB_ACTIONS: 0x02,
  HUB_ALERTS: 0x03,
  HUB_ATTACHED_IO: 0x04,
  GENERIC_ERROR: 0x05,
  PORT_INPUT_FORMAT_SETUP: 0x41,
  PORT_INFORMATION: 0x43,
  PORT_VALUE_SINGLE: 0x45,
  PORT_INPUT_FORMAT_SINGLE: 0x47,
  PORT_OUTPUT_COMMAND: 0x81,
  PORT_OUTPUT_FEEDBACK: 0x82,
};

export const HubProperty = {
  ADVERTISING_NAME: 0x01,
  BUTTON: 0x02,
  FW_VERSION: 0x03,
  BATTERY_VOLTAGE: 0x06,
  RSSI: 0x05,
};

export const HubPropertyOperation = {
  ENABLE_UPDATES: 0x02,
  DISABLE_UPDATES: 0x03,
  REQUEST_UPDATE: 0x05,
};

/** Identifiants de type d'appareil, tels qu'annoncés par le hub. */
export const DeviceType = {
  SIMPLE_MEDIUM_LINEAR_MOTOR: 1,
  TRAIN_MOTOR: 2,
  LIGHT: 8,
  VOLTAGE_SENSOR: 20,
  CURRENT_SENSOR: 21,
  HUB_LED: 23,
  TILT_SENSOR: 34,
  MOTION_SENSOR: 35, // capteur de distance WeDo 2.0 — celui du piano
  COLOR_DISTANCE_SENSOR: 37,
  MEDIUM_LINEAR_MOTOR: 38,
};

export const DEVICE_LABELS = {
  1: 'Moteur simple',
  2: 'Moteur de train',
  8: 'Lumière',
  20: 'Capteur de tension',
  21: 'Capteur de courant',
  23: 'LED du hub',
  34: 'Capteur d’inclinaison',
  35: 'Capteur de distance WeDo 2.0',
  37: 'Capteur couleur / distance',
  38: 'Moteur linéaire moyen',
};

/** Ports fixes du City Hub. A et B sont les deux prises physiques. */
export const Port = {
  A: 0x00,
  B: 0x01,
  HUB_LED: 0x32,
  CURRENT: 0x3b,
  VOLTAGE: 0x3c,
};

/** Les moteurs sans encodeur ne comprennent que la commande « puissance directe ». */
export const MOTOR_TYPES = new Set([
  DeviceType.SIMPLE_MEDIUM_LINEAR_MOTOR,
  DeviceType.TRAIN_MOTOR,
  DeviceType.MEDIUM_LINEAR_MOTOR,
]);

export const SENSOR_TYPES = new Set([
  DeviceType.MOTION_SENSOR,
  DeviceType.COLOR_DISTANCE_SENSOR,
]);

/** Préfixe [longueur, hubId] attendu par le hub. */
function frame(payload) {
  const message = new Uint8Array(payload.length + 2);
  message[0] = message.length;
  message[1] = 0x00;
  message.set(payload, 2);
  return message;
}

/**
 * Puissance moteur brute, de -100 à 100 (0 = roue libre, 127 = frein).
 * Sous-commande 0x51 « WriteDirectModeData », mode 0.
 * Startup/Completion = 0x10 : exécution immédiate, sans accusé de réception —
 * c'est ce qu'il faut pour un flux de commandes à 15 Hz.
 */
export function encodeMotorPower(port, power) {
  const clamped = power === 127 ? 127 : Math.max(-100, Math.min(100, Math.round(power)));
  const byte = clamped < 0 ? 256 + clamped : clamped;
  return frame([MessageType.PORT_OUTPUT_COMMAND, port, 0x10, 0x51, 0x00, byte]);
}

/** Vitesse régulée — uniquement pour les moteurs à encodeur (sous-commande 0x07). */
export function encodeMotorSpeed(port, speed, maxPower = 100) {
  const clamped = Math.max(-100, Math.min(100, Math.round(speed)));
  const byte = clamped < 0 ? 256 + clamped : clamped;
  return frame([MessageType.PORT_OUTPUT_COMMAND, port, 0x10, 0x07, byte, maxPower, 0x00]);
}

/** Active (ou coupe) les notifications de valeur d'un port, dans un mode donné. */
export function encodePortInputFormat(port, mode, enabled = true, deltaInterval = 1) {
  return frame([
    MessageType.PORT_INPUT_FORMAT_SETUP,
    port,
    mode,
    deltaInterval & 0xff,
    (deltaInterval >> 8) & 0xff,
    (deltaInterval >> 16) & 0xff,
    (deltaInterval >> 24) & 0xff,
    enabled ? 0x01 : 0x00,
  ]);
}

/** LED du hub en RGB. Le mode 1 doit avoir été sélectionné au préalable. */
export function encodeHubLedRgb(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return frame([MessageType.PORT_OUTPUT_COMMAND, Port.HUB_LED, 0x10, 0x51, 0x01, c(r), c(g), c(b)]);
}

export function encodeHubProperty(property, operation) {
  return frame([MessageType.HUB_PROPERTIES, property, operation]);
}

/** Coupe proprement le hub (le piano s'éteint). */
export function encodeShutdown() {
  return frame([MessageType.HUB_ACTIONS, 0x01]);
}

/**
 * Découpe un flux d'octets en messages complets.
 * Le hub peut regrouper plusieurs messages dans une même notification.
 */
export function splitMessages(bytes) {
  const messages = [];
  let offset = 0;
  while (offset < bytes.length) {
    const length = bytes[offset];
    if (!length || offset + length > bytes.length) break;
    messages.push(bytes.subarray(offset, offset + length));
    offset += length;
  }
  return messages;
}

export function describeDevice(type) {
  return DEVICE_LABELS[type] ?? `Appareil inconnu (type ${type})`;
}
