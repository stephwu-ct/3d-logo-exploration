# 6th Street Logo — Claude Context

## What this is

A standalone Three.js wireframe viewer for the 6th Street logo. Used by Matty for motion and animation exploration — not a production app. The goal is real-time visual experimentation: edge weight, color, rotation, pivot point, extrusion dimensions.

## Remotes

`origin` is configured with two push URLs — every `git push` goes to both repos simultaneously.

| Remote | URL | Purpose |
|--------|-----|---------|
| `origin` (fetch) | https://github.com/stephwu-ct/3d-logo-exploration | Steph Wu's repo — shared collaboration |
| `origin` (push) | https://github.com/stephwu-ct/3d-logo-exploration | ↑ pushed on every commit |
| `origin` (push) | https://github.com/mattywoodward-ct/3d-logo-exploration | Matty's private repo → Vercel |

Just use `git push` as normal — both repos stay in sync automatically.

## Stack

- Vue 3 `<script setup>` — single component app (`ThreeViewer.vue`)
- Three.js `^0.183` — orthographic camera, `LineSegments2` / `LineMaterial` for thick edges
- Tweakpane v4 — control panel
- Vite 8
- **Use `pnpm dev` to start the server** (not npm)

All logic lives in `src/components/ThreeViewer.vue`. There is no router, no state management, no other components.

## Key architecture decisions

### Thick edges: LineSegments2, not LineBasicMaterial
`LineBasicMaterial.linewidth` is a no-op in WebGL on most browsers (always 1px). The only way to get real thick lines in Three.js is `LineSegments2` + `LineMaterial` from `three/examples/jsm/lines/`. `LineMaterial.linewidth` is in **screen-space pixels** and requires `resolution` to be set and updated on resize.

### Linewidth normalization
`PARAMS.edgeWeight` is expressed in pixels-at-800px (`REFERENCE_H = 800`). On every render pass and on resize, actual linewidth = `PARAMS.edgeWeight * (mainH / REFERENCE_H)`. This keeps visual stroke weight proportional to the logo at any viewport size. The preview strip further multiplies by `STRIP_H / MAIN_H`.

### Two-level group hierarchy
```
scene
└── animGroup          ← animation spin, pan (position), no scale
    └── poseGroup      ← static shape orientation (Rot X/Y/Z + drag)
        └── loadedObject  ← geometry + pivot offset on .position
```

`animGroup` is the spin target for triggered animations. `poseGroup` holds the resting orientation — it stays constant through the animation so the pose is baked in. Never put user-facing scale on `animGroup`; there is no zoom.

### centerAndFit
Scale must be applied **before** translating, not after. The correct order:
```js
object.position.copy(center).multiplyScalar(-s);  // position = -s * center
object.scale.setScalar(s);
```

### Extrusion controls (shapeW / shapeH / shapeD)
These are **not scale transforms** — they rebuild the geometry via `rebuildShape()` → `rebuildDefaultLogo()`. `centerAndFit` is called each rebuild so proportions change while the shape stays fitted to the frustum.

```js
const body = new THREE.Mesh(new THREE.BoxGeometry(W*2, H*2, D*2), dummy);
const stem = new THREE.Mesh(new THREE.PlaneGeometry(D*2, stemHeight), dummy);
stem.rotation.y = -Math.PI / 2;
stem.position.set(-W, H + stemHeight/2, 0);
stem.userData.isStem = true;  // used to suppress the crossbar edge in artwork layer
```

Default: W=1, H=1, D=0.75.

### Stem crossbar suppression
The stem's bottom edge (at `y = -stemHeight/2` in mesh local space) creates a "crossbar" across the back of the 6. This edge is removed from the **artwork** layer only — the **foundation** layer retains it. `getStemArtworkPositions(mesh)` filters the EdgesGeometry positions array, skipping any segment where both endpoints sit at `y ≈ -stemHeight/2`. Applied in both `applyEdgeMode()` and `rebuildEdges()`.

### Two rendering layers
Every mesh gets two `LineSegments2` siblings:

| Layer | renderOrder | depthTest | Purpose |
|---|---|---|---|
| Artwork | 0 | true | Primary thick stroke — off for stem crossbar |
| Foundation | 1 | false | Thin ghost skeleton — always visible through shape |

`meshToLine` and `meshToFoundation` WeakMaps track mesh → line for `rebuildEdges()`. `artworkMaterials` and `foundationMaterials` flat arrays (populated by `collectMaterials()`) avoid per-frame scene traversal during preview rendering.

### Spring physics animation
Triggered animations use a continuous spring integrator, not fixed-duration easing. The spring operates on normalized progress (0→1) mapped to actual rotation — so the same stiffness/damping feel is consistent regardless of spin distance.

```js
const SPRING = { stiffness: 50, damping: 12, mass: 1 };
// ζ ≈ 0.85 — weighted entrance feel, ~2s to settle, ~0.5% overshoot
```

Each rAF frame:
```js
const error = spring.progress - 1;
const force = -stiffness * error - damping * spring.vel;
spring.vel      += (force / mass) * dt;
spring.progress += spring.vel * dt;
animGroup.rotation.y = spring.startY + (spring.targetY - spring.startY) * spring.progress;
```

`dt` is capped at 50ms to prevent instability on tab wake-up.

### applyEdgeMode
Traverses the group, hides all meshes (`visible = false`), adds a `LineSegments2` sibling for each mesh's `EdgesGeometry`. Uses `PARAMS.edgeAngle` as the crease threshold. Stem meshes (`userData.isStem`) use `getStemArtworkPositions()` for the artwork layer.

### Panel layout
The viewer is a two-panel layout: main viewport (top) + optional color preview strip (bottom). Both are inset from a dark page background (`#111111`, `padding: 10px`) with `border-radius: 12px` via `overflow: hidden` on `.canvas-container`. A `.panel-divider` div (same bg color as page) creates the visual gap; `::before`/`::after` pseudo-elements with radial-gradient concave corners round all 4 inner corners. `--strip-h` CSS variable (set from JS via `updateStripHeight()`) positions the gap accurately. `panel-divider` z-index must stay low (1) to avoid covering Tweakpane.

### Grid guides
Fixed XY-plane grid added to scene root (not animGroup/poseGroup) at z = −0.5. Stays put when the model rotates/pans. Two layers: subtle background grid + brighter center crosshairs. **Hidden by default** (`showGrid: false`).

### SVG loading
`cachedSVGPaths` stores parsed SVG paths on load. The extrusion slider calls `rebuildSVGGeometry()` which regenerates `ExtrudeGeometry` from the cache — avoids re-parsing the file on every slider tick.

### No zoom
Scroll wheel is intentionally disabled (`onMouseWheel` only calls `e.preventDefault()`). There is no zoom control. Shape size is controlled by the Extrusion sliders.

### Default pose
```js
const DEFAULT_ROT_X = 0, DEFAULT_ROT_Y = 45, DEFAULT_ROT_Z = -45;
```
`resetTransformState` does NOT override rotation for the default logo (only for SVG which needs -90°X). `resetView` returns to `DEFAULT_ROT_*`.

## PARAMS object

```js
const PARAMS = {
  bgColor:           '#0D2929',
  fillColor:         '#F65128',
  showArtwork:       true,
  edgeWeight:        9.5,        // pixels at REFERENCE_H (800px)
  edgeAngle:         70,
  showFoundation:    false,      // off by default
  foundationColor:   '#ffffff',
  foundationWeight:  1,
  foundationOpacity: 1,
  extrusionDepth:    5,          // SVG only
  stemHeight:        2,
  rotX: 0, rotY: 45, rotZ: -45,
  shapeW: 1, shapeH: 1, shapeD: 0.75,
  panX: 0, panY: 0,
  pivotX: 0, pivotY: 0, pivotZ: 0,
  showPreviews:      true,
  showGrid:          false,      // off by default
};
```

## Things to watch out for

- `LineMaterial.resolution` must be updated in `onWindowResize` or lines will scale incorrectly after resizing. Resolution should use `mainH` (not full canvas height) so it matches the actual render viewport.
- Linewidth must also be rescaled in `onWindowResize` via `scaledLinewidth()` — not just resolution.
- Vite's SFC compiler can break `function` hoisting in `<script setup>`. Define functions before first use to be safe.
- `createGridGuides()` must be declared before `initScene()` calls it.
- The `loadedObject.position` is used for pivot offset — don't use it for centering after `mountIntoScene()`.
- Spring `dt` must be capped (50ms) or tab wake-up will cause an explosive single-frame jump.
- `rebuildShape()` calls `rebuildDefaultLogo()` which removes/re-adds `loadedObject` from `poseGroup`. Don't hold stale references to `loadedObject` across a rebuild.
- `panel-divider` z-index must be kept low (1). If raised above Tweakpane's stacking level, the panel line will cover the control panel.
- The concave corner pseudo-elements on `.panel-divider` must NOT set `background-color` — doing so blocks the transparent gradient areas from showing the canvas behind, rendering as solid squares instead of curves.
