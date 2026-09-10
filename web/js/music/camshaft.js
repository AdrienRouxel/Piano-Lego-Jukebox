/** Mechanical estimate shared by the 2D keyboard and the 3D model.
 * The motor has no encoder: neither the speed nor cam phase is measured.
 */
export const CAMSHAFT_MAX_TURNS_PER_SECOND = .9;
export const CAM_PHASE_STEP = 2.399963;
export const LIFT_START = .55;
export const PRESS_START = .86;
export const camPhase = index => (index * CAM_PHASE_STEP) % (Math.PI * 2);
export function camLift(angle, amplitude, index) {
  const lift = Math.sin(angle + camPhase(index));
  return Math.max(0, (lift - LIFT_START) / (1 - LIFT_START)) * amplitude;
}

/** Extrapolate only between recent samples; never continue a lost live feed. */
export function motionFromSample(sample, elapsedMs, enabled) {
  if (!enabled) return { angle: 0, amplitude: 0 };
  if (!sample?.playing || elapsedMs > 300) return { angle: sample?.angle ?? 0, amplitude: 0 };
  const dt = Math.max(0, elapsedMs) / 1000;
  const angle = sample.angle + sample.power / 100 * CAMSHAFT_MAX_TURNS_PER_SECOND * Math.PI * 2 * dt;
  return { angle, amplitude: sample.amplitude };
}
