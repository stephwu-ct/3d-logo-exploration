<template>
  <div class="viewer-container">
    <div ref="canvasRef" class="canvas-container"></div>
    <input ref="fileInputRef" type="file" accept=".obj,.svg" @change="handleFileUpload" style="display:none" />
    <div v-if="info" class="info-bar">{{ info }}</div>
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

const canvasRef    = ref(null);
const fileInputRef = ref(null);
const info         = ref('');

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
let animationFrameId = null;
let lastFrameTime    = null;

// Spring state — normalized progress (0→1) mapped to actual rotation.
// Works on 0–1 so the same damping/stiffness params feel consistent
// regardless of how many degrees the spin covers.
let spring = {
  progress: 0,
  vel:      0,
  startY:   0,
  targetY:  0,
  active:   false,
};
// stiffness:50 damping:12 → ζ≈0.85, ~0.5% overshoot — slow, weighted
// entrance feel. Comparable to Remotion { stiffness:50, damping:15, mass:1 }.
// ~2s to settle. Right for a logo arriving on load, not a UI micro-interaction.
const SPRING = { stiffness: 50, damping: 12, mass: 1 };

const FRUSTUM_SIZE = 4;
const DEG2RAD      = Math.PI / 180;

// Default pose — matches the saved preset so Reset View returns here.
const DEFAULT_ROT_X = 0, DEFAULT_ROT_Y = 45, DEFAULT_ROT_Z = -45;

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

// ─── PARAMS ───────────────────────────────────────────────────
// Snapshotted keys: everything except animAxis/animSpeed/animPlaying
// (animation state is transient — not part of undo history).
const PARAMS = {
  bgColor:        '#0D2929',
  fillColor:      '#F65128',
  edgeWeight:     9.5,
  edgeAngle:      70,
  extrusionDepth: 5,
  stemHeight:     2,
  // pose (poseGroup)
  rotX: 0, rotY: 45, rotZ: -45,
  // shape dimensions — rebuild geometry on change (W=width, H=height, D=depth)
  shapeW: 1, shapeH: 1, shapeD: 0.75,
  // pan (animGroup position)
  panX: 0, panY: 0,
  // pivot offset (loadedObject)
  pivotX: 0, pivotY: 0, pivotZ: 0,
};

const SNAPSHOT_KEYS = [
  'bgColor','fillColor','edgeWeight','edgeAngle','extrusionDepth','stemHeight',
  'rotX','rotY','rotZ','shapeW','shapeH','shapeD','panX','panY',
  'pivotX','pivotY','pivotZ',
];

let cachedSVGPaths = null;
let isSVGLoaded    = false;
const meshToLine   = new WeakMap();

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
  updateEdgeColor();
  updateEdgeWeight();
  syncPose();
  rebuildShape();
  if (animGroup) animGroup.position.set(PARAMS.panX, PARAMS.panY, 0);
  applyPivotOffset();
  lastSnapshotJson = makeSnapshotJson();
}

// ─── Lifecycle ────────────────────────────────────────────────

onMounted(() => {
  initScene();
  initPane();
  window.addEventListener('resize', onWindowResize);
  loadDefaultLogo();
  commitSnapshot();
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

  scene.add(createGridGuides());
  setupMouseControls();
  animate();
}

// ─── Tweakpane ────────────────────────────────────────────────

function initPane() {
  pane = new Pane({ title: '6th Street Logo' });

  pane.addButton({ title: 'Load File  (OBJ / SVG)' }).on('click', () => {
    fileInputRef.value.click();
  });

  // Material
  const matFolder = pane.addFolder({ title: 'Material', expanded: true });

  matFolder.addBinding(PARAMS, 'bgColor', { label: 'Background', view: 'color' })
    .on('change', ({ value }) => { scene.background = new THREE.Color(value); scheduleSnapshot(); });
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

  // Animations — triggered explorations, each fires a canned animation on animGroup
  const animFolder = pane.addFolder({ title: 'Animations', expanded: true });
  animFolder.addButton({ title: 'Spin 360°' }).on('click', triggerSpin720);

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

function makeEdgeMaterial() {
  return new LineMaterial({
    color:     new THREE.Color(PARAMS.fillColor),
    linewidth: PARAMS.edgeWeight,
    resolution: new THREE.Vector2(
      canvasRef.value?.clientWidth  ?? 1000,
      canvasRef.value?.clientHeight ?? 800
    ),
  });
}

function applyEdgeMode(group) {
  const meshes = [];
  group.traverse((child) => {
    if (child.isMesh && !child.isLineSegments2) meshes.push(child);
  });
  meshes.forEach((mesh) => {
    mesh.visible = false;

    const edgesGeo = new THREE.EdgesGeometry(mesh.geometry, PARAMS.edgeAngle);
    const lineGeo  = new LineSegmentsGeometry();
    lineGeo.setPositions(edgesGeo.attributes.position.array);
    const line = new LineSegments2(lineGeo, makeEdgeMaterial());
    line.position.copy(mesh.position);
    line.rotation.copy(mesh.rotation);
    line.scale.copy(mesh.scale);
    mesh.parent.add(line);
    meshToLine.set(mesh, line);
  });
}

function updateEdgeColor() {
  loadedObject?.traverse((child) => {
    if (child.isLineSegments2) child.material.color.setStyle(PARAMS.fillColor);
  });
}

function updateEdgeWeight() {
  loadedObject?.traverse((child) => {
    if (child.isLineSegments2) child.material.linewidth = PARAMS.edgeWeight;
  });
}

function rebuildEdges() {
  if (!loadedObject) return;
  loadedObject.traverse((child) => {
    if (child.isMesh && !child.isLineSegments2) {
      const line = meshToLine.get(child);
      if (!line) return;
      const edgesGeo = new THREE.EdgesGeometry(child.geometry, PARAMS.edgeAngle);
      const newGeo   = new LineSegmentsGeometry();
      newGeo.setPositions(edgesGeo.attributes.position.array);
      line.geometry.dispose();
      line.geometry = newGeo;
    }
  });
}

// ─── Default logo ─────────────────────────────────────────────

function buildDefaultGroup() {
  const dummy = new THREE.MeshBasicMaterial({ visible: false });
  const W = PARAMS.shapeW, H = PARAMS.shapeH, D = PARAMS.shapeD;
  const body = new THREE.Mesh(new THREE.BoxGeometry(W * 2, H * 2, D * 2), dummy);
  // Stem sits on the YZ plane at x = -W (the left face of the box).
  // Its width spans the full depth of the box (D*2) so it lines up flush.
  const stem = new THREE.Mesh(new THREE.PlaneGeometry(D * 2, PARAMS.stemHeight), dummy);
  stem.rotation.y = -Math.PI / 2;
  stem.position.set(-W, H + PARAMS.stemHeight / 2, 0);
  const group = new THREE.Group();
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
  applyPivotOffset();
  poseGroup.add(loadedObject);
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
    animGroup = null; poseGroup = null; loadedObject = null;
  }
}

function mountIntoScene() {
  // poseGroup holds the shape + pivot offset
  poseGroup = new THREE.Group();
  applyPivotOffset();
  poseGroup.add(loadedObject);

  // animGroup is the animation / scale / pan target
  animGroup = new THREE.Group();
  animGroup.add(poseGroup);
  scene.add(animGroup);
}

// ─── Transform sync ───────────────────────────────────────────

function resetTransformState(isSVG) {
  spring.active = false; spring.vel = 0;
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
  spring.active = false; spring.vel = 0;
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
  renderer.render(scene, camera);
  const link = document.createElement('a');
  link.href = renderer.domElement.toDataURL('image/png');
  link.download = `sixth-street-${Date.now()}.png`;
  link.click();
  info.value = 'PNG saved';
}

function downloadSVG() {
  if (!loadedObject) return;
  const w = canvasRef.value.clientWidth;
  const h = canvasRef.value.clientHeight;
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

// Step the spring one frame forward. Spring operates on normalized
// progress (0 → 1); we map that to actual Y rotation range so damping
// values feel consistent regardless of spin distance.
function stepSpring(dt) {
  const { stiffness, damping, mass } = SPRING;
  const error = spring.progress - 1; // target is always normalized 1
  const force = -stiffness * error - damping * spring.vel;
  spring.vel      += (force / mass) * dt;
  spring.progress += spring.vel * dt;
  animGroup.rotation.y = spring.startY + (spring.targetY - spring.startY) * spring.progress;

  if (Math.abs(error) < 0.0003 && Math.abs(spring.vel) < 0.0003) {
    spring.progress      = 1;
    spring.vel           = 0;
    spring.active        = false;
    animGroup.rotation.y = spring.targetY;
  }
}

function triggerSpin720() {
  if (!animGroup) return;
  spring.startY   = animGroup.rotation.y;
  spring.targetY  = animGroup.rotation.y + Math.PI * 2; // 360°
  spring.progress = 0;
  spring.vel      = 0;
  spring.active   = true;
}

// ─── Render loop ──────────────────────────────────────────────

function animate() {
  animationFrameId = requestAnimationFrame(animate);

  const now = performance.now();
  // Cap dt at 50ms so a tab wake-up doesn't explode the spring
  const dt  = lastFrameTime ? Math.min((now - lastFrameTime) / 1000, 0.05) : 0;
  lastFrameTime = now;

  if (spring.active && animGroup) stepSpring(dt);

  renderer.render(scene, camera);
}

function onWindowResize() {
  const w = canvasRef.value.clientWidth;
  const h = canvasRef.value.clientHeight;
  const aspect = w / h;
  camera.left   = (-FRUSTUM_SIZE * aspect) / 2;
  camera.right  = ( FRUSTUM_SIZE * aspect) / 2;
  camera.top    =   FRUSTUM_SIZE / 2;
  camera.bottom =  -FRUSTUM_SIZE / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  loadedObject?.traverse((child) => {
    if (child.isLineSegments2) child.material.resolution.set(w, h);
  });
}
</script>

<style scoped>
.viewer-container {
  position: relative;
  width: 100%;
  height: 100vh;
}
.canvas-container {
  width: 100%;
  height: 100%;
}
.info-bar {
  position: absolute;
  bottom: 16px;
  left: 16px;
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(4px);
  border-radius: 6px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  pointer-events: none;
}
</style>
