/**
 * Connexion Web Bluetooth au hub Powered Up du LEGO Grand Piano 21323.
 *
 * Responsabilités :
 *   • établir et surveiller le lien BLE ;
 *   • découvrir automatiquement quel port porte le moteur et lequel porte le capteur ;
 *   • sérialiser les écritures GATT (Chrome n'en accepte qu'une à la fois) ;
 *   • fusionner les consignes moteur : seule la dernière compte.
 *
 * Événements émis (CustomEvent) : `status`, `device`, `sensor`, `battery`, `button`, `log`.
 */

import {
  LPF2_SERVICE,
  LPF2_CHARACTERISTIC,
  MessageType,
  HubProperty,
  HubPropertyOperation,
  Port,
  MOTOR_TYPES,
  SENSOR_TYPES,
  DeviceType,
  encodeMotorPower,
  encodeMotorSpeed,
  encodePortInputFormat,
  encodeHubLedRgb,
  encodeHubProperty,
  splitMessages,
  describeDevice,
} from './protocol.js';

/** Intervalle minimal entre deux consignes moteur (ms). ~25 Hz : au-delà, le BLE sature. */
const MOTOR_WRITE_INTERVAL = 40;

export class PianoHub extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.server = null;
    this.characteristic = null;

    this.status = 'disconnected'; // disconnected | connecting | connected
    this.hubName = null;
    this.batteryLevel = null;
    this.firmware = null;

    /** @type {Map<number, {type:number, label:string}>} */
    this.ports = new Map();
    this.motorPort = null;
    this.motorType = null;
    this.sensorPort = null;
    this.sensorType = null;

    this.lastSensorValue = null;
    this.currentPower = 0;

    this._cmdQueue = [];
    this._motorPending = null;
    this._pumping = false;
    this._lastMotorWrite = 0;
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

      this.device.addEventListener('gattserverdisconnected', this._onDisconnected);
      this._log(`Appairage avec « ${this.device.name ?? 'hub'} »…`);

      this.server = await this.device.gatt.connect();
      const service = await this.server.getPrimaryService(LPF2_SERVICE);
      this.characteristic = await service.getCharacteristic(LPF2_CHARACTERISTIC);

      this.characteristic.addEventListener('characteristicvaluechanged', (event) =>
        this._onNotification(event.target.value)
      );
      await this.characteristic.startNotifications();

      this._setStatus('connected', { name: this.device.name });
      this._log('Hub connecté.', 'success');

      // Le hub annonce spontanément ses ports ; on lui demande en plus son identité.
      this._enqueue(encodeHubProperty(HubProperty.ADVERTISING_NAME, HubPropertyOperation.REQUEST_UPDATE));
      this._enqueue(encodeHubProperty(HubProperty.FW_VERSION, HubPropertyOperation.REQUEST_UPDATE));
      this._enqueue(encodeHubProperty(HubProperty.BATTERY_VOLTAGE, HubPropertyOperation.ENABLE_UPDATES));
      this._enqueue(encodeHubProperty(HubProperty.BUTTON, HubPropertyOperation.ENABLE_UPDATES));
      // La LED doit être basculée en mode RGB (mode 1) avant d'accepter une couleur.
      this._enqueue(encodePortInputFormat(Port.HUB_LED, 0x01, false));
      this.setLed(0, 40, 60);
    } catch (error) {
      this._setStatus('disconnected');
      this.device = null;
      this.server = null;
      this.characteristic = null;
      throw error;
    }
  }

  async disconnect() {
    if (!this.device) return;
    try {
      if (this.connected) await this.stopMotor();
    } catch { /* le hub est peut-être déjà parti */ }
    try {
      this.device.gatt?.disconnect();
    } catch { /* idem */ }
  }

  _onDisconnected() {
    this._log('Hub déconnecté.', 'warn');
    this.characteristic = null;
    this.server = null;
    this.ports.clear();
    this.motorPort = null;
    this.sensorPort = null;
    this.currentPower = 0;
    this._cmdQueue.length = 0;
    this._motorPending = null;
    this._setStatus('disconnected');
    this._emit('device', { ports: [] });
  }

  /* ---------------------------------------------------------------- */
  /* Réception                                                        */
  /* ---------------------------------------------------------------- */

  _onNotification(dataView) {
    const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
    for (const message of splitMessages(bytes)) this._handleMessage(message);
  }

  _handleMessage(msg) {
    switch (msg[2]) {
      case MessageType.HUB_ATTACHED_IO:
        this._handleAttachedIo(msg);
        break;
      case MessageType.PORT_VALUE_SINGLE:
        this._handlePortValue(msg);
        break;
      case MessageType.HUB_PROPERTIES:
        this._handleHubProperty(msg);
        break;
      case MessageType.GENERIC_ERROR:
        this._log(`Le hub a refusé une commande (code 0x${msg[4]?.toString(16)}).`, 'warn');
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
      this._emit('device', { ports: this._portList() });
      return;
    }

    const type = msg[5] | (msg[6] << 8);
    this.ports.set(port, { type, label: describeDevice(type) });

    // Seuls les ports physiques A et B nous intéressent pour le piano.
    if ((port === Port.A || port === Port.B) && MOTOR_TYPES.has(type) && this.motorPort === null) {
      this.motorPort = port;
      this.motorType = type;
      this._log(`Moteur détecté sur le port ${port === Port.A ? 'A' : 'B'} (${describeDevice(type)}).`, 'success');
    }
    if ((port === Port.A || port === Port.B) && SENSOR_TYPES.has(type) && this.sensorPort === null) {
      this.sensorPort = port;
      this.sensorType = type;
      this._log(`Capteur détecté sur le port ${port === Port.A ? 'A' : 'B'} (${describeDevice(type)}).`, 'success');
      this.subscribeSensor();
    }
    this._emit('device', { ports: this._portList() });
  }

  _portList() {
    return [...this.ports.entries()].map(([port, info]) => ({ port, ...info }));
  }

  _handlePortValue(msg) {
    if (msg[3] !== this.sensorPort) return;
    // Mode 0 des capteurs de distance : un octet, 0 (très près) à 10 (rien devant).
    const raw = msg[4];
    if (raw === undefined) return;
    const value = msg[5] === 1 ? raw + 255 : raw;
    this.lastSensorValue = value;
    this._emit('sensor', { value, raw });
  }

  _handleHubProperty(msg) {
    const property = msg[3];
    if (msg[4] !== 0x06) return; // 0x06 = « update »
    if (property === HubProperty.ADVERTISING_NAME) {
      this.hubName = new TextDecoder().decode(msg.subarray(5));
      this._emit('status', { status: this.status, name: this.hubName });
    } else if (property === HubProperty.BATTERY_VOLTAGE) {
      this.batteryLevel = msg[5];
      this._emit('battery', { level: msg[5] });
    } else if (property === HubProperty.FW_VERSION) {
      const raw = msg[5] | (msg[6] << 8) | (msg[7] << 16) | (msg[8] << 24);
      const hex = (raw >>> 0).toString(16).padStart(8, '0');
      this.firmware = `${hex[0]}.${hex[1]}.${hex.slice(2, 4)}.${hex.slice(4)}`;
      this._emit('status', { status: this.status, firmware: this.firmware });
    } else if (property === HubProperty.BUTTON) {
      this._emit('button', { pressed: msg[5] === 1 });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Émission                                                         */
  /* ---------------------------------------------------------------- */

  _enqueue(message) {
    if (!this.characteristic) return;
    this._cmdQueue.push(message);
    this._pump();
  }

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

  subscribeSensor(mode = 0x00) {
    if (this.sensorPort === null) return;
    this._enqueue(encodePortInputFormat(this.sensorPort, mode, true, 1));
  }

  setLed(r, g, b) {
    this._enqueue(encodeHubLedRgb(r, g, b));
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
    if (char.writeValueWithoutResponse) await char.writeValueWithoutResponse(message);
    else await char.writeValue(message);
  }
}
