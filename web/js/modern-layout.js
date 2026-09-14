/** Catalogue contextuel : conserve le DOM et ses interactions dans les autres thèmes. */
export function initModernLayout() {
  const library = document.getElementById('library');
  const open = document.getElementById('btn-library');
  const choose = document.getElementById('btn-waterfall-library');
  const close = document.getElementById('btn-close-library');
  const modern = () => document.documentElement.dataset.theme === 'moderne';
  function hide() {
    if (library.matches(':popover-open')) library.hidePopover();
  }
  function sync() {
    hide();
    if (modern()) {
      library.setAttribute('popover', 'auto');
      for (const button of [open, choose]) button.setAttribute('popovertarget', 'library');
      close.setAttribute('popovertarget', 'library');
      close.setAttribute('popovertargetaction', 'hide');
    } else {
      library.removeAttribute('popover');
      for (const button of [open, choose, close]) button.removeAttribute('popovertarget');
    }
  }
  library.addEventListener('toggle', event => {
    open.setAttribute('aria-expanded', String(event.newState === 'open'));
    if (event.newState === 'open') document.getElementById('search').focus();
  });
  library.addEventListener('click', event => {
    if (modern() && event.target.closest('.track')) {
      hide();
      document.getElementById('btn-play').focus();
    }
  });
  document.addEventListener('jukebox:themechange', sync);
  // Un catalogue ouvert ne masque jamais la partition ou un panneau de réglages.
  for (const id of ['btn-settings', 'btn-guide', 'btn-score', 'btn-stand', 'btn-piano3d', 'btn-convert']) {
    document.getElementById(id).addEventListener('click', hide);
  }
  sync();
}
