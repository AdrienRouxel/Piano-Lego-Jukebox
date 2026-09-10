// Read-only local bridge. The 3D view never creates a second motor driver.
const listeners = new Set();
let latest = { playing: false, title: '', connected: false, motorEnabled: true, power: 0, angle: 0, amplitude: 0, time: 0 };
let lastPublication = -Infinity;
export function publishPianoState(state, now) {
  const changed = state.playing !== latest.playing || state.connected !== latest.connected || state.motorEnabled !== latest.motorEnabled || state.title !== latest.title || (state.power === 0) !== (latest.power === 0);
  latest = state;
  if (!changed && now - lastPublication < 40) return;
  lastPublication = now;
  for (const listener of listeners) listener(latest);
}
export function subscribePianoState(listener) {
  listeners.add(listener); listener(latest);
  return () => listeners.delete(listener);
}
export function getPianoState() { return latest; }
