<template>
  <div ref="containerRef" class="viewer-container">
    <div class="viewer-left">
      <div ref="canvasRef" class="canvas-container"></div>
      <div v-if="showPreviewsReactive" class="panel-divider"></div>
      <div v-if="info" class="info-bar">{{ info }}</div>
    </div>
    <div class="viewer-right">
      <div class="palette-panel">
        <div class="palette-label">Palette</div>
        <div class="palette-swatches">
          <button
            v-for="swatch in PALETTE"
            :key="swatch.bg"
            class="palette-swatch"
            :style="{ background: swatch.bg }"
            :title="swatch.bg"
            @click="applyPalette(swatch)"
          />
        </div>
      </div>
      <div ref="paneContainerRef" class="pane-container"></div>
    </div>
    <input ref="fileInputRef" type="file" accept=".obj,.svg" @change="handleFileUpload" style="display:none" />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import * as THREE from 'three';
import { OBJLoader }            from 'three/examples/jsm/loaders/OBJLoader.js';
import { SVGLoader }            from 'three/examples/jsm/loaders/SVGLoader.js';
import { LineSegments2 }        from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial }         from 'three/examples/jsm/lines/LineMaterial.js';
import { Pane } from 'tweakpane';
import spinForward     from '../animations/spinForward.js';
import spinReverse     from '../animations/spinReverse.js';
import axisFlip        from '../animations/axisFlip.js';
import scaleEntrance   from '../animations/scaleEntrance.js';
import extrudeFromFlat from '../animations/extrudeFromFlat.js';
import drawIn          from '../animations/drawIn.js';
const ANIMATIONS = [spinForward, spinReverse, axisFlip, scaleEntrance, extrudeFromFlat, drawIn];

const PALETTE = [
  { bg: '#131313', stroke: '#F6F5F4', fillBg: '#131313' },
  { bg: '#0D2929', stroke: '#F65128', fillBg: '#0D2929' },
  { bg: '#366F75', stroke: '#F6F5F4', fillBg: '#366F75' },
  { bg: '#C9E7F0', stroke: '#0D2929', fillBg: '#C9E7F0' },
  { bg: '#F65128', stroke: '#0D2929', fillBg: '#F65128' },
  { bg: '#F6F5F4', stroke: '#131313', fillBg: '#F6F5F4' },
];

function applyPalette({ bg, stroke, fillBg }) {
  PARAMS.bgColor   = bg;
  PARAMS.fillColor = stroke;
  PARAMS.fillBgColor = fillBg;
  scene.background = new THREE.Color(bg);
  updateEdgeColor();
  updateFill();
  pane.refresh();
  scheduleSnapshot();
}

const canvasRef            = ref(null);
const fileInputRef         = ref(null);
const containerRef         = ref(null);
const paneContainerRef     = ref(null);
const info                 = ref('');
const showPreviewsReactive = ref(true);

// ─── Two-level group hierarchy ────────────────────────────────
//
//   scene
//   └── animGroup    ← pan, uniform scale, and animation spin
//         └── poseGroup  ← static shape orientation (Rot X/Y/Z + drag)
//               └── loadedObject  ← geometry + pivot offset
//
// Separating the two layers means you can pose the shape to a nice
// 3/4 angle, then animate animGroup spinning on Y — the pose stays
// baked in throughout the animation.

let scene, camera, renderer;
let animGroup    = null;   // animation / scale / pan target
let poseGroup    = null;   // manual orientation target
let loadedObject = null;   // geometry; pivot offset on .position
let gridGroup    = null;   // fixed XY grid guides — hidden in preview cells
let faceGridGroup = null;  // face-aligned grids in poseGroup (rotate with model)
let animationFrameId = null;
let lastFrameTime    = null;
// Active animation module — only one at a time.
let currentAnim      = null;
// Last W/H used to build faceGridGroup — skip rebuild when only D changes.
let _faceGridW = null, _faceGridH = null;

const FRUSTUM_SIZE = 4;
const DEG2RAD      = Math.PI / 180;
// Reference height for linewidth normalization. PARAMS.edgeWeight is expressed
// in pixels-at-800px. At any other height the linewidth scales proportionally
// so the stroke looks the same size relative to the logo.
const REFERENCE_H  = 800;

// Default pose — matches the saved preset so Reset View returns here.
const DEFAULT_ROT_X = 0, DEFAULT_ROT_Y = 45, DEFAULT_ROT_Z = -45;

// Preview strip — 4 color schemes rendered via scissor into the same canvas.
// Green/orange use the same values as the main PARAMS defaults.
const PREVIEW_SCHEMES = [
  { bg: '#FFFFFF', stroke: '#000000' },  // white bg, black stroke
  { bg: '#000000', stroke: '#FFFFFF' },  // black bg, white stroke
  { bg: '#0D2929', stroke: '#F65128' },  // brand bg + orange (default view)
  { bg: '#F65128', stroke: '#0D2929' },  // orange bg, brand dark stroke
];

// Cached flat arrays of materials — populated by collectMaterials() after
// any applyEdgeMode / rebuild. Avoids per-frame scene traversal.
let artworkMaterials    = [];
let artworkLines        = [];   // LineSegments2 objects for artwork layer (used by drawIn)
let foundationMaterials = [];
let fillMeshMaterials   = [];

// ─── Interaction ──────────────────────────────────────────────
let isDragging = false;
let isPanning  = false;
let previousMousePosition = { x: 0, y: 0 };
let shiftPressed = false;

// ─── Tweakpane ────────────────────────────────────────────────
let pane;
let extrusionBinding, stemBinding;
let rotXBinding, rotYBinding, rotZBinding;
let shapeWBinding, shapeHBinding, shapeDBinding;
let foundationWeightBinding, foundationOpacityBinding;

// ─── PARAMS ───────────────────────────────────────────────────
// Snapshotted keys: everything except animAxis/animSpeed/animPlaying
// (animation state is transient — not part of undo history).
const PARAMS = {
  bgColor:        '#0D2929',
  fillBgColor:    '#0D2929',
  fillColor:      '#F65128',
  showArtwork:    true,
  edgeWeight:     9.5,
  edgeAngle:      70,
  // Foundation layer — thin wireframe drawn ON TOP (depthTest:false, renderOrder:1)
  showFoundation:    false,
  foundationColor:   '#ffffff',
  foundationWeight:  1,
  foundationOpacity: 1,
  extrusionDepth: 5,
  stemHeight:     1,
  // pose (poseGroup)
  rotX: 0, rotY: 45, rotZ: -45,
  // shape dimensions — rebuild geometry on change (W=width, H=height, D=depth)
  shapeW: 1, shapeH: 1, shapeD: 0.75,
  cornerRadius: 0,
  // pan (animGroup position)
  panX: 0, panY: 0,
  // pivot offset (loadedObject)
  pivotX: 0, pivotY: 0, pivotZ: 0,
  // preview strip
  showPreviews:     true,
  showGrid:         false,
  hideBodyCrossbar: false,
  showFill:         true,
  showFaceNumbers:  false,
  zoom: 1,
  knockout: false,
};

const SNAPSHOT_KEYS = [
  'bgColor','fillBgColor','fillColor','showArtwork','edgeWeight','edgeAngle',
  'showFoundation','foundationColor','foundationWeight','foundationOpacity',
  'extrusionDepth','stemHeight',
  'rotX','rotY','rotZ','shapeW','shapeH','shapeD','cornerRadius','panX','panY',
  'pivotX','pivotY','pivotZ','showGrid','hideBodyCrossbar','showFill','zoom','knockout',
];

let cachedSVGPaths    = null;
let isSVGLoaded       = false;
const meshToLine       = new WeakMap(); // mesh → artwork LineSegments2
const meshToFoundation = new WeakMap(); // mesh → foundation LineSegments2
const meshToFillColor  = new WeakMap(); // mesh → color-pass fill sibling

// Per-face painter layers — populated by buildFaceLayers for the default logo.
// Each entry: { fill: Mesh, stroke: LineSegments2, localNormal: Vector3 }
// renderOrders 1/2 = back (fill/stroke), 3/4 = front. Updated every frame.
let faceLayerGroups = [];
let crossbarStroke  = null; // junction edge between top face and stem, underside-only

// ─── History ──────────────────────────────────────────────────

const history          = [];
let   historyIndex     = -1;
let   snapshotTimer    = null;
let   lastSnapshotJson = null;
const MAX_HISTORY      = 50;

function makeSnapshotJson() {
  const snap = {};
  SNAPSHOT_KEYS.forEach(k => { snap[k] = PARAMS[k]; });
  return JSON.stringify(snap);
}

function commitSnapshot() {
  clearTimeout(snapshotTimer);
  const json = makeSnapshotJson();
  if (json === lastSnapshotJson) return;
  history.splice(historyIndex + 1);
  history.push(JSON.parse(json));
  if (history.length > MAX_HISTORY) history.shift();
  historyIndex     = history.length - 1;
  lastSnapshotJson = json;
}

function scheduleSnapshot() {
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(commitSnapshot, 400);
}

function undo() {
  commitSnapshot();
  if (historyIndex <= 0) return;
  historyIndex--;
  applySnapshot(history[historyIndex]);
}

function redo() {
  if (historyIndex >= history.length - 1) return;
  historyIndex++;
  applySnapshot(history[historyIndex]);
}

function applySnapshot(snap) {
  SNAPSHOT_KEYS.forEach(k => { PARAMS[k] = snap[k]; });
  pane.refresh();
  scene.background = new THREE.Color(PARAMS.bgColor);
  updateFill();
  updateArtwork();
  updateFoundation();
  syncPose();
  rebuildShape();
  if (animGroup) animGroup.position.set(PARAMS.panX, PARAMS.panY, 0);
  applyPivotOffset();
  if (gridGroup)     gridGroup.visible     = PARAMS.showGrid;
  if (faceGridGroup) faceGridGroup.visible = PARAMS.showGrid;
  lastSnapshotJson = makeSnapshotJson();
}

// ─── Panel layout ─────────────────────────────────────────────
// Sets --strip-h on the container so the panel-divider CSS can position
// the gap between the main viewport and the preview strip panels.

function updateStripHeight() {
  if (!containerRef.value || !canvasRef.value) return;
  const cw = canvasRef.value.clientWidth;
  const h  = PARAMS.showPreviews
    ? Math.round(Math.min(220, cw / PREVIEW_SCHEMES.length))
    : 0;
  containerRef.value.style.setProperty('--strip-h', h + 'px');
}

// ─── Lifecycle ────────────────────────────────────────────────

onMounted(() => {
  initScene();
  initPane();
  window.addEventListener('resize', onWindowResize);
  loadDefaultLogo();
  commitSnapshot();
  updateStripHeight();
});

onUnmounted(() => {
  cancelAnimationFrame(animationFrameId);
  clearTimeout(snapshotTimer);
  window.removeEventListener('resize', onWindowResize);
  document.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('keyup',   onKeyUp);
  renderer?.dispose();
  pane?.dispose();
});

// ─── Grid guides ──────────────────────────────────────────────
// Fixed XY-plane guides at scene root (z = -0.5).
// They do NOT rotate with the model — they mark world (0,0).

function createGridGuides() {
  const group = new THREE.Group();
  const dim = 8, step = 0.5, Z = -0.5;

  const gridPts = [];
  for (let i = -dim; i <= dim; i += step) {
    gridPts.push(new THREE.Vector3(-dim, i, Z), new THREE.Vector3(dim, i, Z));
    gridPts.push(new THREE.Vector3(i, -dim, Z), new THREE.Vector3(i,  dim, Z));
  }
  group.add(new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(gridPts),
    new THREE.LineBasicMaterial({ color: 0x163535, transparent: true, opacity: 0.55 })
  ));

  const crossPts = [
    new THREE.Vector3(-dim, 0, Z), new THREE.Vector3(dim, 0, Z),
    new THREE.Vector3(0, -dim, Z), new THREE.Vector3(0,  dim, Z),
  ];
  group.add(new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(crossPts),
    new THREE.LineBasicMaterial({ color: 0x2d7070, transparent: true, opacity: 0.8 })
  ));

  return group;
}

// Face-aligned reference grids — live in poseGroup so they rotate with the model.
// Left wall: YZ plane at x = -W  (face 2/7)
// Floor:     XZ plane at y = -H  (face 4)
function buildFaceGrids() {
  const group = new THREE.Group();
  const W = PARAMS.shapeW, H = PARAMS.shapeH;
  const dim = 4, step = 0.5;

  const baseMat = () => new THREE.LineBasicMaterial({ color: 0x163535, transparent: true, opacity: 0.55 });
  const axisMat = () => new THREE.LineBasicMaterial({ color: 0x2d7070, transparent: true, opacity: 0.8  });

  // — Left wall (YZ plane at x = -W) —
  const wallPts = [], wallAxisPts = [];
  for (let i = -dim; i <= dim; i += step) {
    const pts = Math.abs(i) < 1e-6 ? wallAxisPts : wallPts;
    pts.push(new THREE.Vector3(-W, i,    -dim), new THREE.Vector3(-W, i,    dim));  // along Z
    pts.push(new THREE.Vector3(-W, -dim, i),    new THREE.Vector3(-W, dim,  i));    // along Y
  }
  if (wallPts.length)     group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wallPts),     baseMat()));
  if (wallAxisPts.length) group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wallAxisPts), axisMat()));

  // — Floor (XZ plane at y = -H) —
  const floorPts = [], floorAxisPts = [];
  for (let i = -dim; i <= dim; i += step) {
    const pts = Math.abs(i) < 1e-6 ? floorAxisPts : floorPts;
    pts.push(new THREE.Vector3(i,    -H, -dim), new THREE.Vector3(i,    -H, dim));  // along Z
    pts.push(new THREE.Vector3(-dim, -H, i),    new THREE.Vector3(dim,  -H, i));    // along X
  }
  if (floorPts.length)     group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(floorPts),     baseMat()));
  if (floorAxisPts.length) group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(floorAxisPts), axisMat()));

  group.visible = PARAMS.showGrid;
  return group;
}

// ─── Scene ────────────────────────────────────────────────────

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(PARAMS.bgColor);

  const aspect = canvasRef.value.clientWidth / canvasRef.value.clientHeight;
  camera = new THREE.OrthographicCamera(
    (-FRUSTUM_SIZE * aspect) / 2, ( FRUSTUM_SIZE * aspect) / 2,
     FRUSTUM_SIZE / 2,            -FRUSTUM_SIZE / 2,
    0.1, 1000
  );
  camera.position.set(0, 0, 2);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(canvasRef.value.clientWidth, canvasRef.value.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  canvasRef.value.appendChild(renderer.domElement);

  gridGroup = createGridGuides();
  gridGroup.visible = PARAMS.showGrid;
  scene.add(gridGroup);
  setupMouseControls();
  animate();
}

// ─── Tweakpane ────────────────────────────────────────────────

function initPane() {
  pane = new Pane({ title: '6th Street Logo', container: paneContainerRef.value });
  pane.element.style.width = '100%';

  pane.addButton({ title: 'Load File  (OBJ / SVG)' }).on('click', () => {
    fileInputRef.value.click();
  });
  pane.addBinding(PARAMS, 'showPreviews', { label: 'Color Previews' })
    .on('change', () => { showPreviewsReactive.value = PARAMS.showPreviews; updateStripHeight(); onWindowResize(); });
  pane.addBinding(PARAMS, 'showGrid', { label: 'Show Grid' })
    .on('change', () => {
      if (gridGroup)     gridGroup.visible     = PARAMS.showGrid;
      if (faceGridGroup) faceGridGroup.visible = PARAMS.showGrid;
      scheduleSnapshot();
    });
  pane.addBinding(PARAMS, 'showFaceNumbers', { label: 'Face Numbers' })
    .on('change', () => { updateFaceNumbers(); });

  // Material
  const matFolder = pane.addFolder({ title: 'Material', expanded: true });

  matFolder.addBinding(PARAMS, 'bgColor', { label: 'Background', view: 'color' })
    .on('change', ({ value }) => { scene.background = new THREE.Color(value); updateFill(); scheduleSnapshot(); });
  matFolder.addBinding(PARAMS, 'fillBgColor', { label: 'Fill BG', view: 'color' })
    .on('change', () => { updateFill(); scheduleSnapshot(); });
  matFolder.addBinding(PARAMS, 'showFill', { label: 'Fill' })
    .on('change', () => { updateFill(); scheduleSnapshot(); });
  matFolder.addBinding(PARAMS, 'knockout', { label: 'Knockout' })
    .on('change', () => { updateFill(); scheduleSnapshot(); });
  matFolder.addBinding(PARAMS, 'showArtwork', { label: 'Stroke' })
    .on('change', () => { updateArtwork(); scheduleSnapshot(); });
  matFolder.addBinding(PARAMS, 'fillColor', { label: 'Edge Color', view: 'color' })
    .on('change', () => { updateEdgeColor(); scheduleSnapshot(); });
  matFolder.addBinding(PARAMS, 'edgeWeight', { label: 'Edge Weight', min: 1, max: 100, step: 0.5 })
    .on('change', () => { updateEdgeWeight(); scheduleSnapshot(); });
  matFolder.addBinding(PARAMS, 'edgeAngle', { label: 'Edge Angle', min: 1, max: 90, step: 1 })
    .on('change', () => { rebuildEdges(); scheduleSnapshot(); });

  extrusionBinding = matFolder
    .addBinding(PARAMS, 'extrusionDepth', { label: 'Extrusion', min: 0.1, max: 50, step: 0.5 })
    .on('change', () => { rebuildSVGGeometry(); scheduleSnapshot(); });
  extrusionBinding.hidden = true;

  stemBinding = matFolder
    .addBinding(PARAMS, 'stemHeight', { label: 'Stem Height', min: 0.5, max: 8, step: 0.1 })
    .on('change', () => { rebuildDefaultLogo(); scheduleSnapshot(); });
  matFolder.addBinding(PARAMS, 'hideBodyCrossbar', { label: 'Hide Back Crossbar' })
    .on('change', () => { rebuildEdges(); scheduleSnapshot(); });

  // Foundation — thin ghost skeleton always drawn beneath the artwork
  const foundFolder = pane.addFolder({ title: 'Foundation', expanded: true });
  foundFolder.addBinding(PARAMS, 'showFoundation', { label: 'Show' })
    .on('change', () => { updateFoundation(); scheduleSnapshot(); });
  foundFolder.addBinding(PARAMS, 'foundationColor', { label: 'Color', view: 'color' })
    .on('change', () => { updateFoundation(); scheduleSnapshot(); });
  foundationWeightBinding = foundFolder.addBinding(PARAMS, 'foundationWeight', { label: 'Weight', min: 0.5, max: 10, step: 0.5 })
    .on('change', () => { updateFoundation(); scheduleSnapshot(); });
  foundationOpacityBinding = foundFolder.addBinding(PARAMS, 'foundationOpacity', { label: 'Opacity', min: 0, max: 1, step: 0.01 })
    .on('change', () => { updateFoundation(); scheduleSnapshot(); });

  // Pose — sets the static orientation of the shape (poseGroup)
  // This is the "resting angle" that stays constant during animation.
  const poseFolder = pane.addFolder({ title: 'Pose', expanded: true });

  rotXBinding = poseFolder.addBinding(PARAMS, 'rotX', { label: 'Rot X', min: -180, max: 180, step: 1 })
    .on('change', () => { syncPose(); scheduleSnapshot(); });
  rotYBinding = poseFolder.addBinding(PARAMS, 'rotY', { label: 'Rot Y', min: -180, max: 180, step: 1 })
    .on('change', () => { syncPose(); scheduleSnapshot(); });
  rotZBinding = poseFolder.addBinding(PARAMS, 'rotZ', { label: 'Rot Z', min: -180, max: 180, step: 1 })
    .on('change', () => { syncPose(); scheduleSnapshot(); });

  // Extrusion — rebuilds geometry to change proportions (not a scale transform)
  const xfFolder = pane.addFolder({ title: 'Extrusion', expanded: true });
  shapeWBinding = xfFolder.addBinding(PARAMS, 'shapeW', { label: 'Width',  min: 0.2, max: 4, step: 0.05 })
    .on('change', () => { rebuildShape(); scheduleSnapshot(); });
  shapeHBinding = xfFolder.addBinding(PARAMS, 'shapeH', { label: 'Height', min: 0.2, max: 4, step: 0.05 })
    .on('change', () => { rebuildShape(); scheduleSnapshot(); });
  shapeDBinding = xfFolder.addBinding(PARAMS, 'shapeD', { label: 'Depth',  min: 0.1, max: 4, step: 0.05 })
    .on('change', () => { rebuildShape(); scheduleSnapshot(); });
  xfFolder.addBinding(PARAMS, 'cornerRadius', { label: 'Corner Radius', min: 0, max: 0.9, step: 0.01 })
    .on('change', () => { rebuildShape(); scheduleSnapshot(); });
  xfFolder.addBinding(PARAMS, 'zoom', { label: 'Scale', min: 0.1, max: 3, step: 0.05 })
    .on('change', () => { scheduleSnapshot(); });

  // Animations — triggered explorations, each fires a canned animation on animGroup
  const animFolder = pane.addFolder({ title: 'Animations', expanded: true });
  animFolder.addButton({ title: 'Spin Forward     [1]' }).on('click', () => triggerAnimation(spinForward));
  animFolder.addButton({ title: 'Spin Reverse     [2]' }).on('click', () => triggerAnimation(spinReverse));
  animFolder.addButton({ title: 'Axis Flip X      [3]' }).on('click', () => triggerAnimation(axisFlip));
  animFolder.addButton({ title: 'Scale Entrance   [4]' }).on('click', () => triggerAnimation(scaleEntrance));
  animFolder.addButton({ title: 'Extrude Flat     [5]' }).on('click', () => triggerAnimation(extrudeFromFlat));
  animFolder.addButton({ title: 'Draw In          [6]' }).on('click', () => triggerAnimation(drawIn));

  // Pivot — offsets loadedObject within poseGroup, shifting the rotation axis
  const pivotFolder = pane.addFolder({ title: 'Pivot', expanded: false });
  pivotFolder.addBinding(PARAMS, 'pivotX', { label: 'X', min: -2, max: 2, step: 0.01 })
    .on('change', () => { syncPivot(); scheduleSnapshot(); });
  pivotFolder.addBinding(PARAMS, 'pivotY', { label: 'Y', min: -2, max: 2, step: 0.01 })
    .on('change', () => { syncPivot(); scheduleSnapshot(); });
  pivotFolder.addBinding(PARAMS, 'pivotZ', { label: 'Z', min: -2, max: 2, step: 0.01 })
    .on('change', () => { syncPivot(); scheduleSnapshot(); });

  pane.addButton({ title: 'Reset View' }).on('click', resetView);
  pane.addButton({ title: 'Save PNG' }).on('click', downloadScreenshot);
  pane.addButton({ title: 'Export SVG' }).on('click', downloadSVG);
  pane.addButton({ title: 'Download Preset' }).on('click', downloadPreset);
}

// ─── Edge rendering ───────────────────────────────────────────

// Returns linewidth scaled so the stroke is visually consistent at any
// viewport size. weight is expressed in pixels at REFERENCE_H (800px).
function scaledLinewidth(weight) {
  if (!canvasRef.value) return weight;
  const h = canvasRef.value.clientHeight;
  const mainH = PARAMS.showPreviews
    ? h - Math.round(Math.min(220, canvasRef.value.clientWidth / PREVIEW_SCHEMES.length))
    : h;
  return weight * (mainH / REFERENCE_H);
}

// ─── Animation runner ─────────────────────────────────────────

function makeAnimCtx() {
  return {
    animGroup, poseGroup, loadedObject,
    PARAMS, artworkLines, artworkMaterials,
    scaledLinewidth, rebuildShape,
  };
}

function triggerAnimation(anim) {
  if (currentAnim?.active) currentAnim.cancel(makeAnimCtx());
  currentAnim = anim;
  anim.start(makeAnimCtx());
}

function makeEdgeMaterial() {
  return new LineMaterial({
    color:     new THREE.Color(PARAMS.fillColor),
    linewidth: scaledLinewidth(PARAMS.edgeWeight),
    resolution: new THREE.Vector2(
      canvasRef.value?.clientWidth  ?? 1000,
      canvasRef.value?.clientHeight ?? 800
    ),
  });
}

function makeFoundationMaterial() {
  return new LineMaterial({
    color:      new THREE.Color(PARAMS.foundationColor),
    linewidth:  scaledLinewidth(PARAMS.foundationWeight),
    transparent: true,
    opacity:    PARAMS.foundationOpacity,
    depthTest:  false,        // always visible — shows back edges through the shape
    resolution: new THREE.Vector2(
      canvasRef.value?.clientWidth  ?? 1000,
      canvasRef.value?.clientHeight ?? 800
    ),
  });
}

// Returns edge positions for the stem with the bottom edge (crossbar) removed.
// The crossbar sits at y = -stemHeight/2 in the stem's local space and creates
// a horizontal line across the back of the six — remove from artwork, keep in foundation.
function getStemArtworkPositions(mesh) {
  const edgesGeo = new THREE.EdgesGeometry(mesh.geometry, PARAMS.edgeAngle);
  const src = edgesGeo.attributes.position.array;
  const minY = -PARAMS.stemHeight / 2;
  const filtered = [];
  for (let i = 0; i < src.length; i += 6) {
    if (Math.abs(src[i + 1] - minY) < 0.001 && Math.abs(src[i + 4] - minY) < 0.001) continue;
    filtered.push(src[i], src[i+1], src[i+2], src[i+3], src[i+4], src[i+5]);
  }
  return new Float32Array(filtered);
}

// Returns edge positions for the box body with the back-face crossbar removed.
// The crossbar is the top edge of the left face: both endpoints at x≈-W, y≈H.
// Only the single horizontal segment that crosses the back vertical edge of the
// 6 is removed — all other top-face edges are kept.
function getBodyArtworkPositions(mesh) {
  const edgesGeo = new THREE.EdgesGeometry(mesh.geometry, PARAMS.edgeAngle);
  const src = edgesGeo.attributes.position.array;
  const W = PARAMS.shapeW, H = PARAMS.shapeH;
  const filtered = [];
  for (let i = 0; i < src.length; i += 6) {
    const x1 = src[i],   y1 = src[i + 1];
    const x2 = src[i + 3], y2 = src[i + 4];
    if (Math.abs(x1 + W) < 0.001 && Math.abs(y1 - H) < 0.001 &&
        Math.abs(x2 + W) < 0.001 && Math.abs(y2 - H) < 0.001) continue;
    filtered.push(src[i], src[i+1], src[i+2], src[i+3], src[i+4], src[i+5]);
  }
  return new Float32Array(filtered);
}

// ─── Face number labels ───────────────────────────────────────
// Numbered sprites placed at each face center, slightly outside the surface.
// Sprites always face the camera (THREE.Sprite) and ignore depth so they're
// always readable. Called at the end of applyEdgeMode.

function createTextSprite(label) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(size * 0.52)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(label), size / 2, size / 2 + 4);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.28, 0.28, 1);
  sprite.userData.isFaceLabel = true;
  sprite.visible = PARAMS.showFaceNumbers;
  return sprite;
}

function buildFaceLabels(group) {
  let n = 1;
  group.traverse((child) => {
    if (!child.isMesh || child.isLineSegments2 || child.userData.isFillColor || child.userData.isCombinedFill) return;
    const geo = child.geometry;
    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;
    if (!pos || !nrm) return;

    // Fall back to a single group if geometry has none (e.g. PlaneGeometry)
    const groups = geo.groups.length > 0
      ? geo.groups
      : [{ start: 0, count: geo.index ? geo.index.count : pos.count }];

    groups.forEach((grp) => {
      const center = new THREE.Vector3();
      const normal = new THREE.Vector3();
      let count = 0;
      const idx = geo.index?.array;
      for (let i = grp.start; i < grp.start + grp.count; i++) {
        const vi = idx ? idx[i] : i;
        center.x += pos.getX(vi); center.y += pos.getY(vi); center.z += pos.getZ(vi);
        normal.x += nrm.getX(vi); normal.y += nrm.getY(vi); normal.z += nrm.getZ(vi);
        count++;
      }
      center.divideScalar(count);
      normal.divideScalar(count).normalize();

      const sprite = createTextSprite(n++);
      // Position in mesh local space: face center + small offset along face normal
      sprite.position.copy(center).addScaledVector(normal, 0.15);
      child.add(sprite);
    });
  });
}

function updateFaceNumbers() {
  loadedObject?.traverse((child) => {
    if (child.userData.isFaceLabel) child.visible = PARAMS.showFaceNumbers;
  });
}

function applyEdgeMode(group) {
  const meshes = [];
  group.traverse((child) => {
    if (child.isMesh && !child.isLineSegments2) meshes.push(child);
  });
  meshes.forEach((mesh) => {
    // Fill: single pass, renderOrder -1.
    // polygonOffset pushes fill depth slightly away from camera so strokes
    // (renderOrder 0, depthTest true) always pass the depth test and render on top.
    // FrontSide on closed meshes (box body) prevents inner polygons from occluding
    // strokes. DoubleSide on flat planes (stem) ensures visibility from both sides.
    if (mesh.userData.hideFill) {
      mesh.material = new THREE.MeshBasicMaterial({ visible: false });
    } else {
      mesh.material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(PARAMS.bgColor), side: THREE.DoubleSide,
        depthWrite: false, depthTest: false,
      });
      mesh.renderOrder = -1;
      mesh.visible = PARAMS.showFill;
      mesh.userData.isFillColor = true;
    }

    const edgesGeo = new THREE.EdgesGeometry(mesh.geometry, PARAMS.edgeAngle);
    const allPositions = edgesGeo.attributes.position.array;
    // Also suppress the body-stem junction edge (y≈H at x≈-W) whenever the
    // combined stem fill is active — it's an interior seam, not a boundary.
    const hasCombined = mesh.parent?.userData.hasCombinedStemFill;
    const artPositions = mesh.userData.isStem  ? getStemArtworkPositions(mesh) :
                         mesh.userData.isBody && (PARAMS.hideBodyCrossbar || hasCombined) ? getBodyArtworkPositions(mesh) :
                         allPositions;

    // Artwork layer — thick stroke, rendered first (renderOrder 0)
    const lineGeo = new LineSegmentsGeometry();
    lineGeo.setPositions(artPositions);
    const line = new LineSegments2(lineGeo, makeEdgeMaterial());
    line.position.copy(mesh.position);
    line.rotation.copy(mesh.rotation);
    line.scale.copy(mesh.scale);
    line.visible = PARAMS.showArtwork;
    line.renderOrder = 0;
    mesh.parent.add(line);
    meshToLine.set(mesh, line);

    // Foundation layer — wireframe overlay ON TOP (depthTest:false, renderOrder 1)
    // Drawn last so it always shows over the artwork, including back edges.
    const foundGeo = new LineSegmentsGeometry();
    foundGeo.setPositions(allPositions);
    const found = new LineSegments2(foundGeo, makeFoundationMaterial());
    found.position.copy(mesh.position);
    found.rotation.copy(mesh.rotation);
    found.scale.copy(mesh.scale);
    found.visible = PARAMS.showFoundation;
    found.renderOrder = 1;
    mesh.parent.add(found);
    meshToFoundation.set(mesh, found);
  });
  if (group.userData.hasBodyFills) buildFaceLayers(group);
  collectMaterials();
  buildFaceLabels(group);
}

// Builds 4 face-layer groups for the default logo using the painter's algorithm.
// Each group has a fill plane + a LineSegments2 with that face's boundary edges.
// renderOrders 1/2 (back fill/stroke) and 3/4 (front fill/stroke) are updated
// every frame based on the face normal's world-space Z component.
// All use depthTest: false — no depth buffer, pure paint-order compositing.
//
//   Face groups: right (+X), top (+Y), bottom (-Y), combined left+stem (-X)
//   Painter order: back_fill → back_stroke → front_fill → front_stroke
//
function buildFaceLayers(group) {
  const W = PARAMS.shapeW, H = PARAMS.shapeH, D = PARAMS.shapeD, sH = PARAMS.stemHeight;
  // Corner radius — clamped so arcs never exceed 90% of either half-dimension
  const r = Math.max(0, Math.min(PARAMS.cornerRadius ?? 0, W * 0.9, H * 0.9));
  faceLayerGroups = [];

  const fillMat = () => new THREE.MeshBasicMaterial({
    color: new THREE.Color(PARAMS.fillBgColor), side: THREE.DoubleSide,
    depthTest: false, depthWrite: false,
  });

  const addFill = (geo, px, py, pz, rx, ry, rz) => {
    const m = new THREE.Mesh(geo, fillMat());
    m.position.set(px, py, pz);
    m.rotation.set(rx, ry, rz);
    m.renderOrder = 1;
    m.visible = PARAMS.showFill;
    m.userData.isFillColor = true;
    m.userData.isFaceLayerFill = true;
    group.add(m);
    return m;
  };

  const addStroke = (positions) => {
    const arr = new Float32Array(positions);
    const geo = new LineSegmentsGeometry();
    geo.setPositions(arr);
    const l = new LineSegments2(geo, makeEdgeMaterial());
    l.renderOrder = 2;
    l.visible = PARAMS.showFill && PARAMS.showArtwork;
    l.userData.isFaceLayerStroke = true;
    // Save the canonical segment data so drawIn can read it even if the
    // geometry has been mutated to DEGENERATE by a previous animation run.
    l.userData.originalPositions = arr;
    group.add(l);
    return l;
  };

  // Arc helper: quarter-circle line segments in the XY plane at a fixed Z.
  // cx,cy = center; z = depth; startA/endA = angle range; nSegs = subdivision.
  const arcSegs = (cx, cy, z, startA, endA, nSegs = 12) => {
    const pts = [];
    for (let i = 0; i < nSegs; i++) {
      const a0 = startA + (endA - startA) * (i / nSegs);
      const a1 = startA + (endA - startA) * ((i + 1) / nSegs);
      pts.push(
        cx + r * Math.cos(a0), cy + r * Math.sin(a0), z,
        cx + r * Math.cos(a1), cy + r * Math.sin(a1), z,
      );
    }
    return pts;
  };

  // Right face (+X)
  // When r > 0: top-right corner (W,H) is rounded — shorten the verticals and
  // remove the top bar (the corner edge W,H,-D → W,H,D is replaced by arcs).
  const rightFill   = addFill(new THREE.PlaneGeometry(D * 2, H * 2), W, 0, 0, 0, -Math.PI / 2, 0);
  const rightStroke = addStroke([
    ...(r === 0 ? [W, H,-D,  W, H, D] : []),  // top bar — removed when rounded
    W, H - r, D,   W,   -H, D,                 // front vertical (top trimmed)
    W,    -H, D,   W,   -H,-D,                 // bottom
    W,    -H,-D,   W, H - r,-D,                // back vertical (top trimmed)
  ]);
  faceLayerGroups.push({ fill: rightFill, stroke: rightStroke, localNormal: new THREE.Vector3(1, 0, 0) });

  // Top face (+Y)
  // Omit the left edge (-W,H,-D)→(-W,H,D) — it sits on the combined left+stem
  // face plane. When r > 0: right edge removed (replaced by arcs), back/front
  // edges trimmed to W-r.
  const topFill   = addFill(new THREE.PlaneGeometry(W * 2, D * 2), 0, H, 0, Math.PI / 2, 0, 0);
  const topStroke = addStroke([
    W - r, H,-D, -W, H,-D,  // back edge (right end trimmed)
    -W,    H, D, W - r, H, D,  // front edge (right end trimmed)
    ...(r === 0 ? [W, H, D,  W, H,-D] : []),  // right edge — removed when rounded
  ]);
  faceLayerGroups.push({ fill: topFill, stroke: topStroke, localNormal: new THREE.Vector3(0, 1, 0) });

  // Bottom face (-Y)
  // Omit the left edge (-W,-H,-D)→(-W,-H,D) — left+stem verticals mark that boundary.
  // When r > 0: back/front edges trimmed to -W+r (left end).
  const botFill   = addFill(new THREE.PlaneGeometry(W * 2, D * 2), 0, -H, 0, -Math.PI / 2, 0, 0);
  const botStroke = addStroke([
     W,-H,-D, -W + r,-H,-D,  // back edge (left end trimmed)
    -W + r,-H, D,  W,-H, D,  // front edge (left end trimmed)
     W,-H, D,  W,-H,-D,      // right edge
  ]);
  faceLayerGroups.push({ fill: botFill, stroke: botStroke, localNormal: new THREE.Vector3(0, -1, 0) });

  // Combined left face + stem (-X): one rectangle spanning y=-H to y=H+sH
  // heightSegments:2 keeps a vertex row at y=H preventing triangle diagonals.
  // When r > 0: bottom corner (-W,-H) is rounded — shorten the verticals by r,
  // shift the bottom bar up to -H+r, and drop the bottom corner stubs.
  const leftFill   = addFill(
    new THREE.PlaneGeometry(D * 2, 2 * H + sH, 1, 2),
    -W, sH / 2, 0,
    0, -Math.PI / 2, 0
  );
  const eps = 0.001;
  const leftStroke = addStroke([
    // Outer boundary
    -W,  H + sH,-D,  -W, -H + r,-D,  // back vertical (bottom trimmed)
    -W, -H + r,-D,   -W, -H + r, D,  // bottom bar (shifted up by r when r > 0)
    -W, -H + r, D,   -W,  H + sH, D, // front vertical (bottom trimmed)
    -W,  H + sH, D,  -W,  H + sH,-D, // stem top
    // Corner stubs at body-stem junction (y=H): always needed — interior seam cap
    -W + eps, H,-D,  -W, H,-D,
    -W + eps, H, D,  -W, H, D,
    // Bottom corner stubs: only when r===0 (when rounded, the sharp corner is gone)
    ...(r === 0 ? [-W + eps,-H,-D,  -W,-H,-D,  -W + eps,-H, D,  -W,-H, D] : []),
  ]);
  faceLayerGroups.push({ fill: leftFill, stroke: leftStroke, localNormal: new THREE.Vector3(-1, 0, 0) });

  // Corner arc strokes — added when r > 0.
  // Each corner gets arcs at z = -D (back) and z = +D (front).
  // Bisector normals (diagonal) let updateFaceLayerOrders handle depth sorting.
  if (r > 0) {
    // Top-right corner: center (W-r, H-r), arc from 0 → π/2
    const trArc = addStroke([
      ...arcSegs(W - r, H - r, -D, 0, Math.PI / 2),
      ...arcSegs(W - r, H - r,  D, 0, Math.PI / 2),
    ]);
    faceLayerGroups.push({ fill: null, stroke: trArc, localNormal: new THREE.Vector3(0.707, 0.707, 0) });

    // Bottom-left corner: center (-W+r, -H+r), arc from π → 3π/2
    const blArc = addStroke([
      ...arcSegs(-W + r, -H + r, -D, Math.PI, 3 * Math.PI / 2),
      ...arcSegs(-W + r, -H + r,  D, Math.PI, 3 * Math.PI / 2),
    ]);
    faceLayerGroups.push({ fill: null, stroke: blArc, localNormal: new THREE.Vector3(-0.707, -0.707, 0) });
  }

  // Front (+Z) and back (-Z) faces are intentionally left open (no fill) —
  // the 3D depth and inner structure remain visible through those faces.

  // Junction edge between top face (+Y, face 3) and stem (face 7): (-W,H,-D)→(-W,H,D).
  // This is the suppressed crossbar — we want it visible from the UNDERSIDE (when
  // left+stem is back-facing) but hidden in the normal view (when left+stem is front).
  // Visibility is toggled per-frame in updateFaceLayerOrders().
  const cbGeo = new LineSegmentsGeometry();
  cbGeo.setPositions(new Float32Array([-W, H, -D,  -W, H, D]));
  crossbarStroke = new LineSegments2(cbGeo, makeEdgeMaterial());
  crossbarStroke.renderOrder = 4.5; // above all fills+strokes (1–4) when visible
  crossbarStroke.visible = false;
  crossbarStroke.userData.isFaceLayerStroke = true;
  crossbarStroke.userData.isCrossbarStroke  = true;
  group.add(crossbarStroke);
}

// Updates fill/stroke renderOrders each frame based on whether each face normal
// points toward (+Z) or away from (-Z) the camera in world space.
// front: fill=3, stroke=4 — back: fill=1, stroke=2.
function updateFaceLayerOrders() {
  if (!loadedObject || !PARAMS.showFill || faceLayerGroups.length === 0) return;
  const worldQ = new THREE.Quaternion();
  loadedObject.getWorldQuaternion(worldQ);
  const tmp = new THREE.Vector3();
  let leftStemFront = false;
  faceLayerGroups.forEach(({ fill, stroke, localNormal }) => {
    const front = tmp.copy(localNormal).applyQuaternion(worldQ).z > 0;
    if (fill) fill.renderOrder = front ? 3 : 1;
    if (stroke) stroke.renderOrder = front ? 4 : 2;
    // Track left+stem facing for crossbar visibility below
    if (localNormal.x < 0 && localNormal.y === 0 && localNormal.z === 0) leftStemFront = front;
  });
  // Crossbar (stem-box junction): visible only from underside (left+stem back-facing).
  // renderOrder 4.5 — above ALL face-layer fills (1/3) and strokes (2/4) — because
  // the crossbar runs exactly along the top face's left edge. topFill (order 3) would
  // cover it at any lower value. We want it on top of everything when visible.
  if (crossbarStroke) {
    crossbarStroke.visible = PARAMS.showArtwork && !leftStemFront;
    crossbarStroke.renderOrder = 4.5;
  }
}

function updateFill() {
  // Knockout: fill planes use the foreground (stroke) color so faces read as
  // solid shapes; strokes are drawn in the background color and act as thin
  // separator lines between faces. Normal mode is the inverse.
  const planeColor = PARAMS.knockout ? PARAMS.fillColor : PARAMS.fillBgColor;
  loadedObject?.traverse((child) => {
    if (!child.isMesh || child.isLineSegments2) return;
    if (!child.userData.isFillColor) return;
    child.visible = PARAMS.showFill;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    mats.forEach(m => { if (m?.color && m.visible !== false) m.color.setStyle(planeColor); });
  });
  // Swap which stroke set is active: face-layer strokes when fill is ON,
  // regular strokes (meshToLine) when fill is OFF.
  updateArtwork();
}

function updateArtwork() {
  const useLayers  = PARAMS.showFill && faceLayerGroups.length > 0;
  const strokeColor = PARAMS.knockout ? PARAMS.bgColor : PARAMS.fillColor;
  loadedObject?.traverse((child) => {
    if (!child.isLineSegments2) return;
    if (child.userData.isFaceLayerStroke) {
      // Face-layer strokes: active only when fill is ON
      child.material.color.setStyle(strokeColor);
      child.material.linewidth = scaledLinewidth(PARAMS.edgeWeight);
      child.visible = useLayers && PARAMS.showArtwork;
    } else if (child.renderOrder === 0) {
      // Regular artwork strokes: active only when fill is OFF
      child.material.color.setStyle(strokeColor);
      child.material.linewidth = scaledLinewidth(PARAMS.edgeWeight);
      child.visible = !useLayers && PARAMS.showArtwork;
    }
  });
}

function updateEdgeColor() { updateArtwork(); }

function updateEdgeWeight() { updateArtwork(); }

function updateFoundation() {
  loadedObject?.traverse((child) => {
    if (child.isLineSegments2 && child.renderOrder === 1) {
      child.material.color.setStyle(PARAMS.foundationColor);
      child.material.linewidth = scaledLinewidth(PARAMS.foundationWeight);
      child.material.opacity   = PARAMS.foundationOpacity;
      child.visible            = PARAMS.showFoundation;
    }
  });
}

// ─── Multi-viewport helpers ───────────────────────────────────

// Rebuild flat material arrays after any geometry/material change.
// Used by preview rendering to swap colors without traversal per frame.
function collectMaterials() {
  artworkMaterials    = [];
  artworkLines        = [];
  foundationMaterials = [];
  fillMeshMaterials   = [];
  loadedObject?.traverse((child) => {
    if (child.isMesh && !child.isLineSegments2 && child.userData.isFillColor) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach(m => { if (m?.color && m.visible !== false) fillMeshMaterials.push(m); });
    } else if (child.isLineSegments2) {
      // Face-layer strokes use dynamic renderOrders — identify by userData flag.
      if (child.userData.isFaceLayerStroke || child.renderOrder === 0) {
        artworkMaterials.push(child.material);
        artworkLines.push(child);
      } else {
        foundationMaterials.push(child.material);
      }
    }
  });
}

function setCameraAspect(aspect) {
  const fs = FRUSTUM_SIZE / PARAMS.zoom;
  camera.left   = (-fs * aspect) / 2;
  camera.right  = ( fs * aspect) / 2;
  camera.top    =  fs / 2;
  camera.bottom = -fs / 2;
  camera.updateProjectionMatrix();
}

// Temporarily override all line colors for a preview render.
function applySchemeColors(stroke) {
  const c = new THREE.Color(stroke);
  artworkMaterials.forEach(m    => { if (m) m.color.copy(c); });
  foundationMaterials.forEach(m => { if (m) m.color.copy(c); });
}

// Restore to the user's chosen colors after a preview render.
function restoreMainColors() {
  const ac = new THREE.Color(PARAMS.knockout ? PARAMS.bgColor : PARAMS.fillColor);
  const fc = new THREE.Color(PARAMS.foundationColor);
  artworkMaterials.forEach(m    => { if (m) m.color.copy(ac); });
  foundationMaterials.forEach(m => { if (m) m.color.copy(fc); });
}

function rebuildEdges() {
  if (!loadedObject) return;
  loadedObject.traverse((child) => {
    if (!child.isMesh || child.isLineSegments2) return;
    const edgesGeo    = new THREE.EdgesGeometry(child.geometry, PARAMS.edgeAngle);
    const hasCombined = child.parent?.userData.hasCombinedStemFill;
    const allPositions = edgesGeo.attributes.position.array;
    const artPositions = child.userData.isStem ? getStemArtworkPositions(child) :
                         child.userData.isBody && (PARAMS.hideBodyCrossbar || hasCombined) ? getBodyArtworkPositions(child) :
                         allPositions;

    const line = meshToLine.get(child);
    if (line) {
      const newGeo = new LineSegmentsGeometry();
      newGeo.setPositions(artPositions);
      line.geometry.dispose();
      line.geometry = newGeo;
    }

    const found = meshToFoundation.get(child);
    if (found) {
      const newGeo = new LineSegmentsGeometry();
      newGeo.setPositions(allPositions);
      found.geometry.dispose();
      found.geometry = newGeo;
    }
  });
}

// ─── Default logo ─────────────────────────────────────────────

function buildDefaultGroup() {
  const dummy = new THREE.MeshBasicMaterial({ visible: false });
  const W = PARAMS.shapeW, H = PARAMS.shapeH, D = PARAMS.shapeD;
  const body = new THREE.Mesh(new THREE.BoxGeometry(W * 2, H * 2, D * 2), dummy);
  body.userData.isBody = true;
  // Fill is handled by individual PlaneGeometry meshes per face (buildBodyFaceFill)
  // to avoid BoxGeometry's triangle-seam artifact. Left/front/back faces are excluded.
  body.userData.hideFill = true;
  // Stem sits on the YZ plane at x = -W (the left face of the box).
  // Its width spans the full depth of the box (D*2) so it lines up flush.
  const stem = new THREE.Mesh(new THREE.PlaneGeometry(D * 2, PARAMS.stemHeight), dummy);
  stem.rotation.y = -Math.PI / 2;
  stem.position.set(-W, H + PARAMS.stemHeight / 2, 0);
  stem.userData.isStem = true;
  // Stem fill is handled by the combined left+stem fill plane — skip per-mesh fill.
  stem.userData.hideFill = true;
  const group = new THREE.Group();
  group.userData.hasCombinedStemFill = true;
  group.userData.hasBodyFills = true;
  group.add(body, stem);
  return group;
}

function loadDefaultLogo() {
  clearScene();
  isSVGLoaded = false; cachedSVGPaths = null;
  extrusionBinding.hidden = true;
  stemBinding.hidden = false;

  loadedObject = buildDefaultGroup();
  centerAndFit(loadedObject);
  applyEdgeMode(loadedObject);
  updateFill();
  mountIntoScene();
  resetTransformState(false);
  info.value = '6th Street Logo';
}

function rebuildDefaultLogo() {
  if (isSVGLoaded || !poseGroup) return;
  poseGroup.remove(loadedObject);
  loadedObject = buildDefaultGroup();
  centerAndFit(loadedObject);
  applyEdgeMode(loadedObject);
  updateFill();
  applyPivotOffset();
  poseGroup.add(loadedObject);

  // Rebuild face grids only when W or H actually change — not every D update
  if (PARAMS.shapeW !== _faceGridW || PARAMS.shapeH !== _faceGridH || !faceGridGroup) {
    if (faceGridGroup) poseGroup.remove(faceGridGroup);
    faceGridGroup = buildFaceGrids();
    poseGroup.add(faceGridGroup);
    _faceGridW = PARAMS.shapeW;
    _faceGridH = PARAMS.shapeH;
  }
}

// ─── File loading ─────────────────────────────────────────────

function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const content = e.target.result;
    if (file.name.toLowerCase().endsWith('.svg'))      loadSVG(content, file.name);
    else if (file.name.toLowerCase().endsWith('.obj')) loadOBJ(content, file.name);
  };
  reader.readAsText(file);
}

function loadOBJ(content, fileName) {
  clearScene();
  isSVGLoaded = false; cachedSVGPaths = null;
  extrusionBinding.hidden = true; stemBinding.hidden = true;
  try {
    loadedObject = new OBJLoader().parse(content);
    centerAndFit(loadedObject);
    applyEdgeMode(loadedObject);
    mountIntoScene();
    resetTransformState(false);
    info.value = `Loaded: ${fileName}`;
  } catch (err) { info.value = `Error: ${err.message}`; }
}

function loadSVG(content, fileName) {
  clearScene();
  isSVGLoaded = true;
  try {
    cachedSVGPaths = new SVGLoader().parse(content).paths;
    loadedObject   = buildSVGGroup(cachedSVGPaths, PARAMS.extrusionDepth);
    extrusionBinding.hidden = false; stemBinding.hidden = true;
    mountIntoScene();
    resetTransformState(true);
    info.value = `Loaded: ${fileName}`;
  } catch (err) { info.value = `Error: ${err.message}`; }
}

function buildSVGGroup(paths, depth) {
  const dummy = new THREE.MeshBasicMaterial({ visible: false });
  const group  = new THREE.Group();
  paths.forEach((path) => {
    SVGLoader.createShapes(path).forEach((shape) => {
      group.add(new THREE.Mesh(
        new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }), dummy
      ));
    });
  });
  centerAndFit(group);
  applyEdgeMode(group);
  return group;
}

function centerAndFit(object) {
  const box    = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size   = box.getSize(new THREE.Vector3());
  const s      = 1.5 / Math.max(size.x, size.y, size.z);
  object.position.copy(center).multiplyScalar(-s);
  object.scale.setScalar(s);
}

// ─── Scene mounting ───────────────────────────────────────────

function clearScene() {
  if (animGroup) {
    scene.remove(animGroup);
    animGroup = null; poseGroup = null; loadedObject = null; faceGridGroup = null;
    currentAnim = null; _faceGridW = null; _faceGridH = null;
  }
}

function mountIntoScene() {
  // poseGroup holds the shape + pivot offset
  poseGroup = new THREE.Group();
  applyPivotOffset();
  poseGroup.add(loadedObject);

  // Face-aligned reference grids rotate with the model
  faceGridGroup = buildFaceGrids();
  poseGroup.add(faceGridGroup);
  _faceGridW = PARAMS.shapeW;
  _faceGridH = PARAMS.shapeH;

  // animGroup is the animation / scale / pan target
  animGroup = new THREE.Group();
  animGroup.add(poseGroup);
  scene.add(animGroup);
}

// ─── Transform sync ───────────────────────────────────────────

function resetTransformState(isSVG) {
  if (currentAnim?.active) { currentAnim.cancel(makeAnimCtx()); currentAnim = null; }
  // For SVG, force a top-down view. For the default logo, preserve PARAMS
  // rotation (already set to the preset defaults) — don't zero it out.
  if (isSVG) {
    PARAMS.rotX = -90; PARAMS.rotY = PARAMS.rotZ = 0;
  }
  PARAMS.panX = PARAMS.panY = 0;
  pane.refresh();
  syncPose();
  if (animGroup) {
    animGroup.position.set(0, 0, 0);
    animGroup.rotation.set(0, 0, 0);
  }
}

// syncPose: applies rotX/Y/Z to poseGroup (static shape orientation)
// Uses 'YXZ' Euler order — yaw first, most intuitive for screen-space.
function syncPose() {
  if (!poseGroup) return;
  poseGroup.quaternion.setFromEuler(
    new THREE.Euler(PARAMS.rotX * DEG2RAD, PARAMS.rotY * DEG2RAD, PARAMS.rotZ * DEG2RAD, 'YXZ')
  );
}

function rebuildShape() {
  if (!isSVGLoaded) rebuildDefaultLogo();
}

function syncPivot() { applyPivotOffset(); }

function applyPivotOffset() {
  if (loadedObject) loadedObject.position.set(-PARAMS.pivotX, -PARAMS.pivotY, -PARAMS.pivotZ);
}

function rebuildSVGGeometry() {
  if (!isSVGLoaded || !cachedSVGPaths || !poseGroup) return;
  poseGroup.remove(loadedObject);
  loadedObject = buildSVGGroup(cachedSVGPaths, PARAMS.extrusionDepth);
  applyPivotOffset();
  poseGroup.add(loadedObject);
}

// ─── Mouse / keyboard ─────────────────────────────────────────

function setupMouseControls() {
  renderer.domElement.addEventListener('mousedown', onMouseDown);
  renderer.domElement.addEventListener('mousemove', onMouseMove);
  renderer.domElement.addEventListener('mouseup',   onMouseUp);
  renderer.domElement.addEventListener('wheel', onMouseWheel, { passive: false });
  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup',   onKeyUp);
}

function onKeyDown(e) {
  if (e.shiftKey) shiftPressed = true;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
  }
  if (!mod) {
    const anims = { '1': spinForward, '2': spinReverse, '3': axisFlip,
                    '4': scaleEntrance, '5': extrudeFromFlat, '6': drawIn };
    if (anims[e.key]) triggerAnimation(anims[e.key]);
  }
}

function onKeyUp(e) {
  if (!e.shiftKey) { shiftPressed = false; isPanning = false; }
}

function onMouseDown(e) {
  if (e.button === 0) {
    if (shiftPressed) isPanning = true; else isDragging = true;
  } else if (e.button === 2) {
    isPanning = true;
  }
  previousMousePosition = { x: e.clientX, y: e.clientY };
}

function onMouseMove(e) {
  if (!poseGroup) return;
  const dx = e.clientX - previousMousePosition.x;
  const dy = e.clientY - previousMousePosition.y;

  if (isDragging) {
    // Drag rotates poseGroup in world space — always maps to screen axes
    // regardless of current orientation.
    const qY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * 0.01);
    const qX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * 0.01);
    poseGroup.quaternion.premultiply(qY).premultiply(qX);

    const euler = new THREE.Euler().setFromQuaternion(poseGroup.quaternion, 'YXZ');
    PARAMS.rotX = euler.x / DEG2RAD;
    PARAMS.rotY = euler.y / DEG2RAD;
    PARAMS.rotZ = euler.z / DEG2RAD;
    rotXBinding.refresh();
    rotYBinding.refresh();
    rotZBinding.refresh();
  } else if (isPanning) {
    const panSpeed = 0.01;
    PARAMS.panX += dx * panSpeed;
    PARAMS.panY -= dy * panSpeed;
    animGroup.position.set(PARAMS.panX, PARAMS.panY, 0);
  }

  previousMousePosition = { x: e.clientX, y: e.clientY };
}

function onMouseUp() {
  if (isDragging || isPanning) commitSnapshot();
  isDragging = false;
  if (!shiftPressed) isPanning = false;
}

function onMouseWheel(e) {
  e.preventDefault(); // prevent page scroll, but no zoom
}

// ─── Actions ──────────────────────────────────────────────────

function resetView() {
  if (currentAnim?.active) { currentAnim.cancel(makeAnimCtx()); currentAnim = null; }
  commitSnapshot();
  PARAMS.rotX = isSVGLoaded ? -90 : DEFAULT_ROT_X;
  PARAMS.rotY = isSVGLoaded ? 0 : DEFAULT_ROT_Y;
  PARAMS.rotZ = isSVGLoaded ? 0 : DEFAULT_ROT_Z;
  PARAMS.panX = PARAMS.panY = 0;
  PARAMS.pivotX = PARAMS.pivotY = PARAMS.pivotZ = 0;
  pane.refresh();
  if (animGroup) {
    animGroup.position.set(0, 0, 0);
    animGroup.scale.set(1, 1, 1);
    animGroup.rotation.set(0, 0, 0);
    syncPose();
    applyPivotOffset();
  }
  commitSnapshot();
  info.value = 'View reset';
}

function downloadScreenshot() {
  const cw = canvasRef.value.clientWidth;
  const ch = canvasRef.value.clientHeight;
  const N = PREVIEW_SCHEMES.length;
  const STRIP_H = PARAMS.showPreviews ? Math.round(Math.min(220, cw / N)) : 0;
  const MAIN_H  = ch - STRIP_H;
  const dpr     = window.devicePixelRatio;

  // Render only the main viewport (same scissor rect as animate()).
  renderer.setScissorTest(true);
  renderer.setViewport(0, STRIP_H, cw, MAIN_H);
  renderer.setScissor(0, STRIP_H, cw, MAIN_H);
  setCameraAspect(cw / MAIN_H);
  renderer.render(scene, camera);
  renderer.setScissorTest(false);

  // The main viewport lives at the TOP of the WebGL canvas in 2D coords
  // (GL y=STRIP_H from bottom → canvas y=0 from top because MAIN_H + STRIP_H = ch).
  // Copy just that region to a temporary canvas, then export it.
  const pw = Math.round(cw   * dpr);
  const ph = Math.round(MAIN_H * dpr);
  const tmp = document.createElement('canvas');
  tmp.width  = pw;
  tmp.height = ph;
  tmp.getContext('2d').drawImage(renderer.domElement, 0, 0, pw, ph, 0, 0, pw, ph);

  const link = document.createElement('a');
  link.href = tmp.toDataURL('image/png');
  link.download = `sixth-street-${Date.now()}.png`;
  link.click();
  info.value = 'PNG saved';
}

function downloadSVG() {
  if (!loadedObject) return;
  const cw = canvasRef.value.clientWidth;
  const ch = canvasRef.value.clientHeight;
  // Use main viewport dimensions only (exclude preview strip) so projection
  // matches exactly what the camera sees — prevents vertical stretch.
  const w = cw;
  const h = PARAMS.showPreviews
    ? ch - Math.round(Math.min(220, cw / PREVIEW_SCHEMES.length))
    : ch;
  scene.updateMatrixWorld(true);

  const segments = [];
  loadedObject.traverse((child) => {
    if (!child.isLineSegments2) return;
    const instanceStart = child.geometry.attributes.instanceStart;
    const instanceEnd   = child.geometry.attributes.instanceEnd;
    if (!instanceStart) return;
    const mat = child.matrixWorld;
    for (let i = 0; i < instanceStart.count; i++) {
      const p1 = new THREE.Vector3(instanceStart.getX(i), instanceStart.getY(i), instanceStart.getZ(i)).applyMatrix4(mat);
      const p2 = new THREE.Vector3(instanceEnd.getX(i),   instanceEnd.getY(i),   instanceEnd.getZ(i)).applyMatrix4(mat);
      p1.project(camera); p2.project(camera);
      segments.push({
        x1: ((p1.x + 1) / 2 * w).toFixed(2), y1: ((-p1.y + 1) / 2 * h).toFixed(2),
        x2: ((p2.x + 1) / 2 * w).toFixed(2), y2: ((-p2.y + 1) / 2 * h).toFixed(2),
      });
    }
  });

  const lines = segments.map(s => `  <line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}"/>`).join('\n');
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `  <rect width="${w}" height="${h}" fill="${PARAMS.bgColor}"/>`,
    `  <g stroke="${PARAMS.fillColor}" stroke-width="${PARAMS.edgeWeight}" stroke-linecap="round" stroke-linejoin="round">`,
    lines, `  </g>`, `</svg>`,
  ].join('\n');

  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `sixth-street-${Date.now()}.svg`;
  link.click(); URL.revokeObjectURL(url);
  info.value = 'SVG exported';
}

function downloadPreset() {
  const blob = new Blob([JSON.stringify(PARAMS, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `preset-${Date.now()}.json`;
  link.click(); URL.revokeObjectURL(url);
  info.value = 'Preset downloaded';
}

// ─── Triggered animations ─────────────────────────────────────
// Animation modules live in src/animations/. Use triggerAnimation(module) to run one.

// ─── Render loop ──────────────────────────────────────────────

function animate() {
  animationFrameId = requestAnimationFrame(animate);

  const now = performance.now();
  const dt  = lastFrameTime ? Math.min((now - lastFrameTime) / 1000, 0.05) : 0;
  lastFrameTime = now;

  if (currentAnim?.active) currentAnim.step(makeAnimCtx(), dt);
  updateFaceLayerOrders();

  const cw = canvasRef.value.clientWidth;
  const ch = canvasRef.value.clientHeight;

  if (!PARAMS.showPreviews) {
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, cw, ch);
    setCameraAspect(cw / ch);
    renderer.render(scene, camera);
    return;
  }

  // Preview strip height: one cell wide = cw/4, capped at 220px.
  const N       = PREVIEW_SCHEMES.length;
  const STRIP_H = Math.round(Math.min(220, cw / N));
  const MAIN_H  = ch - STRIP_H;
  const cellW   = Math.round(cw / N);

  renderer.setScissorTest(true);

  // ── Main viewport (top portion) ──────────────────────────────
  renderer.setViewport(0, STRIP_H, cw, MAIN_H);
  renderer.setScissor(0, STRIP_H, cw, MAIN_H);
  setCameraAspect(cw / MAIN_H);
  renderer.render(scene, camera);

  // ── Preview cells (bottom strip) ─────────────────────────────
  // Hide grid + set resolution to cell size so line weight is proportional.
  if (gridGroup)     gridGroup.visible     = false;
  if (faceGridGroup) faceGridGroup.visible = false;
  const allLineMats = [...artworkMaterials, ...foundationMaterials];
  allLineMats.forEach(m => m.resolution?.set(cellW, STRIP_H));
  // LineMaterial.linewidth is in screen-space pixels. The preview strip is
  // shorter than the main viewport, so the logo appears smaller while the
  // stroke stays the same absolute pixel width — making it look too heavy.
  // Scale linewidth by the height ratio to keep strokes visually proportional.
  const wScale = STRIP_H / MAIN_H;
  artworkMaterials.forEach(m    => { if (m) m.linewidth = scaledLinewidth(PARAMS.edgeWeight)       * wScale; });
  foundationMaterials.forEach(m => { if (m) m.linewidth = scaledLinewidth(PARAMS.foundationWeight) * wScale; });

  PREVIEW_SCHEMES.forEach(({ bg, stroke }, i) => {
    const x = i * cellW;
    const w = (i === N - 1) ? cw - x : cellW;
    renderer.setViewport(x, 0, w, STRIP_H);
    renderer.setScissor(x, 0, w, STRIP_H);
    setCameraAspect(w / STRIP_H);

    const savedBg = scene.background.getHex();
    scene.background.setStyle(bg);
    applySchemeColors(stroke);
    // Fill mesh color should match each cell's bg color, not PARAMS.bgColor
    const fillBg = new THREE.Color(bg);
    fillMeshMaterials.forEach(m => { if (m) m.color.copy(fillBg); });

    renderer.render(scene, camera);

    scene.background.setHex(savedBg);
  });

  // Restore grid, resolution, linewidths, colors, camera
  if (gridGroup)     gridGroup.visible     = PARAMS.showGrid;
  if (faceGridGroup) faceGridGroup.visible = PARAMS.showGrid;
  allLineMats.forEach(m => m.resolution?.set(cw, MAIN_H));
  artworkMaterials.forEach(m    => { if (m) m.linewidth = scaledLinewidth(PARAMS.edgeWeight); });
  foundationMaterials.forEach(m => { if (m) m.linewidth = scaledLinewidth(PARAMS.foundationWeight); });
  restoreMainColors();
  const mainFillBg = new THREE.Color(PARAMS.knockout ? PARAMS.fillColor : PARAMS.fillBgColor);
  fillMeshMaterials.forEach(m => { if (m) m.color.copy(mainFillBg); });
  scene.background.setStyle(PARAMS.bgColor);
  setCameraAspect(cw / MAIN_H);
  renderer.setScissorTest(false);
}

function onWindowResize() {
  updateStripHeight();
  const w = canvasRef.value.clientWidth;
  const h = canvasRef.value.clientHeight;
  renderer.setSize(w, h);
  const mainH = PARAMS.showPreviews
    ? h - Math.round(Math.min(220, w / PREVIEW_SCHEMES.length))
    : h;
  setCameraAspect(w / mainH);
  loadedObject?.traverse((child) => {
    if (!child.isLineSegments2) return;
    child.material.resolution?.set(w, mainH);
    if (child.userData.isFaceLayerStroke || child.renderOrder === 0) child.material.linewidth = scaledLinewidth(PARAMS.edgeWeight);
    else if (child.renderOrder === 1) child.material.linewidth = scaledLinewidth(PARAMS.foundationWeight);
  });
}
</script>

<style scoped>
.viewer-container {
  position: relative;
  display: flex;
  flex-direction: row;
  gap: 10px;
  width: 100%;
  height: 100vh;
  background: #111111;
  padding: 10px;
  box-sizing: border-box;
  --strip-h: 0px;
}

/* ── Left: canvas panels ───────────────────────────── */
.viewer-left {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 100%;
}
.canvas-container {
  width: 100%;
  height: 100%;
  border-radius: 12px;
  overflow: hidden;
}

/* Gap between main viewport and preview strip */
.panel-divider {
  position: absolute;
  left: 0;
  right: 0;
  bottom: var(--strip-h);
  height: 8px;
  background: #111111;
  z-index: 1;
  pointer-events: none;
}
.panel-divider::before,
.panel-divider::after {
  content: '';
  position: absolute;
  top: -12px;
  width: 12px;
  height: calc(100% + 24px);
  pointer-events: none;
}
.panel-divider::before {
  left: 0;
  background:
    radial-gradient(circle at 100% 0%,   transparent 12px, #111111 12px) 0 0    / 12px 12px no-repeat,
    radial-gradient(circle at 100% 100%, transparent 12px, #111111 12px) 0 100% / 12px 12px no-repeat;
}
.panel-divider::after {
  right: 0;
  background:
    radial-gradient(circle at 0% 0%,   transparent 12px, #111111 12px) 100% 0    / 12px 12px no-repeat,
    radial-gradient(circle at 0% 100%, transparent 12px, #111111 12px) 100% 100% / 12px 12px no-repeat;
}

/* ── Right: Tweakpane + palette panel ──────────────── */
.viewer-right {
  width: 260px;
  flex-shrink: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #1c1c1c;
  border-radius: 12px;
  overflow: hidden;
}

.palette-panel {
  padding: 12px 12px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  flex-shrink: 0;
}
.palette-label {
  font-size: 10px;
  font-family: sans-serif;
  color: rgba(255, 255, 255, 0.35);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 8px;
}
.palette-swatches {
  display: flex;
  gap: 6px;
}
.palette-swatch {
  flex: 1;
  aspect-ratio: 1;
  border-radius: 6px;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
  transition: border-color 0.12s, transform 0.1s;
}
.palette-swatch:hover {
  border-color: rgba(255, 255, 255, 0.5);
  transform: scale(1.08);
}

.pane-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}
.pane-container :deep(.tp-dfwv) {
  width: 100% !important;
  border-radius: 0;
}

/* ── Info bar ──────────────────────────────────────── */
.info-bar {
  position: absolute;
  bottom: 12px;
  left: 12px;
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(4px);
  border-radius: 6px;
  font-size: 12px;
  font-family: sans-serif;
  color: rgba(255, 255, 255, 0.5);
  pointer-events: none;
}
</style>
