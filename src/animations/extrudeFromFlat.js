// Animation 5 — Extrude from flat: spring shapeD from 0 → target.
// Logo starts as a 2D outline then springs into full 3D depth.
// Calls rebuildShape() each frame — fine for this simple geometry.
import { SPRING, stepSpring } from './_spring.js';

const s = { progress: 0, vel: 0, targetD: 0 };

export default {
  name: 'extrudeFromFlat',
  active: false,

  start({ PARAMS, rebuildShape }) {
    s.targetD  = PARAMS.shapeD;
    s.progress = 0;
    s.vel      = 0;
    PARAMS.shapeD = 0.001;
    rebuildShape();
    this.active = true;
  },

  step({ PARAMS, rebuildShape }, dt) {
    if (!this.active) return;
    const done = stepSpring(s, dt);
    PARAMS.shapeD = 0.001 + (s.targetD - 0.001) * Math.max(0, s.progress);
    rebuildShape();
    if (done) {
      PARAMS.shapeD = s.targetD;
      rebuildShape();
      this.active = false;
    }
  },

  cancel({ PARAMS, rebuildShape }) {
    PARAMS.shapeD = s.targetD;
    rebuildShape();
    this.active = false;
  },
};
