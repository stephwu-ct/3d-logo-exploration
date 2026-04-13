# 6th Street Logo — Claude Context

## What this is

A standalone Three.js wireframe viewer for the 6th Street logo. Used by Matty for motion and animation exploration — not a production app. The goal is real-time visual experimentation: edge weight, color, rotation, pivot point.

## Stack

- Vue 3 `<script setup>` — single component app (`ThreeViewer.vue`)
- Three.js `^0.183` — orthographic camera, `LineSegments2` / `LineMaterial` for thick edges
- Tweakpane v4 — control panel
- Vite 8

All logic lives in `src/components/ThreeViewer.vue`. There is no router, no state management, no other components.

## Key architecture decisions

### Thick edges: LineSegments2, not LineBasicMaterial
`LineBasicMaterial.linewidth` is a no-op in WebGL on most browsers (always 1px). The only way to get real thick lines in Three.js is `LineSegments2` + `LineMaterial` from `three/examples/jsm/lines/`. `LineMaterial.linewidth` is in **screen-space pixels** and requires `resolution` to be set and updated on resize.

### pivotGroup architecture
```
scene
└── pivotGroup          ← rotation, scale, pan (user controls)
    └── loadedObject    ← geometry + pivot offset on .position
```
`applyPivotOffset()` sets `loadedObject.position.set(-pivotX, -pivotY, -pivotZ)` so the rotation pivot feels correct.

### centerAndFit
Scale must be applied **before** translating, not after. The correct order:
```js
object.position.copy(center).multiplyScalar(-s);  // position = -s * center
object.scale.setScalar(s);
```
Doing it the other way shifts the center by `center * (s - 1)` after scaling.

### applyEdgeMode
Called after any geometry load. Traverses the group, hides all meshes (sets `visible = false`), and adds a `LineSegments2` sibling for each mesh's `EdgesGeometry`. Works for OBJ, SVG (extruded), and the default coded geometry.

### Grid guides
Fixed XY-plane grid added to scene root (not pivotGroup) at z = -0.5. Stays put when the model rotates/pans. Marks world (0,0) as a stable reference. Two layers: subtle background grid + brighter center crosshairs.

### SVG loading
`cachedSVGPaths` stores parsed SVG paths on load. The extrusion slider calls `rebuildSVGGeometry()` which regenerates `ExtrudeGeometry` from the cache — avoids re-parsing the file on every slider tick.

## PARAMS object

```js
const PARAMS = {
  bgColor:        '#0D2929',
  fillColor:      '#F65128',
  edgeWeight:     3,          // screen pixels, 1–100
  extrusionDepth: 5,          // SVG only
  rotX: 0, rotY: 0, rotZ: 0,
  scale: 1,
  pivotX: 0, pivotY: 0, pivotZ: 0,
};
```

Tweakpane binds directly to this object. `downloadPreset()` exports it as JSON.

## Things to watch out for

- `LineMaterial.resolution` must be updated in `onWindowResize` or lines will scale incorrectly after resizing.
- Vite's SFC compiler can break `function` hoisting in `<script setup>`. Define functions before first use to be safe.
- `createGridGuides()` must be declared before `initScene()` calls it.
- The `loadedObject.position` is used for pivot offset — don't use it for centering after `mountIntoScene()`.
