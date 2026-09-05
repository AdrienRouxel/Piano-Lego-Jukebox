/**
 * LEGO Wireless Protocol 3.0 — encodage et décodage.
 *
 * Le piano embarque un « Powered Up 2-port Hub » (référence commerciale 88009,
 * pièce bb0892c01), alimenté par 6 piles AAA, avec :
 *   • port A ou B : un moteur simple (Simple Medium Linear Motor, sans encodeur)
 *     qui entraîne l'arbre à cames soulevant les touches ;
 *   • l'autre port : un capteur de distance WeDo 2.0 qui voit passer un drapeau
 *     lorsqu'une touche est enfoncée ;
 *   • port 50 : la LED RGB du bouton ;
 *   • ports 59 et 60 : les mesures internes de courant et de tension.
 *
 * Spécification publiée par LEGO :
 * https://lego.github.io/lego-ble-wireless-protocol-docs/
 *
 * Format d'un message : [longueur, hubId(0x00), type, ...charge utile]
 */

export const LPF2_SERVICE = '00001623-1212-efde-1623-785feabcd123';
export const LPF2_CHARACTERISTIC = '00001624-1212-efde-1623-785feabcd123';

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

export const MessageType = {
  HUB_PROPERTIES: 0x01,
  HUB_ACTIONS: 0x02,
  HUB_ALERTS: 0x03,
  HUB_ATTACHED_IO: 0x04,
  GENERIC_ERROR: 0x05,
  HW_NETWORK_COMMANDS: 0x08,
  FW_UPDATE_GO_INTO_BOOT_MODE: 0x10,
  FW_UPDATE_LOCK_MEMORY: 0x11,
  FW_UPDATE_LOCK_STATUS_REQUEST: 0x12,
  FW_LOCK_STATUS: 0x13,
  PORT_INFORMATION_REQUEST: 0x21,
  PORT_MODE_INFORMATION_REQUEST: 0x22,
  PORT_INPUT_FORMAT_SETUP: 0x41,
  PORT_INPUT_FORMAT_SETUP_COMBINED: 0x42,
  PORT_INFORMATION: 0x43,
  PORT_MODE_INFORMATION: 0x44,
  PORT_VALUE_SINGLE: 0x45,
  PORT_VALUE_COMBINED: 0x46,
  PORT_INPUT_FORMAT_SINGLE: 0x47,
  PORT_INPUT_FORMAT_COMBINED: 0x48,
  VIRTUAL_PORT_SETUP: 0x61,
  PORT_OUTPUT_COMMAND: 0x81,
  PORT_OUTPUT_FEEDBACK: 0x82,
};

export const MESSAGE_TYPE_NAMES = Object.fromEntries(
  Object.entries(MessageType).map(([name, value]) => [value, name])
);

export const HubProperty = {
  ADVERTISING_NAME: 0x01,
  BUTTON: 0x02,
  FW_VERSION: 0x03,
  HW_VERSION: 0x04,
  RSSI: 0x05,
  BATTERY_VOLTAGE: 0x06,
  BATTERY_TYPE: 0x07,
  MANUFACTURER_NAME: 0x08,
  RADIO_FIRMWARE_VERSION: 0x09,
  LWP_PROTOCOL_VERSION: 0x0a,
  SYSTEM_TYPE_ID: 0x0b,
  HW_NETWORK_ID: 0x0c,
  PRIMARY_MAC_ADDRESS: 0x0d,
  SECONDARY_MAC_ADDRESS: 0x0e,
  HW_NETWORK_FAMILY: 0x0f,
};

export const HUB_PROPERTY_LABELS = {
  0x01: 'Nom Bluetooth',
  0x02: 'Bouton',
  0x03: 'Version du micrologiciel',
  0x04: 'Version matérielle',
  0x05: 'Puissance du signal',
  0x06: 'Batterie',
  0x07: 'Type de piles',
  0x08: 'Fabricant',
  0x09: 'Micrologiciel radio',
  0x0a: 'Version du protocole',
  0x0b: 'Type de système',
  0x0c: 'Identifiant réseau',
  0x0d: 'Adresse MAC',
  0x0e: 'Adresse MAC secondaire',
  0x0f: 'Famille réseau',
};

export const HubPropertyOperation = {
  SET: 0x01,
  ENABLE_UPDATES: 0x02,
  DISABLE_UPDATES: 0x03,
  RESET: 0x04,
  REQUEST_UPDATE: 0x05,
  UPDATE: 0x06,
};

export const ActionType = {
  SWITCH_OFF_HUB: 0x01,
  DISCONNECT: 0x02,
  VCC_PORT_CONTROL_ON: 0x03,
  VCC_PORT_CONTROL_OFF: 0x04,
  ACTIVATE_BUSY_INDICATION: 0x05,
  RESET_BUSY_INDICATION: 0x06,
  SHUTDOWN: 0x2f,
  HUB_WILL_SWITCH_OFF: 0x30,
  HUB_WILL_DISCONNECT: 0x31,
  HUB_WILL_GO_INTO_BOOT_MODE: 0x32,
};

export const AlertType = {
  LOW_VOLTAGE: 0x01,
  HIGH_CURRENT: 0x02,
  LOW_SIGNAL_STRENGTH: 0x03,
  OVER_POWER_CONDITION: 0x04,
};

export const ALERT_LABELS = {
  0x01: 'Tension basse',
  0x02: 'Courant élevé',
  0x03: 'Signal faible',
  0x04: 'Surpuissance',
};

export const AlertOperation = {
  ENABLE_UPDATES: 0x01,
  DISABLE_UPDATES: 0x02,
  REQUEST_UPDATE: 0x03,
  UPDATE: 0x04,
};

export const ModeInformationType = {
  NAME: 0x00,
  RAW: 0x01,
  PCT: 0x02,
  SI: 0x03,
  SYMBOL: 0x04,
  MAPPING: 0x05,
  USED_INTERNALLY: 0x06,
  MOTOR_BIAS: 0x07,
  CAPABILITY_BITS: 0x08,
  VALUE_FORMAT: 0x80,
};

/** Modes de réglage d'entrée combinée (message 0x42). */
export const CombinedModeSubCommand = {
  SET_MODE_DATASET: 0x01,
  LOCK: 0x02,
  UNLOCK_AND_START_MULTI: 0x03,
  UNLOCK_AND_START_SINGLE: 0x04,
  NOT_USED: 0x05,
  RESET: 0x06,
};

export const ERROR_CODES = {
  0x01: 'ACK',
  0x02: 'MACK',
  0x03: 'Tampon plein',
  0x04: 'Délai dépassé',
  0x05: 'Commande inconnue',
  0x06: 'Message mal formé',
  0x07: 'Paramètre hors limites',
  0x08: 'Commande déjà en cours',
};

/** Bits du retour de commande (message 0x82). */
export const Feedback = {
  IN_PROGRESS: 0x01,
  COMPLETED: 0x02,
  DISCARDED: 0x04,
  IDLE: 0x08,
  BUSY: 0x10,
};

/** Style d'arrêt d'un moteur. */
export const BrakingStyle = {
  FLOAT: 0,
  HOLD: 126,
  BRAKE: 127,
};

/** Identifiants de type d'appareil, tels qu'annoncés par le hub. */
export const DeviceType = {
  SIMPLE_MEDIUM_LINEAR_MOTOR: 1,
  TRAIN_MOTOR: 2,
  LIGHT: 8,
  VOLTAGE_SENSOR: 20,
  CURRENT_SENSOR: 21,
  PIEZO_BUZZER: 22,
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
  22: 'Buzzer piézo',
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

export const PORT_LABELS = {
  0x00: 'Port A',
  0x01: 'Port B',
  0x32: 'LED du hub',
  0x3b: 'Courant',
  0x3c: 'Tension',
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

/**
 * Modes du capteur de distance WeDo 2.0 (type 35).
 *   0 — DETECT : distance instantanée, 0 (collé) à 10 (rien devant)
 *   1 — COUNT  : compteur de passages, remis à zéro à la mise sous tension
 */
export const SensorMode = {
  DISTANCE: 0x00,
  COUNT: 0x01,
};

/* ------------------------------------------------------------------ */
/* Encodage                                                            */
/* ------------------------------------------------------------------ */

/** Préfixe [longueur, hubId] attendu par le hub. */
function frame(payload) {
  const message = new Uint8Array(payload.length + 2);
  message[0] = message.length;
  message[1] = 0x00;
  message.set(payload, 2);
  return message;
}

const byte = (value) => (value < 0 ? 256 + value : value) & 0xff;

/**
 * Puissance moteur brute, de -100 à 100 (0 = roue libre, 126 = maintien,
 * 127 = frein). Sous-commande 0x51 « WriteDirectModeData », mode 0.
 *
 * @param {number} port
 * @param {number} power
 * @param {boolean} feedback demander un accusé de réception (message 0x82).
 *   Coûteux : à laisser à `false` pour le flux continu de la chorégraphie.
 */
export function encodeMotorPower(port, power, feedback = false) {
  const clamped = power === BrakingStyle.BRAKE || power === BrakingStyle.HOLD
    ? power
    : Math.max(-100, Math.min(100, Math.round(power)));
  return frame([MessageType.PORT_OUTPUT_COMMAND, port, feedback ? 0x11 : 0x10, 0x51, 0x00, byte(clamped)]);
}

/** Freinage actif : le moteur s'oppose à la rotation au lieu d'être libre. */
export function encodeMotorBrake(port, feedback = true) {
  return encodeMotorPower(port, BrakingStyle.BRAKE, feedback);
}

/** Vitesse régulée — uniquement pour les moteurs à encodeur (sous-commande 0x07). */
export function encodeMotorSpeed(port, speed, maxPower = 100, feedback = false) {
  const clamped = Math.max(-100, Math.min(100, Math.round(speed)));
  return frame([MessageType.PORT_OUTPUT_COMMAND, port, feedback ? 0x11 : 0x10, 0x07, byte(clamped), maxPower, 0x00]);
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

/** Message brut de réglage d'entrée combinée (0x42). */
export function encodePortInputFormatCombined(port, subCommand, payload = []) {
  return frame([MessageType.PORT_INPUT_FORMAT_SETUP_COMBINED, port, subCommand, ...payload]);
}

/**
 * Séquence complète pour lire plusieurs modes d'un capteur en une notification.
 * Chaque entrée est `[mode, dataSet]` ; le hub renverra alors des messages 0x46.
 *
 * Tous les appareils ne le prennent pas en charge : en cas de refus le hub
 * répond par une erreur générique (0x05), que l'appelant verra dans la console.
 */
export function encodeCombinedModeSetup(port, combinations) {
  const messages = [
    // 1. verrouiller le port pour le configurer
    encodePortInputFormatCombined(port, CombinedModeSubCommand.LOCK),
  ];
  // 2. déclarer chaque couple mode/jeu de données à inclure
  for (const [mode, dataSet] of combinations) {
    messages.push(
      encodePortInputFormatCombined(port, CombinedModeSubCommand.SET_MODE_DATASET, [((mode & 0x0f) << 4) | (dataSet & 0x0f)])
    );
  }
  // 3. déverrouiller et démarrer les notifications multiples
  messages.push(
    encodePortInputFormatCombined(port, CombinedModeSubCommand.UNLOCK_AND_START_MULTI)
  );
  return messages;
}

/** LED du hub en RGB. Le mode 1 doit avoir été sélectionné au préalable. */
export function encodeHubLedRgb(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return frame([MessageType.PORT_OUTPUT_COMMAND, Port.HUB_LED, 0x10, 0x51, 0x01, c(r), c(g), c(b)]);
}

/** LED du hub par index de couleur (0 à 10). Le mode 0 doit être sélectionné. */
export function encodeHubLedColor(colorIndex) {
  return frame([MessageType.PORT_OUTPUT_COMMAND, Port.HUB_LED, 0x10, 0x51, 0x00, colorIndex & 0xff]);
}

export function encodeHubProperty(property, operation) {
  return frame([MessageType.HUB_PROPERTIES, property, operation]);
}

/** Renomme le hub. Le nom est conservé dans sa mémoire, 14 caractères maximum. */
export function encodeSetHubName(name) {
  const ascii = [...name.slice(0, 14)].map((c) => c.charCodeAt(0) & 0x7f);
  return frame([MessageType.HUB_PROPERTIES, HubProperty.ADVERTISING_NAME, HubPropertyOperation.SET, ...ascii]);
}

/** Abonnement aux alertes (tension basse, courant élevé, signal faible, surpuissance). */
export function encodeHubAlert(alertType, operation = AlertOperation.ENABLE_UPDATES) {
  return frame([MessageType.HUB_ALERTS, alertType, operation]);
}

export function encodeAction(action) {
  return frame([MessageType.HUB_ACTIONS, action]);
}

/** Coupe proprement le hub (le piano s'éteint). */
export function encodeShutdown() {
  return encodeAction(ActionType.SWITCH_OFF_HUB);
}

/** Demande les capacités d'un port : 0x01 = modes, 0x02 = combinaisons possibles. */
export function encodePortInformationRequest(port, informationType = 0x01) {
  return frame([MessageType.PORT_INFORMATION_REQUEST, port, informationType]);
}

/** Demande un détail d'un mode : nom, unité, bornes, format… */
export function encodeModeInformationRequest(port, mode, informationType) {
  return frame([MessageType.PORT_MODE_INFORMATION_REQUEST, port, mode, informationType]);
}

/* ------------------------------------------------------------------ */
/* Décodage                                                            */
/* ------------------------------------------------------------------ */

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

export function describePort(port) {
  return PORT_LABELS[port] ?? `Port 0x${port.toString(16).padStart(2, '0')}`;
}

export const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');

/** « 08 00 81 00 10 51 00 32 » ou « 080081… » → Uint8Array. */
export function parseHex(text) {
  const cleaned = text.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
  if (cleaned.length % 2 !== 0) throw new Error('Nombre impair de chiffres hexadécimaux.');
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Les versions LEGO sont codées en BCD sur 32 bits : 1.0.00.0224. */
export function decodeVersion(value) {
  const hex = (value >>> 0).toString(16).padStart(8, '0');
  return `${hex[0]}.${hex[1]}.${hex.slice(2, 4)}.${hex.slice(4)}`;
}

export function decodeMacAddress(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(':');
}

const int32le = (msg, offset) =>
  (msg[offset] | (msg[offset + 1] << 8) | (msg[offset + 2] << 16) | (msg[offset + 3] << 24)) >>> 0;
const uint16le = (msg, offset) => msg[offset] | (msg[offset + 1] << 8);
const int8 = (value) => (value > 127 ? value - 256 : value);

/**
 * Conversions internes du hub 88009. Les valeurs brutes sont sur 16 bits ;
 * les facteurs viennent des tables de node-poweredup.
 */
export const rawToVolts = (raw) => (raw * 9.615) / 3893;
export const rawToMilliamps = (raw) => (raw * 2444) / 4095;

/**
 * Traduit un message en texte lisible, pour la console.
 * @returns {{name: string, summary: string}}
 */
export function decodeMessage(msg) {
  const type = msg[2];
  const name = MESSAGE_TYPE_NAMES[type] ?? `0x${type?.toString(16)}`;

  switch (type) {
    case MessageType.HUB_PROPERTIES: {
      const label = HUB_PROPERTY_LABELS[msg[3]] ?? `propriété 0x${msg[3]?.toString(16)}`;
      const payload = msg.subarray(5);
      return { name, summary: `${label} → ${describeProperty(msg[3], payload)}` };
    }
    case MessageType.HUB_ACTIONS:
      return { name, summary: `action 0x${msg[3]?.toString(16).padStart(2, '0')}` };
    case MessageType.HUB_ALERTS: {
      const label = ALERT_LABELS[msg[3]] ?? `alerte 0x${msg[3]?.toString(16)}`;
      const active = msg[5] === 0xff;
      return { name, summary: `${label} : ${msg[4] === AlertOperation.UPDATE ? (active ? 'DÉCLENCHÉE' : 'normale') : 'abonnement'}` };
    }
    case MessageType.HUB_ATTACHED_IO: {
      const port = describePort(msg[3]);
      if (msg[4] === 0x00) return { name, summary: `${port} — appareil retiré` };
      const deviceType = uint16le(msg, 5);
      const hw = msg.length >= 15 ? decodeVersion(int32le(msg, 7)) : '?';
      const sw = msg.length >= 15 ? decodeVersion(int32le(msg, 11)) : '?';
      return { name, summary: `${port} — ${describeDevice(deviceType)} (matériel ${hw}, logiciel ${sw})` };
    }
    case MessageType.GENERIC_ERROR:
      return {
        name,
        summary: `commande 0x${msg[3]?.toString(16)} refusée : ${ERROR_CODES[msg[4]] ?? `code 0x${msg[4]?.toString(16)}`}`,
      };
    case MessageType.PORT_INFORMATION: {
      if (msg[4] === 0x02) {
        const masks = [];
        for (let i = 5; i + 1 < msg.length; i += 2) masks.push(uint16le(msg, i).toString(2));
        return { name, summary: `${describePort(msg[3])} — combinaisons possibles : ${masks.join(', ') || 'aucune'}` };
      }
      return {
        name,
        summary: `${describePort(msg[3])} — ${msg[6]} modes, entrées 0b${uint16le(msg, 7).toString(2)}, sorties 0b${uint16le(msg, 9).toString(2)}`,
      };
    }
    case MessageType.PORT_MODE_INFORMATION:
      return { name, summary: `${describePort(msg[3])}, mode ${msg[4]} — ${describeModeInformation(msg)}` };
    case MessageType.PORT_VALUE_SINGLE:
      return { name, summary: `${describePort(msg[3])} = ${toHex(msg.subarray(4))}` };
    case MessageType.PORT_VALUE_COMBINED:
      return { name, summary: `${describePort(msg[3])} (combiné) = ${toHex(msg.subarray(4))}` };
    case MessageType.PORT_INPUT_FORMAT_SINGLE:
      return {
        name,
        summary: `${describePort(msg[3])} — mode ${msg[4]}, notifications ${msg[9] ? 'activées' : 'coupées'}`,
      };
    case MessageType.PORT_INPUT_FORMAT_COMBINED:
      return { name, summary: `${describePort(msg[3])} — configuration combinée ${toHex(msg.subarray(4))}` };
    case MessageType.PORT_OUTPUT_COMMAND: {
      const flags = [];
      if ((msg[4] & 0xf0) === 0x10) flags.push('immédiat');
      if (msg[4] & 0x0f) flags.push('avec accusé');
      return { name, summary: `${describePort(msg[3])} — sous-commande 0x${msg[5]?.toString(16)} [${flags.join(', ')}] ${toHex(msg.subarray(6))}` };
    }
    case MessageType.PORT_OUTPUT_FEEDBACK: {
      const parts = [];
      for (let i = 3; i + 1 < msg.length; i += 2) parts.push(`${describePort(msg[i])} : ${describeFeedback(msg[i + 1])}`);
      return { name, summary: parts.join(' | ') };
    }
    default:
      return { name, summary: toHex(msg.subarray(3)) };
  }
}

function describeProperty(property, payload) {
  switch (property) {
    case HubProperty.ADVERTISING_NAME:
    case HubProperty.MANUFACTURER_NAME:
      return new TextDecoder().decode(payload).replace(/\0+$/, '');
    case HubProperty.BUTTON:
      return payload[0] === 1 ? 'enfoncé' : 'relâché';
    case HubProperty.FW_VERSION:
    case HubProperty.HW_VERSION:
    case HubProperty.RADIO_FIRMWARE_VERSION:
      return decodeVersion(int32le(payload, 0));
    case HubProperty.RSSI:
      return `${int8(payload[0])} dBm`;
    case HubProperty.BATTERY_VOLTAGE:
      return `${payload[0]} %`;
    case HubProperty.BATTERY_TYPE:
      return payload[0] === 0 ? 'piles alcalines' : 'batterie rechargeable';
    case HubProperty.LWP_PROTOCOL_VERSION:
      return `${payload[1]}.${payload[0]}`;
    case HubProperty.PRIMARY_MAC_ADDRESS:
    case HubProperty.SECONDARY_MAC_ADDRESS:
      return decodeMacAddress(payload);
    default:
      return toHex(payload);
  }
}

function describeModeInformation(msg) {
  const type = msg[5];
  const payload = msg.subarray(6);
  const text = () => new TextDecoder().decode(payload).replace(/\0+$/, '').trim();
  const floats = () => {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    return `${view.getFloat32(0, true)} … ${view.getFloat32(4, true)}`;
  };
  switch (type) {
    case ModeInformationType.NAME:
      return `nom « ${text()} »`;
    case ModeInformationType.RAW:
      return `brut ${floats()}`;
    case ModeInformationType.PCT:
      return `pourcentage ${floats()}`;
    case ModeInformationType.SI:
      return `unité SI ${floats()}`;
    case ModeInformationType.SYMBOL:
      return `symbole « ${text()} »`;
    case ModeInformationType.VALUE_FORMAT:
      return `format ${payload[0]} × ${['8 bits', '16 bits', '32 bits', 'flottant'][payload[1]] ?? '?'}, ${payload[2]}.${payload[3]} chiffres`;
    default:
      return `info 0x${type?.toString(16)} = ${toHex(payload)}`;
  }
}

function describeFeedback(flags) {
  const parts = [];
  if (flags & Feedback.IN_PROGRESS) parts.push('en cours');
  if (flags & Feedback.COMPLETED) parts.push('terminée');
  if (flags & Feedback.DISCARDED) parts.push('annulée');
  if (flags & Feedback.IDLE) parts.push('au repos');
  if (flags & Feedback.BUSY) parts.push('occupé');
  return parts.join(' + ') || 'aucun état';
}
