<template>
  <div class="viewer-container">
    <div ref="canvas" class="canvas-container"></div>
    <div class="controls-panel">
      <div class="control-group">
        <h3>File Upload</h3>
        <input
          type="file"
          accept=".obj"
          @change="handleFileUpload"
          class="file-input"
        />
      </div>

      <div class="control-group">
        <h3>Transform Controls</h3>
        <div class="control-row">
          <label>Rotation X:</label>
          <input
            v-model.number="rotation.x"
            type="range"
            min="0"
            max="360"
            step="1"
            @input="updateRotation"
            class="slider"
          />
          <span class="value">{{ rotation.x.toFixed(0) }}°</span>
        </div>
        <div class="control-row">
          <label>Rotation Y:</label>
          <input
            v-model.number="rotation.y"
            type="range"
            min="0"
            max="360"
            step="1"
            @input="updateRotation"
            class="slider"
          />
          <span class="value">{{ rotation.y.toFixed(0) }}°</span>
        </div>
        <div class="control-row">
          <label>Rotation Z:</label>
          <input
            v-model.number="rotation.z"
            type="range"
            min="0"
            max="360"
            step="1"
            @input="updateRotation"
            class="slider"
          />
          <span class="value">{{ rotation.z.toFixed(0) }}°</span>
        </div>
        <div class="control-row">
          <label>Scale:</label>
          <input
            v-model.number="scale"
            type="range"
            min="0.1"
            max="5"
            step="0.1"
            @input="updateScale"
            class="slider"
          />
          <span class="value">{{ scale.toFixed(1) }}x</span>
        </div>
      </div>

      <div class="control-group">
        <h3>Actions</h3>
        <button @click="resetView" class="btn btn-secondary">Reset View</button>
        <button @click="downloadScreenshot" class="btn btn-primary"
          >Download Screenshot</button
        >
      </div>

      <div class="info">
        <p>{{ info }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

const canvas = ref(null);
let scene, camera, renderer, controls, loadedObject;

const rotation = ref({ x: 0, y: 0, z: 0 });
const scale = ref(1);
const info = ref("Load an OBJ file to get started");

let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };

onMounted(() => {
  initThreeScene();
  window.addEventListener("resize", onWindowResize);
});

function initThreeScene() {
  // Scene setup
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f5f5);

  // Camera
  camera = new THREE.PerspectiveCamera(
    75,
    canvas.value.clientWidth / canvas.value.clientHeight,
    0.1,
    1000
  );
  camera.position.set(0, 0, 2);
  camera.lookAt(0, 0, 0);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(canvas.value.clientWidth, canvas.value.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  canvas.value.appendChild(renderer.domElement);

  // Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(5, 10, 7);
  directionalLight.castShadow = true;
  directionalLight.shadow.camera.left = -10;
  directionalLight.shadow.camera.right = 10;
  directionalLight.shadow.camera.top = 10;
  directionalLight.shadow.camera.bottom = -10;
  scene.add(directionalLight);

  // Grid helper
  const gridHelper = new THREE.GridHelper(10, 10, 0xcccccc, 0xeeeeee);
  scene.add(gridHelper);

  // Simple orbit controls via mouse
  setupMouseControls();

  // Animation loop
  animate();
}

function setupMouseControls() {
  renderer.domElement.addEventListener("mousedown", onMouseDown);
  renderer.domElement.addEventListener("mousemove", onMouseMove);
  renderer.domElement.addEventListener("mouseup", onMouseUp);
}

function onMouseDown(e) {
  isDragging = true;
  previousMousePosition = { x: e.clientX, y: e.clientY };
}

function onMouseMove(e) {
  if (!isDragging || !loadedObject) return;

  const deltaX = e.clientX - previousMousePosition.x;
  const deltaY = e.clientY - previousMousePosition.y;

  // Rotate object based on mouse movement
  loadedObject.rotation.y += deltaX * 0.01;
  loadedObject.rotation.x += deltaY * 0.01;

  // Update the rotation values
  rotation.value.x = (loadedObject.rotation.x * 180) / Math.PI;
  rotation.value.y = (loadedObject.rotation.y * 180) / Math.PI;
  rotation.value.z = (loadedObject.rotation.z * 180) / Math.PI;

  previousMousePosition = { x: e.clientX, y: e.clientY };
}

function onMouseUp() {
  isDragging = false;
}

function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const objContent = e.target.result;
    loadOBJ(objContent, file.name);
  };
  reader.readAsText(file);
}

function loadOBJ(objContent, fileName) {
  // Remove previous object
  if (loadedObject) {
    scene.remove(loadedObject);
  }

  const loader = new OBJLoader();
  try {
    loadedObject = loader.parse(objContent);

    // Center the object
    const box = new THREE.Box3().setFromObject(loadedObject);
    const center = box.getCenter(new THREE.Vector3());
    loadedObject.position.sub(center);

    // Scale to fit view
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale_factor = 1.5 / maxDim;
    loadedObject.scale.multiplyScalar(scale_factor);

    // Add material if not present
    loadedObject.traverse((child) => {
      if (child.isMesh) {
        if (!child.material) {
          child.material = new THREE.MeshPhongMaterial({
            color: 0x6366f1,
            specular: 0x111111,
            shininess: 200,
          });
        }
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    scene.add(loadedObject);
    rotation.value = { x: 0, y: 0, z: 0 };
    scale.value = 1;
    info.value = `Loaded: ${fileName}`;
  } catch (error) {
    info.value = `Error loading file: ${error.message}`;
    console.error("Error loading OBJ:", error);
  }
}

function updateRotation() {
  if (loadedObject) {
    loadedObject.rotation.x = (rotation.value.x * Math.PI) / 180;
    loadedObject.rotation.y = (rotation.value.y * Math.PI) / 180;
    loadedObject.rotation.z = (rotation.value.z * Math.PI) / 180;
  }
}

function updateScale() {
  if (loadedObject) {
    loadedObject.scale.set(scale.value, scale.value, scale.value);
  }
}

function resetView() {
  rotation.value = { x: 0, y: 0, z: 0 };
  scale.value = 1;
  if (loadedObject) {
    loadedObject.rotation.set(0, 0, 0);
    loadedObject.scale.set(1, 1, 1);
  }
  info.value = "View reset";
}

function downloadScreenshot() {
  renderer.render(scene, camera);
  const canvas_elem = renderer.domElement;
  const link = document.createElement("a");
  link.href = canvas_elem.toDataURL("image/png");
  link.download = `screenshot-${Date.now()}.png`;
  link.click();
  info.value = "Screenshot downloaded!";
}

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

function onWindowResize() {
  const width = canvas.value.clientWidth;
  const height = canvas.value.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}
</script>

<style scoped>
.viewer-container {
  display: flex;
  width: 100%;
  height: 100vh;
  gap: 20px;
  padding: 20px;
  background-color: #f9f9f9;
}

.canvas-container {
  flex: 1;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  background-color: #ffffff;
}

.controls-panel {
  width: 300px;
  background-color: #ffffff;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  overflow-y: auto;
  max-height: 100vh;
}

.control-group {
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid #e5e7eb;
}

.control-group:last-child {
  border-bottom: none;
}

.control-group h3 {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  color: #374151;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.control-row {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
  gap: 8px;
}

.control-row label {
  min-width: 90px;
  font-size: 13px;
  color: #6b7280;
  font-weight: 500;
}

.slider {
  flex: 1;
  height: 4px;
  cursor: pointer;
  appearance: none;
  background: #e5e7eb;
  outline: none;
  border-radius: 2px;
}

.slider::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #6366f1;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #6366f1;
  cursor: pointer;
  border: none;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.value {
  min-width: 40px;
  text-align: right;
  font-size: 12px;
  color: #9ca3af;
  font-weight: 500;
}

.file-input {
  display: block;
  width: 100%;
  padding: 8px;
  margin-bottom: 8px;
  border: 2px solid #e5e7eb;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.2s;
}

.file-input:hover {
  border-color: #6366f1;
}

.btn {
  width: 100%;
  padding: 10px 16px;
  margin-bottom: 8px;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background-color: #6366f1;
  color: white;
}

.btn-primary:hover {
  background-color: #4f46e5;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.3);
}

.btn-secondary {
  background-color: #e5e7eb;
  color: #374151;
}

.btn-secondary:hover {
  background-color: #d1d5db;
  transform: translateY(-1px);
}

.info {
  margin-top: 16px;
  padding: 12px;
  background-color: #f3f4f6;
  border-radius: 4px;
  font-size: 12px;
  color: #6b7280;
  line-height: 1.5;
}

.info p {
  margin: 0;
}

@media (max-width: 1024px) {
  .viewer-container {
    flex-direction: column;
    height: auto;
    min-height: 100vh;
  }

  .controls-panel {
    width: 100%;
    max-height: none;
  }

  .canvas-container {
    height: 500px;
  }
}
</style>
