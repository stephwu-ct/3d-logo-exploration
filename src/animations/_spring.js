// Shared spring integrator — normalized progress 0→1.
// Returns true when settled.
export const SPRING = { stiffness: 50, damping: 12, mass: 1 };

export function stepSpring(s, dt) {
  const { stiffness, damping, mass } = SPRING;
  const error = s.progress - 1;
  const force = -stiffness * error - damping * s.vel;
  s.vel      += (force / mass) * dt;
  s.progress += s.vel * dt;
  if (Math.abs(error) < 0.0003 && Math.abs(s.vel) < 0.0003) {
    s.progress = 1; s.vel = 0; return true;
  }
  return false;
}
