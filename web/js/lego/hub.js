/**
 * Connexion Web Bluetooth au hub Powered Up du LEGO Grand Piano 21323.
 *
 * Responsabilités :
 *   • établir, surveiller et rétablir le lien BLE ;
 *   • découvrir automatiquement quel port porte le moteur et lequel porte le capteur ;
 *   • sérialiser les écritures GATT (Chrome n'en accepte qu'une à la fois) ;
 *   • fusionner les consignes moteur : seule la dernière compte ;
 *   • exposer tout le reste du protocole (propriétés, alertes, alimentation,
 *     accusés de réception, exploration des ports) pour l'interface et la console.
 *
 * Événements émis (CustomEvent) :
 *   status, device, sensor, battery, button, alert, power, motor, info, raw, log
 */

import {
  LPF2_SERVICE,
  LPF2_CHARACTERISTIC,
  MessageType,
  HubProperty,
  HubPropertyOperation,
  HUB_PROPERTY_LABELS,
  AlertType,
  AlertOperation,
  ALERT_LABELS,
  ActionType,
  ModeInformationType,
  Port,
  SensorMode,
  MOTOR_TYPES,
  SENSOR_TYPES,
  DeviceType,
  ERROR_CODES,
  Feedback,
  encodeMotorPower,
  encodeMotorBrake,
  encodeMotorSpeed,
  encodePortInputFormat,
  encodeCombinedModeSetup,
  encodeHubLedRgb,
  encodeHubProperty,
  encodeSetHubName,
  encodeHubAlert,
  encodeAction,
  encodeShutdown,
  encodePortInformationRequest,
  encodeModeInformationRequest,
  splitMessages,
  decodeMessage,
  decodeVersion,
  decodeMacAddress,
  describeDevice,
  describePort,
  rawToVolts,
  rawToMilliamps,
  toHex,
} from './protocol.js';

/** Intervalle minimal entre deux consignes moteur (ms). ~25 Hz : au-delà, le BLE sature. */
const MOTOR_WRITE_INTERVAL = 40;
/** Au-delà, on considère qu'un accusé de réception ne viendra jamais. */
const FEEDBACK_TIMEOUT = 2000;
/** Taille du tampon circulaire alimentant la console. */
const RAW_LOG_SIZE = 400;
/** Attentes successives avant nouvelle tentative de reconnexion (ms). */
const RECONNECT_BACKOFF = [800, 1500, 3000, 5000, 8000, 12000];

const STORAGE_DEVICE_ID = 'lego-piano-jukebox/deviceId';

export class PianoHub extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.server = null;
    this.characteristic = null;

    this.status = 'disconnected'; // disconnected | connecting | connected | reconnecting
    this.autoReconnect = true;

    /** Tout ce que le hub sait dire de lui-même. */
    this.info = {
      name: null,
      firmware: null,
      hardware: null,
      radioFirmware: null,
      manufacturer: null,
      protocol: null,
      systemType: null,
      macAddress: null,
      batteryType: null,
      battery: null,
      rssi: null,
      voltage: null,
      current: null,
    };
    /** Dernier état connu de chaque alerte. */
    this.alerts = { 1: false, 2: false, 3: false, 4: false };

    /** @type {Map<number, {type:number, label:string}>} */
    this.ports = new Map();
    this.motorPort = null;
    this.motorType = null;
    this.sensorPort = null;
    this.sensorType = null;
    this.sensorMode = SensorMode.DISTANCE;

    this.lastSensorValue = null;
    this.currentPower = 0;

    /** Journal circulaire des trames, pour la console. */
    this.rawLog = [];

    /**
     * Compteurs de liaison, lus par le mode geek. Tout est mesuré : les octets
     * sont ceux réellement écrits sur la caractéristique GATT, et la latence est
     * le temps d'aller-retour de `writeValue…`.
     */
    this.stats = {
      txFrames: 0,
      txBytes: 0,
      rxFrames: 0,
      rxBytes: 0,
      motorWrites: 0,
      writeErrors: 0,
      lastWriteMs: 0,
      avgWriteMs: 0, // moyenne glissante, constante de temps ~1/8
      maxWriteMs: 0,
    };

    this._cmdQueue = [];
    this._motorPending = null;
    this._pumping = false;
    this._lastMotorWrite = 0;
    this._feedbackWaiters = new Map();
    this._userDisconnect = false;
    this._reconnectAttempt = 0;
    this._reconnectTimer = null;
    this._sequenceToken = 0;
    this._onDisconnected = this._onDisconnected.bind(this);
  }

  get connected() {
    return this.status === 'connected';
  }

  static isSupported() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _log(message, level = 'info') {
    this._emit('log', { message, level, at: Date.now() });
  }

  _setStatus(status, extra = {}) {
    this.status = status;
    this._emit('status', { status, ...extra });
  }

  _record(direction, bytes) {
    const counters = direction === 'tx' ? ['txFrames', 'txBytes'] : ['rxFrames', 'rxBytes'];
    this.stats[counters[0]] += 1;
    this.stats[counters[1]] += bytes.length;

    const decoded = decodeMessage(bytes);
    const entry = { at: Date.now(), direction, hex: toHex(bytes), ...decoded };
    this.rawLog.push(entry);
    if (this.rawLog.length > RAW_LOG_SIZE) this.rawLog.shift();
    this._emit('raw', entry);
  }

  /* ---------------------------------------------------------------- */
  /* Connexion                                                        */
  /* ---------------------------------------------------------------- */

  async connect() {
    if (!PianoHub.isSupported()) {
      throw new Error(
        'Le Web Bluetooth n’est pas disponible dans ce navigateur. Utilise Chrome ou Edge (Safari et Firefox ne le prennent pas en charge).'
      );
    }
    if (this.status !== 'disconnected') return;

    this._setStatus('connecting');
    try {
      // Le hub n'est visible que lorsqu'il clignote en blanc : appuie sur le bouton vert.
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [LPF2_SERVICE] }],
        optionalServices: [LPF2_SERVICE],
      });
      await this._attach();
    } catch (error) {
      this._setStatus('disconnected');
      this.device = null;
      this.server = null;
      this.characteristic = null;
      throw error;
    }
  }

  /**
   * Reconnexion silencieuse, sans passer par le sélecteur du navigateur.
   * Ne fonctionne que si l'utilisateur a déjà autorisé ce hub et que Chrome
   * expose `getDevices()`. Renvoie `false` si ce n'est pas possible.
   */
  async connectKnownDevice() {
    if (!PianoHub.isSupported() || typeof navigator.bluetooth.getDevices !== 'function') return false;
    if (this.status !== 'disconnected') return false;

    let savedId = null;
    try {
      savedId = localStorage.getItem(STORAGE_DEVICE_ID);
    } catch { /* navigation privée */ }
    if (!savedId) return false;

    try {
      const devices = await navigator.bluetooth.getDevices();
      const known = devices.find((device) => device.id === savedId);
      if (!known) return false;
      this._setStatus('connecting');
      this.device = known;
      await this._attach();
      return true;
    } catch (error) {
      this._setStatus('disconnected');
      this._log(`Reconnexion silencieuse impossible : ${error.message}`, 'warn');
      return false;
    }
  }

  /** Partie commune à toutes les façons d'arriver jusqu'au hub. */
  async _attach() {
    this._userDisconnect = false;
    this.device.addEventListener('gattserverdisconnected', this._onDisconnected);
    this._log(`Connexion à « ${this.device.name ?? 'hub'} »…`);

    this.server = await this.device.gatt.connect();
    const service = await this.server.getPrimaryService(LPF2_SERVICE);
    this.characteristic = await service.getCharacteristic(LPF2_CHARACTERISTIC);

    this.characteristic.addEventListener('characteristicvaluechanged', (event) =>
      this._onNotification(event.target.value)
    );
    await this.characteristic.startNotifications();

    try {
      localStorage.setItem(STORAGE_DEVICE_ID, this.device.id);
    } catch { /* navigation privée */ }

    this._reconnectAttempt = 0;
    this._setStatus('connected', { name: this.device.name });
    this._log('Hub connecté.', 'success');

    // Le hub annonce spontanément ses ports ; on lui demande en plus son identité.
    this.requestHubInfo();
    this.subscribeAlerts();
    this.subscribePowerSensors();
    // La LED doit être basculée en mode RGB (mode 1) avant d'accepter une couleur.
    this._enqueue(encodePortInputFormat(Port.HUB_LED, 0x01, false));
    this.setLed(0, 40, 60);
  }

  async disconnect() {
    this._userDisconnect = true;
    this._cancelReconnect();
    if (!this.device) return;
    try {
      if (this.connected) await this.stopMotor();
    } catch { /* le hub est peut-être déjà parti */ }
    try {
      this.device.gatt?.disconnect();
    } catch { /* idem */ }
  }

  /** Demande au hub de se déconnecter lui-même (il reste allumé). */
  requestHubDisconnect() {
    this._userDisconnect = true;
    this._enqueue(encodeAction(ActionType.DISCONNECT));
  }

  /** Éteint le hub : le piano s'arrête complètement. */
  shutdown() {
    this._userDisconnect = true;
    this._log('Extinction du hub demandée.', 'warn');
    this._enqueue(encodeShutdown());
  }

  _onDisconnected() {
    const wasConnected = this.status === 'connected';
    this.characteristic = null;
    this.server = null;
    this.ports.clear();
    this.motorPort = null;
    this.sensorPort = null;
    this.currentPower = 0;
    this._cmdQueue.length = 0;
    this._motorPending = null;
    this._rejectAllFeedback('Hub déconnecté');
    this._emit('device', { ports: [] });

    if (this._userDisconnect || !this.autoReconnect || !this.device) {
      this._log('Hub déconnecté.', wasConnected ? 'warn' : 'info');
      this._setStatus('disconnected');
      return;
    }
    this._log('Lien perdu — tentative de reconnexion…', 'warn');
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    this._cancelReconnect();
    const delay = RECONNECT_BACKOFF[Math.min(this._reconnectAttempt, RECONNECT_BACKOFF.length - 1)];
    this._reconnectAttempt += 1;
    this._setStatus('reconnecting', { attempt: this._reconnectAttempt, delay });
    this._reconnectTimer = setTimeout(async () => {
      if (this._userDisconnect || !this.device) return;
      try {
        await this._attach();
      } catch {
        if (this._reconnectAttempt >= 12) {
          this._log('Reconnexion abandonnée après 12 tentatives.', 'error');
          this._setStatus('disconnected');
          return;
        }
        this._scheduleReconnect();
      }
    }, delay);
  }

  _cancelReconnect() {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
  }

  /* ---------------------------------------------------------------- */
  /* Réception                                                        */
  /* ---------------------------------------------------------------- */

  _onNotification(dataView) {
    const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
    for (const message of splitMessages(bytes)) {
      this._record('rx', message);
      this._handleMessage(message);
    }
  }

  _handleMessage(msg) {
    switch (msg[2]) {
      case MessageType.HUB_ATTACHED_IO:
        this._handleAttachedIo(msg);
        break;
      case MessageType.PORT_VALUE_SINGLE:
        this._handlePortValue(msg);
        break;
      case MessageType.PORT_VALUE_COMBINED:
        this._emit('sensor', { combined: true, raw: [...msg.subarray(4)] });
        break;
      case MessageType.HUB_PROPERTIES:
        this._handleHubProperty(msg);
        break;
      case MessageType.HUB_ALERTS:
        this._handleAlert(msg);
        break;
      case MessageType.PORT_OUTPUT_FEEDBACK:
        this._handleFeedback(msg);
        break;
      case MessageType.PORT_INFORMATION:
      case MessageType.PORT_MODE_INFORMATION:
      case MessageType.PORT_INPUT_FORMAT_SINGLE:
      case MessageType.PORT_INPUT_FORMAT_COMBINED:
        // Le détail est déjà lisible dans la console ; on relaie pour l'interface.
        this._emit('portinfo', { message: decodeMessage(msg) });
        break;
      case MessageType.GENERIC_ERROR:
        this._log(
          `Le hub a refusé la commande 0x${msg[3]?.toString(16)} : ${ERROR_CODES[msg[4]] ?? `code 0x${msg[4]?.toString(16)}`}`,
          'warn'
        );
        break;
      default:
        break;
    }
  }

  _handleAttachedIo(msg) {
    const port = msg[3];
    const event = msg[4];

    if (event === 0x00) {
      this.ports.delete(port);
      if (port === this.motorPort) this.motorPort = null;
      if (port === this.sensorPort) this.sensorPort = null;
      this._emit('device', { ports: this.portList() });
      return;
    }

    const type = msg[5] | (msg[6] << 8);
    this._registerDevice(port, type);
  }

  _registerDevice(port, type) {
    this.ports.set(port, { type, label: describeDevice(type) });

    // Seuls les ports physiques A et B nous intéressent pour le piano.
    if ((port === Port.A || port === Port.B) && MOTOR_TYPES.has(type) && this.motorPort === null) {
      this.motorPort = port;
      this.motorType = type;
      this._log(`Moteur détecté sur le ${describePort(port)} (${describeDevice(type)}).`, 'success');
    }
    if ((port === Port.A || port === Port.B) && SENSOR_TYPES.has(type) && this.sensorPort === null) {
      this.sensorPort = port;
      this.sensorType = type;
      this._log(`Capteur détecté sur le ${describePort(port)} (${describeDevice(type)}).`, 'success');
      this.subscribeSensor(this.sensorMode);
    }
    this._emit('device', { ports: this.portList() });
  }

  /**
   * Déclare un appareil à la main, quand le hub ne l'annonce pas —
   * fiche mal enfoncée, ou capteur d'un type que le hub ne reconnaît pas.
   */
  manuallyAttachDevice(port, type) {
    this._log(`Appareil déclaré manuellement : ${describePort(port)} → ${describeDevice(type)}.`, 'warn');
    this._registerDevice(port, type);
  }

  portList() {
    return [...this.ports.entries()].map(([port, info]) => ({ port, ...info }));
  }

  _handlePortValue(msg) {
    const port = msg[3];

    if (port === Port.VOLTAGE) {
      this.info.voltage = rawToVolts(msg[4] | (msg[5] << 8));
      this._emit('power', { voltage: this.info.voltage, current: this.info.current });
      return;
    }
    if (port === Port.CURRENT) {
      this.info.current = rawToMilliamps(msg[4] | (msg[5] << 8));
      this._emit('power', { voltage: this.info.voltage, current: this.info.current });
      return;
    }
    if (port !== this.sensorPort) return;

    if (this.sensorMode === SensorMode.COUNT) {
      // Compteur de passages : entier non signé sur 32 bits.
      const count = (msg[4] | (msg[5] << 8) | (msg[6] << 16) | (msg[7] << 24)) >>> 0;
      this.lastSensorValue = count;
      this._emit('sensor', { mode: SensorMode.COUNT, value: count, count });
      return;
    }
    // Mode distance : un octet, 0 (très près) à 10 (rien devant).
    const raw = msg[4];
    if (raw === undefined) return;
    const value = msg[5] === 1 ? raw + 255 : raw;
    this.lastSensorValue = value;
    this._emit('sensor', { mode: SensorMode.DISTANCE, value, raw });
  }

  _handleHubProperty(msg) {
    const property = msg[3];
    if (msg[4] !== HubPropertyOperation.UPDATE) return;
    const payload = msg.subarray(5);
    const int32 = () => (payload[0] | (payload[1] << 8) | (payload[2] << 16) | (payload[3] << 24)) >>> 0;

    switch (property) {
      case HubProperty.ADVERTISING_NAME:
        this.info.name = new TextDecoder().decode(payload).replace(/\0+$/, '');
        break;
      case HubProperty.BUTTON:
        this._emit('button', { pressed: payload[0] === 1 });
        return;
      case HubProperty.FW_VERSION:
        this.info.firmware = decodeVersion(int32());
        break;
      case HubProperty.HW_VERSION:
        this.info.hardware = decodeVersion(int32());
        break;
      case HubProperty.RADIO_FIRMWARE_VERSION:
        this.info.radioFirmware = new TextDecoder().decode(payload).replace(/\0+$/, '');
        break;
      case HubProperty.RSSI:
        this.info.rssi = payload[0] > 127 ? payload[0] - 256 : payload[0];
        break;
      case HubProperty.BATTERY_VOLTAGE:
        this.info.battery = payload[0];
        this._emit('battery', { level: payload[0] });
        break;
      case HubProperty.BATTERY_TYPE:
        this.info.batteryType = payload[0] === 0 ? 'Piles alcalines' : 'Batterie rechargeable';
        break;
      case HubProperty.MANUFACTURER_NAME:
        this.info.manufacturer = new TextDecoder().decode(payload).replace(/\0+$/, '');
        break;
      case HubProperty.LWP_PROTOCOL_VERSION:
        this.info.protocol = `${payload[1]}.${payload[0]}`;
        break;
      case HubProperty.SYSTEM_TYPE_ID:
        this.info.systemType = `0x${payload[0].toString(16).padStart(2, '0')}`;
        break;
      case HubProperty.PRIMARY_MAC_ADDRESS:
        this.info.macAddress = decodeMacAddress(payload);
        break;
      default:
        break;
    }
    this._emit('info', { info: this.info, property, label: HUB_PROPERTY_LABELS[property] });
  }

  _handleAlert(msg) {
    if (msg[4] !== AlertOperation.UPDATE) return;
    const type = msg[3];
    const active = msg[5] === 0xff;
    if (this.alerts[type] === active) return;
    this.alerts[type] = active;
    const label = ALERT_LABELS[type] ?? `alerte 0x${type.toString(16)}`;
    this._log(active ? `⚠ ${label}` : `${label} : retour à la normale`, active ? 'error' : 'info');
    this._emit('alert', { type, label, active, alerts: { ...this.alerts } });
  }

  _handleFeedback(msg) {
    for (let i = 3; i + 1 < msg.length; i += 2) {
      const port = msg[i];
      const flags = msg[i + 1];
      const waiters = this._feedbackWaiters.get(port);
      if (!waiters?.length) continue;
      if (flags & Feedback.COMPLETED) this._settleFeedback(port, 'completed');
      else if (flags & Feedback.DISCARDED) this._settleFeedback(port, 'discarded');
    }
  }

  _settleFeedback(port, outcome) {
    const waiters = this._feedbackWaiters.get(port);
    const waiter = waiters?.shift();
    if (!waiter) return;
    clearTimeout(waiter.timer);
    waiter.resolve(outcome);
    if (!waiters.length) this._feedbackWaiters.delete(port);
  }

  _rejectAllFeedback(reason) {
    for (const waiters of this._feedbackWaiters.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.resolve(reason);
      }
    }
    this._feedbackWaiters.clear();
  }

  /* ---------------------------------------------------------------- */
  /* Interrogation du hub                                             */
  /* ---------------------------------------------------------------- */

  /** Demande tout ce que le hub sait dire de lui-même. */
  requestHubInfo() {
    const once = [
      HubProperty.ADVERTISING_NAME,
      HubProperty.FW_VERSION,
      HubProperty.HW_VERSION,
      HubProperty.RADIO_FIRMWARE_VERSION,
      HubProperty.MANUFACTURER_NAME,
      HubProperty.LWP_PROTOCOL_VERSION,
      HubProperty.SYSTEM_TYPE_ID,
      HubProperty.PRIMARY_MAC_ADDRESS,
      HubProperty.BATTERY_TYPE,
    ];
    for (const property of once) {
      this._enqueue(encodeHubProperty(property, HubPropertyOperation.REQUEST_UPDATE));
    }
    // Ces trois-là évoluent : on demande à être tenu au courant.
    for (const property of [HubProperty.BATTERY_VOLTAGE, HubProperty.BUTTON, HubProperty.RSSI]) {
      this._enqueue(encodeHubProperty(property, HubPropertyOperation.ENABLE_UPDATES));
    }
  }

  /** Renomme le hub — 14 caractères maximum, conservés dans sa mémoire. */
  setHubName(name) {
    const trimmed = String(name).slice(0, 14);
    if (!trimmed) throw new Error('Le nom ne peut pas être vide.');
    // Envoyé deux fois : la première écriture n'est pas toujours prise en compte.
    this._enqueue(encodeSetHubName(trimmed));
    this._enqueue(encodeSetHubName(trimmed));
    this._enqueue(encodeHubProperty(HubProperty.ADVERTISING_NAME, HubPropertyOperation.REQUEST_UPDATE));
    this._log(`Hub renommé en « ${trimmed} ».`, 'success');
  }

  /** Alertes matérielles : tension basse, courant élevé, signal faible, surpuissance. */
  subscribeAlerts() {
    for (const type of Object.values(AlertType)) {
      this._enqueue(encodeHubAlert(type, AlertOperation.ENABLE_UPDATES));
      this._enqueue(encodeHubAlert(type, AlertOperation.REQUEST_UPDATE));
    }
  }

  /** Mesures internes du hub : tension d'alimentation et courant consommé. */
  subscribePowerSensors(deltaInterval = 30) {
    this._enqueue(encodePortInputFormat(Port.VOLTAGE, 0x00, true, deltaInterval));
    this._enqueue(encodePortInputFormat(Port.CURRENT, 0x00, true, deltaInterval));
  }

  /** Interroge les capacités d'un port : liste des modes, puis combinaisons possibles. */
  requestPortInformation(port) {
    this._enqueue(encodePortInformationRequest(port, 0x01));
    this._enqueue(encodePortInformationRequest(port, 0x02));
  }

  /** Déroule le détail de chaque mode d'un port : nom, unité, bornes, format. */
  exploreModes(port, modeCount = 8) {
    for (let mode = 0; mode < modeCount; mode += 1) {
      for (const type of [
        ModeInformationType.NAME,
        ModeInformationType.RAW,
        ModeInformationType.SI,
        ModeInformationType.SYMBOL,
        ModeInformationType.VALUE_FORMAT,
      ]) {
        this._enqueue(encodeModeInformationRequest(port, mode, type));
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Capteur                                                          */
  /* ---------------------------------------------------------------- */

  subscribeSensor(mode = SensorMode.DISTANCE) {
    if (this.sensorPort === null) return;
    this.sensorMode = mode;
    this.lastSensorValue = null;
    this._enqueue(encodePortInputFormat(this.sensorPort, mode, true, 1));
    this._log(`Capteur en mode ${mode === SensorMode.COUNT ? 'comptage' : 'distance'}.`);
  }

  /**
   * Tente de lire distance et comptage dans la même notification.
   * Expérimental : tous les capteurs ne l'acceptent pas — en cas de refus, le
   * hub répond par une erreur générique, visible dans la console.
   */
  setupCombinedSensorMode() {
    if (this.sensorPort === null) return;
    this._log('Configuration du mode combiné (expérimental)…', 'warn');
    for (const message of encodeCombinedModeSetup(this.sensorPort, [
      [SensorMode.DISTANCE, 0],
      [SensorMode.COUNT, 0],
    ])) {
      this._enqueue(message);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Moteur                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Consigne moteur. Les appels rapprochés se remplacent : seule la dernière
   * valeur part sur le lien BLE, ce qui évite d'accumuler du retard.
   */
  setMotorPower(power) {
    if (!this.connected || this.motorPort === null) return;
    const target = Math.max(-100, Math.min(100, Math.round(power)));
    if (target === this.currentPower && this._motorPending === null) return;
    this._motorPending = target;
    this._pump();
  }

  async stopMotor() {
    this.currentPower = 0;
    this._sequenceToken += 1; // annule toute rampe ou séquence en cours
    if (!this.characteristic || this.motorPort === null) return;
    // Envoi direct, hors file d'attente : un arrêt ne doit jamais attendre.
    // La consigne reste aussi en file, pour repartir si l'écriture directe
    // échoue parce qu'une autre opération GATT est déjà en vol.
    this._motorPending = 0;
    this._lastMotorWrite = 0;
    try {
      await this._write(encodeMotorPower(this.motorPort, 0));
      if (this._motorPending === 0) this._motorPending = null;
    } catch {
      this._pump();
    }
  }

  /**
   * Freinage actif (valeur 127) : le moteur s'oppose à la rotation au lieu de
   * finir en roue libre. L'arbre à cames s'arrête net.
   * @returns {Promise<string>} l'état renvoyé par le hub
   */
  brake() {
    this._sequenceToken += 1;
    this.currentPower = 0;
    this._motorPending = null;
    if (!this.connected || this.motorPort === null) return Promise.resolve('offline');
    return this._sendWithFeedback(encodeMotorBrake(this.motorPort), this.motorPort);
  }

  /**
   * Montée ou descente progressive entre deux puissances.
   * @param {number} from puissance de départ, -100 → 100
   * @param {number} to puissance d'arrivée
   * @param {number} durationMs durée de la transition
   */
  async rampPower(from, to, durationMs = 800) {
    if (!this.connected || this.motorPort === null) return;
    const token = ++this._sequenceToken;
    const started = performance.now();
    const steps = Math.max(1, Math.round(durationMs / MOTOR_WRITE_INTERVAL));

    for (let i = 0; i <= steps; i += 1) {
      if (token !== this._sequenceToken) return; // une autre commande a pris la main
      const ratio = i / steps;
      this.setMotorPower(from + (to - from) * ratio);
      const target = started + (i + 1) * (durationMs / steps);
      const wait = target - performance.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.setMotorPower(to);
  }

  /**
   * Enchaîne des paliers de puissance séparés par des pauses — l'équivalent des
   * commandes séquencées de node-poweredup, en plus simple à lire.
   * @param {Array<{power:number, duration:number, ramp?:number}>} steps
   */
  async runSequence(steps) {
    if (!this.connected || this.motorPort === null) return 'offline';
    const token = ++this._sequenceToken;
    let previous = this.currentPower;

    for (const step of steps) {
      if (token !== this._sequenceToken) return 'interrupted';
      if (step.ramp) {
        await this.rampPower(previous, step.power, step.ramp);
        // rampPower incrémente le jeton : on se réaligne pour rester maître.
        this._sequenceToken = token;
      } else {
        this.setMotorPower(step.power);
      }
      previous = step.power;
      const until = performance.now() + step.duration;
      while (performance.now() < until) {
        if (token !== this._sequenceToken) return 'interrupted';
        await new Promise((resolve) => setTimeout(resolve, Math.min(40, until - performance.now())));
      }
    }
    if (token !== this._sequenceToken) return 'interrupted';
    await this.stopMotor();
    return 'completed';
  }

  setLed(r, g, b) {
    this._enqueue(encodeHubLedRgb(r, g, b));
  }

  /* ---------------------------------------------------------------- */
  /* Émission                                                         */
  /* ---------------------------------------------------------------- */

  /** Envoie une trame brute déjà formée — utilisé par la console. */
  sendRaw(bytes) {
    if (!this.characteristic) throw new Error('Hub non connecté.');
    if (!bytes.length || bytes[0] !== bytes.length) {
      throw new Error(`Le premier octet doit être la longueur totale (${bytes.length} attendu, 0x${bytes[0]?.toString(16)} reçu).`);
    }
    this._enqueue(bytes);
  }

  _enqueue(message) {
    if (!this.characteristic) return;
    this._cmdQueue.push(message);
    this._pump();
  }

  /** Envoie une commande de sortie et attend l'accusé de réception du hub. */
  _sendWithFeedback(message, port) {
    return new Promise((resolve) => {
      if (!this._feedbackWaiters.has(port)) this._feedbackWaiters.set(port, []);
      const waiter = {
        resolve,
        timer: setTimeout(() => {
          const waiters = this._feedbackWaiters.get(port) ?? [];
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          resolve('timeout');
        }, FEEDBACK_TIMEOUT),
      };
      this._feedbackWaiters.get(port).push(waiter);
      this._enqueue(message);
    });
  }

  /** Nombre de messages en attente d'écriture (mode geek). */
  get queueDepth() {
    return this._cmdQueue.length + (this._motorPending === null ? 0 : 1);
  }

  async _pump() {
    if (this._pumping || !this.characteristic) return;
    this._pumping = true;
    try {
      while (this.characteristic && (this._cmdQueue.length || this._motorPending !== null)) {
        if (this._cmdQueue.length) {
          await this._write(this._cmdQueue.shift());
          continue;
        }
        const wait = MOTOR_WRITE_INTERVAL - (performance.now() - this._lastMotorWrite);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        if (this._motorPending === null) break;
        const power = this._motorPending;
        this._motorPending = null;
        const message =
          this.motorType === DeviceType.SIMPLE_MEDIUM_LINEAR_MOTOR || this.motorType === DeviceType.TRAIN_MOTOR
            ? encodeMotorPower(this.motorPort, power)
            : encodeMotorSpeed(this.motorPort, power);
        await this._write(message);
        this._lastMotorWrite = performance.now();
        this.currentPower = power;
        this.stats.motorWrites += 1;
        this._emit('motor', { power });
      }
    } catch (error) {
      this._log(`Écriture BLE impossible : ${error.message}`, 'error');
    } finally {
      this._pumping = false;
    }
  }

  async _write(message) {
    const char = this.characteristic;
    if (!char) return;
    this._record('tx', message);

    const started = performance.now();
    try {
      if (char.writeValueWithoutResponse) await char.writeValueWithoutResponse(message);
      else await char.writeValue(message);
    } catch (error) {
      this.stats.writeErrors += 1;
      throw error;
    }
    const elapsed = performance.now() - started;
    this.stats.lastWriteMs = elapsed;
    this.stats.avgWriteMs = this.stats.avgWriteMs ? this.stats.avgWriteMs * 0.875 + elapsed * 0.125 : elapsed;
    this.stats.maxWriteMs = Math.max(this.stats.maxWriteMs, elapsed);
  }
}
