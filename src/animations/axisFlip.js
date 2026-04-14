// Animation 3 — Tumble 360° on X axis (spring physics).
// Reads as a forward barrel-roll / coin-flip vs the Y-axis turntable spin.
import { SPRING, stepSpring } from './_spring.js';

const s = { progress: 0, vel: 0, startX: 0, targetX: 0 };

export default {
  name: 'axisFlip',
  active: false,

  start({ animGroup }) {
    if (!animGroup) return;
    s.startX   = animGroup.rotation.x;
    s.targetX  = animGroup.rotation.x + Math.PI * 2;
    s.progress = 0;
    s.vel      = 0;
    this.active = true;
  },

  step({ animGroup }, dt) {
    if (!this.active || !animGroup) return;
    const done = stepSpring(s, dt);
    animGroup.rotation.x = s.startX + (s.targetX - s.startX) * s.progress;
    if (done) { animGroup.rotation.x = s.startX; this.active = false; } // 2π ≡ 0
  },

  cancel({ animGroup }) {
    if (animGroup) animGroup.rotation.x = s.startX;
    this.active = false;
  },
};
