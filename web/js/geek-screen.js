/**
 * Second écran : la télémétrie seule, en plein écran, dans un onglet à part.
 *
 * Cette page ne mesure rien elle-même. Tout vit dans la fenêtre du jukebox —
 * le contexte audio, le lecteur, la connexion Bluetooth — et il n'y en a qu'un
 * exemplaire possible : un `AudioContext` ne se partage pas entre fenêtres, et
 * un hub BLE n'accepte qu'une connexion GATT.
 *
 * La fenêtre d'origine construit donc le panneau *dans ce document*, ce que les
 * navigateurs autorisent entre fenêtres de même origine. Ici on se contente de :
 *   • réclamer ce panneau à l'ouvreur ;
 *   • le rafraîchir au rythme de cet écran-ci, qui peut différer de l'autre ;
 *   • suivre son thème ;
 *   • dire clairement ce qui se passe quand le jukebox n'est plus là.
 */

const orphan = document.getElementById('orphan');

/** Message plein cadre, quand il n'y a rien à afficher. */
function explain(html) {
  orphan.innerHTML = html;
  orphan.hidden = false;
}

const opener = window.opener;

if (!opener || opener.closed) {
  explain(
    'Cette page est le second écran du jukebox.<br />' +
      'Ouvre-la depuis la fenêtre principale : <strong>Réglages ⚙︎ → Démonstration → Second écran</strong>.'
  );
} else {
  start();
}

function start() {
  const attach = opener.jukebox?.attachScreen;
  if (typeof attach !== 'function') {
    explain('La fenêtre du jukebox n’a pas fini de démarrer. Ferme cet onglet et rouvre le second écran.');
    return;
  }

  const panel = attach(document);
  if (!panel) {
    explain('Le jukebox a refusé d’ouvrir un second panneau. Un autre est peut-être déjà affiché.');
    return;
  }

  // Deux boucles animent le panneau : celle du jukebox et celle-ci. Un
  // navigateur gèle `requestAnimationFrame` dans une fenêtre masquée, et sur
  // deux moniteurs c'est tantôt l'une, tantôt l'autre qui passe derrière. Le
  // panneau se limite lui-même en cadence, les deux ne se cumulent donc pas.
  let running = true;
  const frame = () => {
    if (!running) return;
    if (opener.closed) {
      running = false;
      panel.destroy();
      explain('La fenêtre du jukebox a été fermée. Cette page n’a plus rien à afficher.');
      return;
    }
    panel.update();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Dernier filet : une fenêtre entièrement masquée ne reçoit plus d'images du
  // tout. Ce minuteur ne sert qu'à constater le départ du jukebox.
  const watchdog = setInterval(() => {
    if (!opener.closed) return;
    clearInterval(watchdog);
    running = false;
    panel.destroy();
    explain('La fenêtre du jukebox a été fermée. Cette page n’a plus rien à afficher.');
  }, 1000);

  // Le thème se change dans la fenêtre du jukebox : on le recopie ici.
  const syncTheme = () => {
    const theme = opener.document.documentElement.dataset.theme;
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  };
  syncTheme();
  new MutationObserver(syncTheme).observe(opener.document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });

  // Fermer cet onglet doit relâcher proprement le panneau côté jukebox.
  window.addEventListener('pagehide', () => {
    running = false;
    panel.destroy();
  });
}
