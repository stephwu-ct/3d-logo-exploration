// Animation 7 — Edge pulse: sine wave on linewidth for 3 full cycles.
// Runs as a looping idle breath — slow and rhythmic.
const CYCLES = 3;
const FREQ   = 0.6; // Hz — one full pulse every ~1.7s
const AMP    = 0.6; // ±60% of base weight

const _state = { elapsed: 0, mats: [], baseWeights: [] };

export default {
  name: 'edgePulse',
  active: false,

  start({ artworkMaterials, PARAMS, scaledLinewidth }) {
    _state.mats        = [...artworkMaterials];
    _state.baseWeights = artworkMaterials.map(() => scaledLinewidth(PARAMS.edgeWeight));
    _state.elapsed     = 0;
    this.active = true;
  },

  step(_ctx, dt) {
    if (!this.active) return;
    _state.elapsed += dt;
    const scale = 1 + AMP * Math.sin(_state.elapsed * FREQ * Math.PI * 2);
    _state.mats.forEach((mat, i) => { if (mat) mat.linewidth = _state.baseWeights[i] * scale; });
    if (_state.elapsed >= CYCLES / FREQ) {
      this._restore();
      this.active = false;
    }
  },

  cancel() {
    this._restore();
    this.active = false;
  },

  _restore() {
    _state.mats.forEach((mat, i) => { if (mat) mat.linewidth = _state.baseWeights[i]; });
  },
};
