// Animation 6 — Draw in: reveal edge segments in counter-clockwise order,
// ending at the back faces.
//
// Sort key: (midZ - midX) descending in model space.
// At the default Y=45° pose, world depth = (z - x) / √2, so this key
// ranks front-left edges first and back-right edges last — a counter-
// clockwise sweep from the viewer's perspective ending at the back.
//
// Segments are interleaved across all visible artwork lines, so the
// sweep crosses face boundaries smoothly.

const RATE       = 50; // segments per second
const DEGENERATE = new Float32Array([0, 0, 0, 0, 0, 0]); // zero-length, invisible

let _state = null;

export default {
  name: 'drawIn',
  active: false,

  start({ artworkLines }) {
    const lineData = artworkLines
      .filter(l => l.visible && !l.userData.isCrossbarStroke)
      .filter(l => l.geometry?.attributes?.instanceStart)
      .map(line => {
        // Prefer originalPositions stored at build time — immune to any prior
        // degenerate state left by a cancelled or interrupted animation run.
        if (line.userData.originalPositions) {
          const segs = line.userData.originalPositions;
          return { line, segs, n: segs.length / 6 };
        }
        const attr = line.geometry.attributes.instanceStart;
        const segs = attr.data.array.slice(0, attr.count * 6);
        return { line, segs, n: attr.count };
      });

    if (!lineData.length) return;

    // Build a flat sorted list of every segment across all lines.
    const order = [];
    lineData.forEach(({ segs, n }, li) => {
      for (let i = 0; i < n; i++) {
        const midX = (segs[i * 6 + 0] + segs[i * 6 + 3]) / 2;
        const midZ = (segs[i * 6 + 2] + segs[i * 6 + 5]) / 2;
        order.push({ li, i, key: midZ - midX });
      }
    });
    // Descending: front-left (high key) → back-right (low key)
    order.sort((a, b) => b.key - a.key);

    // Hide all lines with a degenerate segment
    lineData.forEach(({ line }) => line.geometry.setPositions(DEGENERATE));

    _state = { lineData, order, elapsed: 0 };
    this.active = true;
  },

  step(_ctx, dt) {
    if (!this.active || !_state) return;
    _state.elapsed += dt;

    const revealed = Math.min(_state.order.length, Math.floor(_state.elapsed * RATE));

    // Collect which segment indices are revealed per line
    const perLine = _state.lineData.map(() => []);
    for (let r = 0; r < revealed; r++) {
      const { li, i } = _state.order[r];
      perLine[li].push(i);
    }

    // Rebuild each line's geometry with only its revealed segments
    _state.lineData.forEach(({ line, segs }, li) => {
      const idxs = perLine[li];
      if (idxs.length === 0) {
        line.geometry.setPositions(DEGENERATE);
      } else {
        const buf = new Float32Array(idxs.length * 6);
        idxs.forEach((si, bi) => buf.set(segs.subarray(si * 6, si * 6 + 6), bi * 6));
        line.geometry.setPositions(buf);
      }
    });

    if (revealed >= _state.order.length) {
      this._restore();
      this.active = false;
    }
  },

  cancel() {
    this._restore();
    this.active = false;
  },

  _restore() {
    if (!_state) return;
    _state.lineData.forEach(({ line, segs }) => line.geometry.setPositions(segs));
    _state = null;
  },
};
