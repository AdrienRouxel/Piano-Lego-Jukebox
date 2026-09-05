/**
 * Côté jukebox de la « salle de commande » : la file d'attente que les
 * visiteurs remplissent depuis leur téléphone.
 *
 * Le partage passe toujours par le serveur, jamais en direct d'un appareil à
 * l'autre :
 *
 *   téléphone (5G) ──POST──► serveur ──SSE──► jukebox ──Bluetooth──► piano
 *
 * Rien ici ne touche au son ni au moteur. Ce module tient la file à jour,
 * publie ce que le jukebox est en train de jouer, relaie les applaudissements,
 * et fabrique le code QR qui mène à la télécommande.
 *
 * Deux jetons circulent, et il ne faut pas les confondre :
 *   • le **code du stand** voyage dans le code QR ; c'est ce qui autorise un
 *     téléphone à déposer une demande. Le serveur nous le donne pour affichage ;
 *   • le **jeton de pilotage** autorise à passer au morceau suivant ou à vider
 *     la file. Le jukebox le reçoit une fois dans son adresse (`?op=…`) et le
 *     garde ; quand le serveur tourne sur la machine du stand, la boucle locale
 *     suffit et le jeton n'est même pas nécessaire.
 */

import { qrSvg } from './qrcode.js';

/** Cadence de publication de la position de lecture, en millisecondes. */
const PUBLISH_INTERVAL = 2000;
const OPERATOR_KEY = 'lego-piano-jukebox/operator';

/**
 * Récupère le jeton de pilotage passé dans l'adresse, le range, et le retire
 * de la barre d'adresse — un jeton qui reste affiché finit par être recopié.
 */
function claimOperatorToken() {
  let token = null;
  try {
    token = localStorage.getItem(OPERATOR_KEY);
  } catch { /* navigation privée */ }

  const url = new URL(window.location.href);
  const given = url.searchParams.get('op');
  if (given) {
    token = given;
    try {
      localStorage.setItem(OPERATOR_KEY, token);
    } catch { /* tant pis : valable pour cette page seulement */ }
    url.searchParams.delete('op');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  return token;
}

export class Stand extends EventTarget {
  constructor() {
    super();
    /** Vrai quand le serveur sait donner une adresse joignable pour la télécommande. */
    this.available = false;
    /** Adresse de la télécommande, celle que porte le code QR. */
    this.remoteUrl = null;
    /** Code du stand, affiché en clair sous le code QR pour le dépannage. */
    this.code = null;
    /**
     * Mode local : l'ordinateur et le téléphone sur le même Wi-Fi. Le serveur
     * dit s'il est ouvert, sur quelle adresse, et s'il y a seulement un réseau.
     * @type {{enabled:boolean, pinned:boolean, address:string|null, port:number, supported:boolean}}
     */
    this.local = { enabled: false, pinned: false, address: null, port: 0, supported: false };
    /** Vrai si ce poste a le droit de piloter la file. */
    this.operator = false;
    /** @type {Array<{key:string, id:string, title:string, artist:string|null, name:string|null}>} */
    this.queue = [];
    /** Bilan du jour, tel que le serveur le compte. */
    this.played = 0;
    this.requested = 0;
    this.cheers = 0;

    this._token = claimOperatorToken();
    this._source = null;
    this._lastPublish = 0;
    this._nowSignature = '';
    this._queueSignature = '';
  }

  /** En-têtes qui prouvent au serveur que l'appel vient du poste du stand. */
  get controlHeaders() {
    return this._token ? { 'x-stand-operator': this._token } : {};
  }

  /** Idem, pour les routes qui parlent JSON. */
  get _controlHeaders() {
    return { 'content-type': 'application/json', ...this.controlHeaders };
  }

  /** Interroge le serveur et ouvre le flux d'événements. */
  async init() {
    await this.refresh();
    this._listen();
    this.dispatchEvent(new CustomEvent('ready', { detail: { available: this.available } }));
    return this.available;
  }

  /**
   * Relit l'identité du stand : adresse de la télécommande, code, droits.
   *
   * Ce n'est pas qu'une formalité de démarrage. Un serveur qui redémarre — et
   * sur un salon de plusieurs jours, il redémarre — peut repartir avec une
   * autre adresse ou d'autres droits. Sans cette relecture, le jukebox
   * continuerait d'afficher un code QR que le serveur ne reconnaît plus, et
   * les visiteurs scanneraient dans le vide.
   */
  async refresh() {
    try {
      const response = await fetch('/api/stand', { headers: this.controlHeaders });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const changed =
        data.remoteUrl !== this.remoteUrl || data.code !== this.code || Boolean(data.operator) !== this.operator;
      this._takeIdentity(data);
      this._absorb(data);
      if (changed) this.dispatchEvent(new CustomEvent('identity', { detail: { code: this.code } }));
      return true;
    } catch {
      // Serveur d'une version antérieure, ou coupé : le jukebox marche seul.
      this.available = false;
      return false;
    }
  }

  /** Range ce que le serveur dit de lui-même : adresse, code, droits, mode local. */
  _takeIdentity(data) {
    this.remoteUrl = data.remoteUrl ?? null;
    if (data.code !== undefined) this.code = data.code ?? null;
    if (data.operator !== undefined) this.operator = Boolean(data.operator);
    if (data.local) this.local = data.local;
    this.available = Boolean(this.remoteUrl);
  }

  /**
   * Ouvre ou referme le mode local : le serveur se met alors aussi à écouter
   * sur l'adresse Wi-Fi de la machine, et le code QR y mène.
   *
   * Le jukebox, lui, ne bouge pas de `localhost` — sa liaison Bluetooth tient.
   *
   * @param {boolean} enabled
   * @returns {Promise<{ok: boolean, error: string|null}>}
   */
  async setLocalMode(enabled) {
    try {
      const response = await fetch('/api/stand/local', {
        method: 'POST',
        headers: this._controlHeaders,
        body: JSON.stringify({ enabled: Boolean(enabled) }),
      });
      const data = await response.json().catch(() => ({}));
      if (data.local) this.local = data.local;
      if (!response.ok) return { ok: false, error: data.error ?? `Le serveur a refusé (HTTP ${response.status}).` };
      this._takeIdentity(data);
      this.dispatchEvent(new CustomEvent('identity', { detail: { code: this.code } }));
      return { ok: true, error: null };
    } catch {
      return { ok: false, error: 'Le serveur n’a pas répondu.' };
    }
  }

  /**
   * Donne au jukebox le jeton de pilotage, sans passer par l'adresse.
   * @returns {Promise<boolean>} vrai si le serveur l'a reconnu
   */
  async useOperatorToken(token) {
    const trimmed = String(token ?? '').trim();
    this._token = trimmed || null;
    try {
      if (trimmed) localStorage.setItem(OPERATOR_KEY, trimmed);
      else localStorage.removeItem(OPERATOR_KEY);
    } catch { /* navigation privée */ }
    await this.refresh();
    return this.operator;
  }

  _listen() {
    if (this._source || typeof EventSource !== 'function') return;
    this._source = new EventSource('/api/stand/events');
    // `EventSource` se rouvre tout seul après une coupure — ou après un
    // redémarrage du serveur. C'est le moment de revérifier qui l'on a en face.
    this._source.addEventListener('open', () => {
      if (this._opened) this.refresh();
      this._opened = true;
    });
    this._source.addEventListener('state', (event) => {
      try {
        this._absorb(JSON.parse(event.data));
      } catch { /* trame incomplète */ }
    });
    this._source.addEventListener('cheer', (event) => {
      let total = this.cheers + 1;
      try {
        total = JSON.parse(event.data).total ?? total;
      } catch { /* trame incomplète */ }
      this.cheers = total;
      this.dispatchEvent(new CustomEvent('cheer', { detail: { total } }));
    });
  }

  _absorb(state) {
    const queue = state.queue ?? [];
    this.played = state.played ?? this.played;
    this.requested = state.requested ?? this.requested;
    this.cheers = state.cheers ?? this.cheers;

    const signature = queue.map((entry) => entry.key).join(',');
    if (signature === this._queueSignature) return;
    this._queueSignature = signature;
    this.queue = queue;
    this.dispatchEvent(new CustomEvent('queue', { detail: { queue } }));
  }

  /**
   * Retire la première demande de la file et la renvoie.
   * @returns {Promise<{id:string, title:string, name:string|null}|null>}
   */
  async takeNext() {
    if (!this.queue.length) return null;
    try {
      const response = await fetch('/api/stand/queue/next', {
        method: 'POST',
        headers: this._controlHeaders,
        body: '{}',
      });
      if (!response.ok) return null;
      const data = await response.json();
      this._absorb(data);
      return data.entry ?? null;
    } catch {
      return null;
    }
  }

  /** Retire une demande, ou toute la file avec la clé `*`. */
  async drop(key) {
    try {
      const response = await fetch('/api/stand/queue/drop', {
        method: 'POST',
        headers: this._controlHeaders,
        body: JSON.stringify({ key }),
      });
      if (response.ok) this._absorb(await response.json());
    } catch { /* la file se resynchronisera au prochain événement */ }
  }

  /**
   * Publie ce que joue le jukebox, pour que les téléphones l'affichent.
   * Limité en cadence : la position n'a pas besoin d'être au dixième de seconde.
   */
  publish(now, { force = false } = {}) {
    if (!this.available && !this.operator) return;
    const stamp = performance.now();
    const signature = `${now?.id ?? ''}|${now?.state ?? ''}`;
    const changed = signature !== this._nowSignature;
    if (!force && !changed && stamp - this._lastPublish < PUBLISH_INTERVAL) return;
    this._lastPublish = stamp;
    this._nowSignature = signature;

    fetch('/api/stand/now', {
      method: 'POST',
      headers: this._controlHeaders,
      body: JSON.stringify({ now }),
      // La page peut se fermer pendant l'envoi : ce n'est pas une erreur.
      keepalive: true,
    }).catch(() => {});
  }

  /**
   * Dessine le code QR de la télécommande dans un conteneur.
   * @param {HTMLElement} container
   * @returns {boolean} faux s'il n'y a pas d'adresse à proposer
   */
  renderQr(container) {
    if (!this.remoteUrl) {
      container.textContent = '';
      return false;
    }
    container.innerHTML = qrSvg(this.remoteUrl, { label: `Télécommande du jukebox — ${this.remoteUrl}` });
    return true;
  }
}
