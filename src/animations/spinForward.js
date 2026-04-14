// Animation 1 — Spin 360° forward on Y axis (spring physics).
import { SPRING, stepSpring } from './_spring.js';

const s = { progress: 0, vel: 0, startY: 0, targetY: 0 };

export default {
  name: 'spinForward',
  active: false,

  start({ animGroup }) {
    if (!animGroup) return;
    s.startY   = animGroup.rotation.y;
    s.targetY  = animGroup.rotation.y + Math.PI * 2;
    s.progress = 0;
    s.vel      = 0;
    this.active = true;
  },

  step({ animGroup }, dt) {
    if (!this.active || !animGroup) return;
    const done = stepSpring(s, dt);
    animGroup.rotation.y = s.startY + (s.targetY - s.startY) * s.progress;
    if (done) { animGroup.rotation.y = s.targetY; this.active = false; }
  },

  cancel({ animGroup }) {
    if (animGroup) animGroup.rotation.y = s.startY + (s.targetY - s.startY) * s.progress;
    this.active = false;
  },
};
