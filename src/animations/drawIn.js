// Animation 6 — Draw in: reveal edge segments one-by-one via setPositions().
// Uses a degenerate segment for "hidden" state to avoid touching .visible
// (which is managed by updateArtwork/updateFaceLayerOrders elsewhere).
const RATE       = 20; // segments per second
const DEGENERATE = new Float32Array([0, 0, 0, 0, 0, 0]); // zero-length, invisible

const _state = { chunks: [], elapsed: 0, totalSegs: 0 };

export default {
  name: 'drawIn',
  active: false,

  start({ artworkLines }) {
    _state.chunks = artworkLines
      .filter(l => !l.userData.isCrossbarStroke)
      .filter(l => l.geometry?.attributes?.instanceStart)
      .map(line => {
        const attr = line.geometry.attributes.instanceStart;
        const segs = attr.data.array.slice(0, attr.count * 6); // copy
        line.geometry.setPositions(DEGENERATE);
        return { line, segs, n: attr.count };
      });

    _state.totalSegs = _state.chunks.reduce((sum, c) => sum + c.n, 0);
    _state.elapsed   = 0;

    if (_state.totalSegs === 0) return;
    this.active = true;
  },

  step(_ctx, dt) {
    if (!this.active) return;
    _state.elapsed += dt;

    const revealed = Math.min(_state.totalSegs, Math.floor(_state.elapsed * RATE));
    let remaining  = revealed;

    _state.chunks.forEach(({ line, segs, n }) => {
      const show = Math.min(n, remaining);
      remaining  = Math.max(0, remaining - n);
      line.geometry.setPositions(show === 0 ? DEGENERATE : segs.slice(0, show * 6));
    });

    if (revealed >= _state.totalSegs) {
      this._restore();
      this.active = false;
    }
  },

  cancel() {
    this._restore();
    this.active = false;
  },

  _restore() {
    _state.chunks.forEach(({ line, segs }) => line.geometry.setPositions(segs));
    _state.chunks = [];
  },
};
