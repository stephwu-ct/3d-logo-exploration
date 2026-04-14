// Animation 4 — Scale entrance: spring from 0 → 1 on animGroup.
// Reads as an arrival / pop-in with spring overshoot.
import { SPRING, stepSpring } from './_spring.js';

const s = { progress: 0, vel: 0 };

export default {
  name: 'scaleEntrance',
  active: false,

  start({ animGroup }) {
    if (!animGroup) return;
    animGroup.scale.setScalar(0.001);
    s.progress = 0;
    s.vel      = 0;
    this.active = true;
  },

  step({ animGroup }, dt) {
    if (!this.active || !animGroup) return;
    const done = stepSpring(s, dt);
    animGroup.scale.setScalar(Math.max(0.001, s.progress));
    if (done) { animGroup.scale.setScalar(1); this.active = false; }
  },

  cancel({ animGroup }) {
    if (animGroup) animGroup.scale.setScalar(1);
    this.active = false;
  },
};
