# 6th Street Logo — 3D Wireframe Viewer

Interactive 3D wireframe editor for the 6th Street logo, built with Vue 3, Three.js, and Tweakpane. Used for motion/animation exploration.

## Stack

- **Vue 3** (Composition API, `<script setup>`)
- **Three.js** with `LineSegments2` + `LineMaterial` for true thick wireframe edges
- **Tweakpane v4** for the control panel
- **Vite** dev server

## Getting started

```bash
pnpm install
pnpm dev
# → http://localhost:5173
```

## Controls

### Tweakpane panel (top right)

| Control | Description |
|---|---|
| Color Previews | Toggle a 4-cell preview strip showing the logo across color schemes |
| Show Grid | Toggle the XY-plane grid guides |
| Background | Canvas background color |
| Show (Material) | Toggle the artwork stroke layer |
| Edge Color | Wireframe edge color |
| Edge Weight | Line thickness — normalized to 800px viewport height, visually consistent at any size |
| Edge Angle | Crease angle threshold for edge detection (1–90°) |
| Show (Foundation) | Toggle the thin ghost wireframe layer (drawn on top with depthTest off) |
| Foundation Color / Weight / Opacity | Foundation layer appearance |
| Stem Height | Height of the "6" upstroke |
| Rot X / Y / Z | Static pose rotation in degrees |
| Width / Height / Depth | Extrusion dimensions — rebuilds geometry (not a scale transform) |
| Spin 360° | Triggers a spring-physics 360° Y-axis entrance spin |
| Pivot | Offset the rotation pivot point |
| Reset View | Returns to default pose (Y=45, Z=−45) |
| Screenshot | Downloads current frame as PNG |
| Export SVG | Projects edges through camera and downloads as SVG |
| Download Preset | Exports all PARAMS values as JSON |

### Mouse

| Action | Result |
|---|---|
| Left drag | Rotate (world-space, always maps to screen axes) |
| Right drag / Shift + drag | Pan |

### Keyboard

| Shortcut | Action |
|---|---|
| Cmd+Z | Undo |
| Cmd+Shift+Z | Redo |

### Loading files

Click **Load File (OBJ / SVG)** to replace the default logo geometry:
- `.obj` — loaded as-is, centered and fitted, edges extracted
- `.svg` — extruded into 3D; an **Extrusion** depth slider appears

## Default geometry

The 6th Street logo is coded directly (`loadDefaultLogo`) as:
- `BoxGeometry(W*2, H*2, D*2)` — the cube body (W/H/D from Extrusion sliders, default 1/1/0.75)
- `PlaneGeometry(D*2, stemHeight)` rotated to the YZ plane at x=−W — the upstroke (`isStem: true`)

Default pose: Y=45°, Z=−45°, edge weight 9.5, edge angle 70°.

The stem has `userData.isStem = true`. The artwork layer omits the stem's bottom edge (the crossbar at `y = -stemHeight/2`) to keep the back of the "6" as a clean unbroken edge. The foundation layer retains all edges.

## Rendering layers

Two `LineSegments2` layers per mesh, both derived from `EdgesGeometry`:

| Layer | `renderOrder` | `depthTest` | Purpose |
|---|---|---|---|
| Artwork | 0 | true | Primary thick stroke |
| Foundation | 1 | false | Thin ghost overlay — back edges always visible |

## Panel layout

The viewer uses a two-panel layout: a main viewport (top) and a color preview strip (bottom, toggled via Color Previews). Both panels sit inset from the dark page background with `border-radius: 12px`. When the preview strip is visible, a gap div with concave CSS corner pieces creates fully rounded inner corners on both panels.

## Linewidth normalization

`LineMaterial.linewidth` is screen-space pixels. To keep visual stroke weight consistent at any viewport size, linewidth is multiplied by `mainH / REFERENCE_H` (reference = 800px). `PARAMS.edgeWeight` is expressed as pixels-at-800px.

## Animation

The Spin 360° animation uses a spring physics integrator (not fixed-duration easing):

```js
const SPRING = { stiffness: 50, damping: 12, mass: 1 };
```

Each rAF frame steps the spring in normalized progress space (0→1), mapped to Y rotation. This gives organic acceleration and a natural weighted decelerate-and-settle feel — appropriate for a logo entrance.

## Grid guides

A fixed XY-plane grid sits at the scene root (z = −0.5). It does **not** move with the model — it marks world (0, 0) as a stable reference while you rotate and pan. Hidden by default; toggle via Show Grid.

## Build

```bash
pnpm run build   # output → dist/
pnpm run preview # preview the production build
```
