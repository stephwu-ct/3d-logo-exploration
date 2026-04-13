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
| Rot X / Y / Z | Rotation in degrees |
| Scale | Uniform scale |
| Pivot | Offset the rotation pivot point for animation |
| Reset View | Returns to default rotation and scale |
| Screenshot | Downloads current frame as PNG |
| Download Preset | Exports all PARAMS values as JSON |

### Mouse

| Action | Result |
|---|---|
| Left drag | Rotate |
| Right drag / Shift + drag | Pan |
| Scroll wheel | Zoom |

### Loading files

Click **Load File (OBJ / SVG)** to replace the default logo geometry with your own:
- `.obj` — loaded as-is, centered and fitted, edges extracted
- `.svg` — extruded into 3D; an **Extrusion** depth slider appears

## Default geometry

The 6th Street logo is coded directly (`loadDefaultLogo`) as:
- `BoxGeometry(2, 2, 2)` — the cube body
- `PlaneGeometry(2, 2)` rotated to the YZ plane at x=-1, y=2 — the upstroke

This matches the `public/sixth-logo.obj` shape exactly. No file load required on startup.

## Grid guides

A fixed XY-plane grid sits at the scene root (z = -0.5). It does **not** move with the model — it marks world (0, 0) as a stable reference while you pan and rotate the logo.

## Build

```bash
npm run build   # output → dist/
npm run preview # preview the production build
```
