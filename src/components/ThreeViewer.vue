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
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { LineSegments2 }      from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial }        from 'three/examples/jsm/lines/LineMaterial.js';
import { Pane } from 'tweakpane';

const canvasRef    = ref(null);
const fileInputRef = ref(null);
const info         = ref('');

// Three.js
let scene, camera, renderer;
let loadedObject = null;  // geometry group; pivot offset on its .position
let pivotGroup   = null;  // owns: rotation, scale, pan
let animationFrameId = null;

const FRUSTUM_SIZE = 4;

// Interaction
let isDragging = false;
let isPanning  = false;
let previousMousePosition = { x: 0, y: 0 };
let shiftPressed = false;

// Tweakpane
let pane;
let extrusionBinding;
let rotXBinding, rotYBinding, scaleBinding;

const PARAMS = {
  bgColor:        '#0D2929',
  fillColor:      '#F65128',
  edgeWeight:     3,
  extrusionDepth: 5,
  rotX: 0, rotY: 0, rotZ: 0,
  scale: 1,
  pivotX: 0, pivotY: 0, pivotZ: 0,
};

let cachedSVGPaths = null;
let isSVGLoaded    = false;

onMounted(() => {
  initScene();
  initPane();
  window.addEventListener('resize', onWindowResize);
  loadDefaultLogo();
});

onUnmounted(() => {
  cancelAnimationFrame(animationFrameId);
  window.removeEventListener('resize', onWindowResize);
  document.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('keyup', onKeyUp);
  renderer?.dispose();
  pane?.dispose();
});

// ─── Grid guides ──────────────────────────────────────────────
// XY-plane grid that stays fixed in the scene (doesn't orbit with the model).
// Placed at z = -0.5 so it renders behind all geometry.

function createGridGuides() {
  const group = new THREE.Group();
  const dim   = 8;
  const step  = 0.5;
  const Z     = -0.5;

  // Subtle background grid
  const gridPts = [];
  for (let i = -dim; i <= dim; i += step) {
    gridPts.push(new THREE.Vector3(-dim, i,  Z), new THREE.Vector3(dim, i,  Z));
    gridPts.push(new THREE.Vector3(i,  -dim, Z), new THREE.Vector3(i,  dim, Z));
  }
  group.add(new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(gridPts),
    new THREE.LineBasicMaterial({ color: 0x163535, transparent: true, opacity: 0.55 })
  ));

  // Brighter center crosshairs
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

  const matFolder = pane.addFolder({ title: 'Material', expanded: true });

  matFolder
    .addBinding(PARAMS, 'bgColor', { label: 'Background', view: 'color' })
    .on('change', ({ value }) => { scene.background = new THREE.Color(value); });

  matFolder
    .addBinding(PARAMS, 'fillColor', { label: 'Edge Color', view: 'color' })
    .on('change', updateEdgeColor);

  matFolder
    .addBinding(PARAMS, 'edgeWeight', { label: 'Edge Weight', min: 1, max: 100, step: 0.5 })
    .on('change', updateEdgeWeight);

  extrusionBinding = matFolder
    .addBinding(PARAMS, 'extrusionDepth', { label: 'Extrusion', min: 0.1, max: 50, step: 0.5 })
    .on('change', rebuildSVGGeometry);
  extrusionBinding.hidden = true;

  const xfFolder = pane.addFolder({ title: 'Transform', expanded: true });

  rotXBinding = xfFolder
    .addBinding(PARAMS, 'rotX', { label: 'Rot X', min: -180, max: 180, step: 1 })
    .on('change', syncRotation);
  rotYBinding = xfFolder
    .addBinding(PARAMS, 'rotY', { label: 'Rot Y', min: -180, max: 180, step: 1 })
    .on('change', syncRotation);
  xfFolder
    .addBinding(PARAMS, 'rotZ', { label: 'Rot Z', min: -180, max: 180, step: 1 })
    .on('change', syncRotation);
  scaleBinding = xfFolder
    .addBinding(PARAMS, 'scale', { label: 'Scale', min: 0.1, max: 5, step: 0.1 })
    .on('change', ({ value }) => { if (pivotGroup) pivotGroup.scale.setScalar(value); });

  const pivotFolder = pane.addFolder({ title: 'Pivot', expanded: false });
  pivotFolder.addBinding(PARAMS, 'pivotX', { label: 'X', min: -2, max: 2, step: 0.01 }).on('change', syncPivot);
  pivotFolder.addBinding(PARAMS, 'pivotY', { label: 'Y', min: -2, max: 2, step: 0.01 }).on('change', syncPivot);
  pivotFolder.addBinding(PARAMS, 'pivotZ', { label: 'Z', min: -2, max: 2, step: 0.01 }).on('change', syncPivot);

  pane.addButton({ title: 'Reset View' }).on('click', resetView);
  pane.addButton({ title: 'Screenshot' }).on('click', downloadScreenshot);
  pane.addButton({ title: 'Download Preset' }).on('click', downloadPreset);
}

// ─── Edge rendering ───────────────────────────────────────────
// Surfaces are hidden; each mesh's edges are drawn as thick LineSegments2.
// LineMaterial is the only Three.js approach that supports real linewidth.

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

// For every Mesh in the group: hide the surface, add a LineSegments2 sibling
// with the same local transform so it renders the edges at the correct position.
function applyEdgeMode(group) {
  const meshes = [];
  group.traverse((child) => {
    if (child.isMesh && !child.isLineSegments2) meshes.push(child);
  });

  meshes.forEach((mesh) => {
    mesh.visible = false;

    const edgesGeo = new THREE.EdgesGeometry(mesh.geometry);
    const lineGeo  = new LineSegmentsGeometry();
    lineGeo.setPositions(edgesGeo.attributes.position.array);

    const line = new LineSegments2(lineGeo, makeEdgeMaterial());
    line.position.copy(mesh.position);
    line.rotation.copy(mesh.rotation);
    line.scale.copy(mesh.scale);

    mesh.parent.add(line);
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

// ─── Default logo (code geometry) ────────────────────────────

function loadDefaultLogo() {
  clearScene();
  isSVGLoaded    = false;
  cachedSVGPaths = null;
  extrusionBinding.hidden = true;

  // Exact replication of sixth-logo.obj:
  //   - 2×2×2 cube body
  //   - Flat face at x=-1, y=1..3 (the upstroke), z=-1..1
  const dummy = new THREE.MeshBasicMaterial({ visible: false });

  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), dummy);

  const stem = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), dummy);
  stem.rotation.y = -Math.PI / 2; // rotate into the YZ plane, normal facing +X
  stem.position.set(-1, 2, 0);    // left edge of cube, y center at 2 (spans y 1..3)

  loadedObject = new THREE.Group();
  loadedObject.add(body, stem);
  centerAndFit(loadedObject);
  applyEdgeMode(loadedObject);

  mountIntoScene();
  resetTransformState(false);
  info.value = '6th Street Logo';
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

function loadOBJ(objContent, fileName) {
  clearScene();
  isSVGLoaded    = false;
  cachedSVGPaths = null;
  extrusionBinding.hidden = true;

  try {
    loadedObject = new OBJLoader().parse(objContent);
    centerAndFit(loadedObject);
    applyEdgeMode(loadedObject);
    mountIntoScene();
    resetTransformState(false);
    info.value = `Loaded: ${fileName}`;
  } catch (err) {
    info.value = `Error loading file: ${err.message}`;
  }
}

function loadSVG(svgContent, fileName) {
  clearScene();
  isSVGLoaded = true;

  try {
    cachedSVGPaths = new SVGLoader().parse(svgContent).paths;
    loadedObject   = buildSVGGroup(cachedSVGPaths, PARAMS.extrusionDepth);
    extrusionBinding.hidden = false;
    mountIntoScene();
    resetTransformState(true);
    info.value = `Loaded: ${fileName}`;
  } catch (err) {
    info.value = `Error loading SVG: ${err.message}`;
  }
}

function buildSVGGroup(paths, depth) {
  const dummy = new THREE.MeshBasicMaterial({ visible: false });
  const group  = new THREE.Group();

  paths.forEach((path) => {
    SVGLoader.createShapes(path).forEach((shape) => {
      group.add(new THREE.Mesh(
        new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }),
        dummy
      ));
    });
  });

  centerAndFit(group);
  applyEdgeMode(group);
  return group;
}

// Centers and scales the object so its longest axis fits within 1.5 world units.
// Scale is applied first so the translation positions to the post-scale center.
function centerAndFit(object) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size   = box.getSize(new THREE.Vector3());
  const s = 1.5 / Math.max(size.x, size.y, size.z);
  // position = -s * center ensures the scaled shape is centered at world origin
  object.position.copy(center).multiplyScalar(-s);
  object.scale.setScalar(s);
}

// ─── Scene mounting ───────────────────────────────────────────

function clearScene() {
  if (pivotGroup) {
    scene.remove(pivotGroup);
    pivotGroup   = null;
    loadedObject = null;
  }
}

function mountIntoScene() {
  pivotGroup = new THREE.Group();
  applyPivotOffset();
  pivotGroup.add(loadedObject);
  scene.add(pivotGroup);
}

// ─── Transform sync ───────────────────────────────────────────

function resetTransformState(isSVG) {
  PARAMS.rotX = isSVG ? -90 : 0;
  PARAMS.rotY = PARAMS.rotZ = 0;
  PARAMS.scale = 1;
  pane.refresh();
  syncRotation();
}

function syncRotation() {
  if (!pivotGroup) return;
  pivotGroup.rotation.set(
    (PARAMS.rotX * Math.PI) / 180,
    (PARAMS.rotY * Math.PI) / 180,
    (PARAMS.rotZ * Math.PI) / 180
  );
}

function syncPivot() { applyPivotOffset(); }

function applyPivotOffset() {
  if (loadedObject) {
    loadedObject.position.set(-PARAMS.pivotX, -PARAMS.pivotY, -PARAMS.pivotZ);
  }
}

// ─── SVG rebuild ──────────────────────────────────────────────

function rebuildSVGGeometry() {
  if (!isSVGLoaded || !cachedSVGPaths || !pivotGroup) return;
  pivotGroup.remove(loadedObject);
  loadedObject = buildSVGGroup(cachedSVGPaths, PARAMS.extrusionDepth);
  applyPivotOffset();
  pivotGroup.add(loadedObject);
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

function onKeyDown(e) { if (e.shiftKey) shiftPressed = true; }
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
  if (!pivotGroup) return;
  const dx = e.clientX - previousMousePosition.x;
  const dy = e.clientY - previousMousePosition.y;

  if (isDragging) {
    pivotGroup.rotation.y += dx * 0.01;
    pivotGroup.rotation.x += dy * 0.01;
    PARAMS.rotX = (pivotGroup.rotation.x * 180) / Math.PI;
    PARAMS.rotY = (pivotGroup.rotation.y * 180) / Math.PI;
    rotXBinding.refresh();
    rotYBinding.refresh();
  } else if (isPanning) {
    const panSpeed = 0.01 / PARAMS.scale;
    pivotGroup.position.x += dx * panSpeed;
    pivotGroup.position.y -= dy * panSpeed;
  }

  previousMousePosition = { x: e.clientX, y: e.clientY };
}

function onMouseUp() {
  isDragging = false;
  if (!shiftPressed) isPanning = false;
}

function onMouseWheel(e) {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  PARAMS.scale = Math.max(0.1, Math.min(5, PARAMS.scale * factor));
  scaleBinding.refresh();
  if (pivotGroup) pivotGroup.scale.setScalar(PARAMS.scale);
}

// ─── Actions ──────────────────────────────────────────────────

function resetView() {
  PARAMS.rotX = isSVGLoaded ? -90 : 0;
  PARAMS.rotY = PARAMS.rotZ = 0;
  PARAMS.scale = 1;
  PARAMS.pivotX = PARAMS.pivotY = PARAMS.pivotZ = 0;
  pane.refresh();

  if (pivotGroup) {
    pivotGroup.position.set(0, 0, 0);
    pivotGroup.scale.setScalar(1);
    syncRotation();
    applyPivotOffset();
  }
  info.value = 'View reset';
}

function downloadScreenshot() {
  renderer.render(scene, camera);
  const link = document.createElement('a');
  link.href = renderer.domElement.toDataURL('image/png');
  link.download = `screenshot-${Date.now()}.png`;
  link.click();
  info.value = 'Screenshot downloaded!';
}

function downloadPreset() {
  const json = JSON.stringify(PARAMS, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href     = url;
  link.download = `preset-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  info.value = 'Preset downloaded!';
}

// ─── Render loop ──────────────────────────────────────────────

function animate() {
  animationFrameId = requestAnimationFrame(animate);
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

  // LineMaterial uses screen-space resolution for linewidth
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
