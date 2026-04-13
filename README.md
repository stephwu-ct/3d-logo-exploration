# 6th Street Logo — 3D Wireframe Viewer

Interactive 3D wireframe editor for the 6th Street logo, built with Vue 3, Three.js, and Tweakpane. Used for motion/animation exploration.

## Stack

- **Vue 3** (Composition API, `<script setup>`)
- **Three.js** with `LineSegments2` + `LineMaterial` for true thick wireframe edges
- **Tweakpane v4** for the control panel
- **Vite** dev server

## Getting started

```bash
npm install
npm run dev
# → http://localhost:5173
```

## Controls

### Tweakpane panel (top right)

| Control | Description |
|---|---|
| Background | Canvas background color |
| Edge Color | Wireframe edge color |
| Edge Weight | Line thickness in screen pixels (1–100) |
| Edge Angle | Crease angle threshold for edge detection (1–90°) |
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
- `BoxGeometry(W*2, H*2, D*2)` — the cube body (W/H/D from Extrusion sliders, default 1/1/0.95)
- `PlaneGeometry(D*2, stemHeight)` rotated to the YZ plane at x=−W — the upstroke

Default pose: Y=45°, Z=−45°, edge weight 9.5, edge angle 70°.

## Animation

The Spin 360° animation uses a spring physics integrator (not fixed-duration easing):

```js
const SPRING = { stiffness: 50, damping: 12, mass: 1 };
```

Each rAF frame steps the spring in normalized progress space (0→1), mapped to Y rotation. This gives organic acceleration and a natural weighted decelerate-and-settle feel — appropriate for a logo entrance.

## Grid guides

A fixed XY-plane grid sits at the scene root (z = −0.5). It does **not** move with the model — it marks world (0, 0) as a stable reference while you rotate and pan.

## Build

```bash
npm run build   # output → dist/
npm run preview # preview the production build
```
