/**
 * Câblage des panneaux « matériel » du tiroir de réglages : informations du
 * hub, essais moteur, capteur, alimentation et console LWP3.
 *
 * Tout est regroupé ici plutôt que dans `main.js` pour garder ce dernier centré
 * sur le jukebox lui-même. Un seul point d'entrée : `wireHubTools()`.
 */

import { SensorMode, AlertType, ALERT_LABELS, parseHex, toHex } from './lego/protocol.js';

const el = (id) => document.getElementById(id);

/** Réglages ajoutés par ce module au dictionnaire partagé. */
export const HUB_TOOL_SETTINGS = {
  autoReconnect: true,
  brakeOnStop: true,
  rampStart: true,
};

/**
 * @param {object} options
 * @param {import('./lego/hub.js').PianoHub} options.hub
 * @param {(message:string, kind?:string, duration?:number)=>void} options.toast
 * @param {object} options.settings dictionnaire de réglages partagé, persisté par l'appelant
 * @param {()=>void} options.saveSettings
 * @param {()=>void} [options.onManualControl] appelé avant toute commande manuelle
 *   du moteur, pour mettre la lecture en pause
 */
export function wireHubTools({ hub, toast, settings, saveSettings, onManualControl = () => {} }) {
  Object.assign(settings, { ...HUB_TOOL_SETTINGS, ...settings });
  hub.autoReconnect = Boolean(settings.autoReconnect);

  wireHubPanel({ hub, toast, settings, saveSettings });
  wireMotorTests({ hub, toast, settings, onManualControl });
  wireSensorPanel({ hub, toast });
  wirePowerPanel({ hub });
  wireConsole({ hub, toast });
}

/* ------------------------------------------------------------------ */
/* Panneau « Le hub »                                                  */
/* ------------------------------------------------------------------ */

const INFO_ROWS = [
  ['name', 'Nom'],
  ['firmware', 'Micrologiciel'],
  ['hardware', 'Version matérielle'],
  ['radioFirmware', 'Micrologiciel radio'],
  ['manufacturer', 'Fabricant'],
  ['protocol', 'Protocole LWP'],
  ['systemType', 'Type de système'],
  ['macAddress', 'Adresse MAC'],
  ['batteryType', 'Piles'],
  ['battery', 'Charge', (v) => `${v} %`],
  ['rssi', 'Signal', (v) => `${v} dBm`],
];

function wireHubPanel({ hub, toast, settings, saveSettings }) {
  const grid = el('hub-info');
  const alertBox = el('hub-alerts');
  const nameInput = el('hub-name');

  const renderInfo = () => {
    grid.textContent = '';
    let shown = 0;
    for (const [key, label, format] of INFO_ROWS) {
      const value = hub.info[key];
      if (value === null || value === undefined) continue;
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = format ? format(value) : String(value);
      grid.append(dt, dd);
      shown += 1;
    }
    if (!shown) {
      const dd = document.createElement('dd');
      dd.textContent = 'Connecte le piano pour lire ses informations.';
      dd.style.gridColumn = '1 / -1';
      grid.append(dd);
    }
  };

  const renderAlerts = () => {
    alertBox.textContent = '';
    for (const type of Object.values(AlertType)) {
      const chip = document.createElement('span');
      chip.className = 'alert-chip';
      chip.dataset.active = hub.alerts[type] ? '1' : '0';
      chip.textContent = ALERT_LABELS[type];
      alertBox.append(chip);
    }
  };

  renderInfo();
  renderAlerts();

  hub.addEventListener('info', () => {
    renderInfo();
    if (hub.info.name && document.activeElement !== nameInput) nameInput.value = hub.info.name;
  });
  hub.addEventListener('battery', renderInfo);
  hub.addEventListener('power', renderInfo);
  hub.addEventListener('status', renderInfo);
  hub.addEventListener('alert', (event) => {
    renderAlerts();
    if (event.detail.active) toast(`Alerte du hub : ${event.detail.label.toLowerCase()}.`, 'error', 7000);
  });

  el('btn-rename').addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) {
      toast('Donne un nom au hub avant de valider.', 'error');
      return;
    }
    if (!hub.connected) {
      toast('Le piano doit être connecté pour être renommé.', 'error');
      return;
    }
    try {
      hub.setHubName(name);
      toast(`Hub renommé « ${name.slice(0, 14)} ».`, 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  el('btn-refresh-info').addEventListener('click', () => {
    if (!hub.connected) {
      toast('Le piano n’est pas connecté.', 'error');
      return;
    }
    hub.requestHubInfo();
  });

  const autoReconnect = el('set-autoReconnect');
  autoReconnect.checked = Boolean(settings.autoReconnect);
  autoReconnect.addEventListener('change', () => {
    settings.autoReconnect = autoReconnect.checked;
    hub.autoReconnect = autoReconnect.checked;
    saveSettings();
  });

  el('btn-disconnect').addEventListener('click', () => hub.disconnect());

  el('btn-shutdown').addEventListener('click', () => {
    if (!hub.connected) {
      toast('Le piano n’est pas connecté.', 'error');
      return;
    }
    // Action irréversible depuis la page : il faudra rappuyer sur le bouton vert.
    if (!confirm('Éteindre le hub du piano ?\n\nLa liaison sera coupée et il faudra rappuyer sur le bouton vert pour la rétablir.')) return;
    hub.shutdown();
    toast('Hub éteint.', 'success');
  });
}

/* ------------------------------------------------------------------ */
/* Panneau « Essai du moteur »                                         */
/* ------------------------------------------------------------------ */

function wireMotorTests({ hub, toast, settings, onManualControl }) {
  const slider = el('test-power');
  const output = el('out-test');
  const feedback = el('test-feedback');

  const say = (text) => {
    feedback.textContent = text;
  };

  const requireHub = () => {
    if (hub.connected && hub.motorPort !== null) return true;
    toast('Le piano doit être connecté, moteur détecté.', 'error');
    return false;
  };

  slider.addEventListener('input', () => {
    const value = Number(slider.value);
    output.textContent = String(value);
    if (!hub.connected) return;
    onManualControl();
    hub.setMotorPower(value);
  });

  el('btn-test-stop').addEventListener('click', () => {
    slider.value = '0';
    output.textContent = '0';
    hub.stopMotor();
    say('Moteur en roue libre.');
  });

  el('btn-test-brake').addEventListener('click', async () => {
    if (!requireHub()) return;
    onManualControl();
    slider.value = '0';
    output.textContent = '0';
    say('Freinage…');
    const outcome = await hub.brake();
    say(`Freinage : ${describeOutcome(outcome)}.`);
  });

  el('btn-test-ramp').addEventListener('click', async () => {
    if (!requireHub()) return;
    onManualControl();
    const target = settings.maxPower ?? 90;
    say(`Rampe 0 → ${target} % sur 2 s…`);
    await hub.rampPower(0, target, 2000);
    slider.value = String(target);
    output.textContent = String(target);
    say(`Rampe terminée à ${target} %. Les touches doivent monter en régime sans à-coup.`);
  });

  el('btn-test-sequence').addEventListener('click', async () => {
    if (!requireHub()) return;
    onManualControl();
    const min = settings.minPower ?? 40;
    const max = settings.maxPower ?? 90;
    say('Séquence d’essai en cours…');
    // Départ doux, palier lent, silence, palier rapide, arrêt franc :
    // de quoi juger d'un coup d'œil si les réglages tiennent la route.
    const outcome = await hub.runSequence([
      { power: min, duration: 1500, ramp: 500 },
      { power: 0, duration: 700 },
      { power: max, duration: 1800, ramp: 400 },
      { power: Math.round((min + max) / 2), duration: 1200 },
    ]);
    slider.value = '0';
    output.textContent = '0';
    say(outcome === 'completed' ? 'Séquence terminée.' : 'Séquence interrompue.');
  });
}

function describeOutcome(outcome) {
  return (
    {
      completed: 'confirmé par le hub',
      discarded: 'annulé par le hub',
      timeout: 'sans accusé de réception',
      offline: 'hub non connecté',
    }[outcome] ?? outcome
  );
}

/* ------------------------------------------------------------------ */
/* Panneau « Capteur »                                                 */
/* ------------------------------------------------------------------ */

function wireSensorPanel({ hub, toast }) {
  const modeSelect = el('sensor-mode');
  const fill = el('sensor-fill');
  const value = el('sensor-value');

  modeSelect.addEventListener('change', () => {
    if (!hub.connected || hub.sensorPort === null) {
      toast('Aucun capteur détecté.', 'error');
      return;
    }
    hub.subscribeSensor(Number(modeSelect.value));
  });

  hub.addEventListener('sensor', (event) => {
    const detail = event.detail;
    if (detail.combined) {
      value.textContent = toHex(detail.raw);
      return;
    }
    if (detail.mode === SensorMode.COUNT) {
      value.textContent = String(detail.count);
      // Le compteur n'a pas de maximum : on remplit la barre par cycles de 100.
      fill.style.setProperty('--fill', ((detail.count % 100) / 100).toFixed(4));
      return;
    }
    value.textContent = String(detail.value);
    // 0 = touche enfoncée (drapeau collé au capteur), 10 = rien devant.
    fill.style.setProperty('--fill', (Math.max(0, 1 - detail.value / 10)).toFixed(4));
  });

  el('btn-sensor-combined').addEventListener('click', () => {
    if (!hub.connected || hub.sensorPort === null) {
      toast('Aucun capteur détecté.', 'error');
      return;
    }
    hub.setupCombinedSensorMode();
    toast('Mode combiné demandé — regarde la console pour la réponse du hub.', 'info', 6000);
  });

  el('btn-manual-attach').addEventListener('click', () => {
    if (!hub.connected) {
      toast('Le piano n’est pas connecté.', 'error');
      return;
    }
    hub.manuallyAttachDevice(Number(el('manual-port').value), Number(el('manual-type').value));
    toast('Appareil déclaré. Si le hub ne le confirme pas, la fiche est mal enfoncée.', 'info', 6000);
  });
}

/* ------------------------------------------------------------------ */
/* Panneau « Alimentation »                                            */
/* ------------------------------------------------------------------ */

function wirePowerPanel({ hub }) {
  const voltage = el('power-voltage');
  const current = el('power-current');

  hub.addEventListener('power', (event) => {
    const { voltage: v, current: c } = event.detail;
    if (typeof v === 'number') voltage.textContent = `${v.toFixed(2)} V`;
    if (typeof c === 'number') current.textContent = `${Math.round(c)} mA`;
  });

  hub.addEventListener('status', (event) => {
    if (event.detail.status !== 'disconnected') return;
    voltage.textContent = '—';
    current.textContent = '—';
  });
}

/* ------------------------------------------------------------------ */
/* Console LWP3                                                        */
/* ------------------------------------------------------------------ */

/** Au-delà, la console devient illisible et coûteuse à rendre. */
const CONSOLE_MAX_LINES = 300;

function wireConsole({ hub, toast }) {
  const group = el('console-group');
  const view = el('console');
  const hideMotor = el('console-hide-motor');
  const input = el('console-input');

  /** Une trame de puissance moteur : port A ou B, sous-commande 0x51. */
  const isMotorStream = (entry) => {
    const bytes = entry.hex.split(' ').map((h) => parseInt(h, 16));
    return bytes[2] === 0x81 && (bytes[3] === 0x00 || bytes[3] === 0x01) && bytes[5] === 0x51;
  };

  const append = (entry) => {
    if (hideMotor.checked && isMotorStream(entry)) return;
    const line = document.createElement('div');
    line.className = 'console-line';
    line.dataset.dir = entry.direction;

    const dir = document.createElement('span');
    dir.className = 'dir';
    dir.textContent = entry.direction === 'tx' ? '→' : '←';

    const body = document.createElement('span');
    body.className = 'body';
    const hex = document.createElement('span');
    hex.className = 'hex';
    hex.textContent = entry.hex;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = ` ${entry.name} `;
    const summary = document.createElement('span');
    summary.className = 'summary';
    summary.textContent = entry.summary;
    body.append(hex, document.createElement('br'), name, summary);

    line.append(dir, body);
    view.append(line);
    while (view.childElementCount > CONSOLE_MAX_LINES) view.firstElementChild.remove();
    view.scrollTop = view.scrollHeight;
  };

  const redraw = () => {
    view.textContent = '';
    if (!hub.rawLog.length) {
      const empty = document.createElement('div');
      empty.className = 'console-empty';
      empty.textContent = 'Aucune trame pour l’instant — connecte le piano.';
      view.append(empty);
      return;
    }
    for (const entry of hub.rawLog.slice(-CONSOLE_MAX_LINES)) append(entry);
  };

  // On ne peuple le DOM que lorsque la console est dépliée : à 25 trames par
  // seconde, la rendre en permanence coûterait cher pour rien.
  group.addEventListener('toggle', () => {
    if (group.open) redraw();
  });
  hideMotor.addEventListener('change', () => {
    if (group.open) redraw();
  });
  hub.addEventListener('raw', (event) => {
    if (group.open) append(event.detail);
  });

  el('btn-console-send').addEventListener('click', () => {
    const text = input.value.trim();
    if (!text) return;
    try {
      const bytes = parseHex(text);
      hub.sendRaw(bytes);
      input.value = '';
    } catch (error) {
      toast(error.message, 'error', 6000);
    }
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') el('btn-console-send').click();
  });

  el('btn-probe-ports').addEventListener('click', () => {
    if (!hub.connected) {
      toast('Le piano n’est pas connecté.', 'error');
      return;
    }
    for (const { port } of hub.portList()) hub.requestPortInformation(port);
    toast('Interrogation des ports envoyée.', 'success');
  });

  el('btn-probe-modes').addEventListener('click', () => {
    if (!hub.connected) {
      toast('Le piano n’est pas connecté.', 'error');
      return;
    }
    const port = hub.sensorPort ?? hub.motorPort;
    if (port === null || port === undefined) {
      toast('Aucun appareil détecté sur les ports A ou B.', 'error');
      return;
    }
    hub.exploreModes(port);
    toast('Exploration des modes lancée — le détail arrive dans la console.', 'success', 6000);
  });

  el('btn-console-clear').addEventListener('click', () => {
    hub.rawLog.length = 0;
    redraw();
  });

  redraw();
}
