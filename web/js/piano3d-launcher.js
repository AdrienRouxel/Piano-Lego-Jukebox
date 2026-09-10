import { subscribePianoState, getPianoState } from './piano3d-state.js';

const trigger = document.getElementById('btn-piano3d');
const choice = document.getElementById('model-view');
const keyboard = document.getElementById('keyboard-lego');
const home = document.getElementById('piano3d-home');
const note = document.getElementById('piano3d-home-note');
const preferenceKey = 'lego-piano-model-view';
const dialog = document.createElement('dialog');
dialog.className = 'piano3d-dialog';
dialog.setAttribute('aria-label', 'Explorer le LEGO Grand Piano en 3D');
document.body.append(dialog);

// Only one scene is mounted at a time. Removing its iframe releases WebGL.
let frame = null, unsubscribe = null;
function unmount() {
  unsubscribe?.();
  unsubscribe = null;
  frame?.remove();
  frame = null;
}
function mount(container, compact) {
  unmount();
  frame = document.createElement('iframe');
  frame.title = compact ? 'Piano LEGO en 3D, animé pendant la lecture' : 'Vue éclatée interactive du LEGO Grand Piano 21323';
  frame.src = compact ? 'piano3d.html?view=home' : 'piano3d.html';
  container.append(frame);
  unsubscribe = subscribePianoState(state => frame?.contentWindow?.postMessage({ type: 'piano3d:state', state }, location.origin));
  if (!compact) frame.addEventListener('load', () => frame?.contentWindow?.focus(), { once: true });
}
function renderHome() {
  const show3d = choice.value === '3d';
  keyboard.hidden = show3d;
  home.hidden = !show3d;
  note.hidden = !show3d;
  if (dialog.open) return;
  if (show3d) mount(home, true);
  else unmount();
}
try { choice.value = localStorage.getItem(preferenceKey) === '3d' ? '3d' : 'keys'; } catch {}
choice.addEventListener('change', () => {
  try { localStorage.setItem(preferenceKey, choice.value); } catch {}
  renderHome();
});
renderHome();

trigger.addEventListener('click', () => {
  if (dialog.open) return;
  dialog.showModal();
  mount(dialog, false);
});
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== frame?.contentWindow) return;
  if (event.data === 'piano3d:close') {
    if (dialog.open) dialog.close();
    else choice.focus();
  }
  if (event.data === 'piano3d:ready') event.source.postMessage({ type: 'piano3d:state', state: getPianoState() }, location.origin);
});
dialog.addEventListener('close', () => {
  unmount();
  renderHome();
  trigger.focus();
});
document.addEventListener('keydown', event => {
  if (!dialog.open) return;
  event.stopImmediatePropagation();
  if (event.key === 'Escape') { event.preventDefault(); dialog.close(); }
}, true);
