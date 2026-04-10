#!/usr/bin/env node

/**
 * Generate a 3D hexagonal geometric logo
 * Based on the Sixth Street design - a hexagon made of triangular faces with 3D depth
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class OBJBuilder {
  constructor() {
    this.vertices = [];
    this.faces = [];
    this.vertexIndex = 0;
  }

  addVertex(x, y, z) {
    this.vertices.push({ x, y, z });
    return ++this.vertexIndex;
  }

  addFace(v1, v2, v3) {
    this.faces.push({ v1, v2, v3 });
  }

  toOBJ() {
    let obj = '# Sixth Street Geometric Logo\n';
    obj += '# 3D Hexagonal Structure with Triangular Faces\n\n';

    this.vertices.forEach(v => {
      obj += `v ${v.x.toFixed(4)} ${v.y.toFixed(4)} ${v.z.toFixed(4)}\n`;
    });

    obj += '\n';

    this.faces.forEach(f => {
      obj += `f ${f.v1} ${f.v2} ${f.v3}\n`;
    });

    return obj;
  }

  save(filename) {
    fs.writeFileSync(filename, this.toOBJ());
    console.log(`✓ Logo saved to ${filename}`);
  }
}

const builder = new OBJBuilder();

// Create a hexagon grid structure with depth
// This creates the 3D geometric box shape similar to your Figma design

const depth = 0.8;
const scale = 1.2;

// Define the hexagon vertices for front and back faces
const hexVerts = [
  // Front face (z = 0)
  { x: 0, y: 2 * scale, z: 0 },           // top
  { x: 1.73 * scale, y: 1 * scale, z: 0 }, // top-right
  { x: 1.73 * scale, y: -1 * scale, z: 0 }, // bottom-right
  { x: 0, y: -2 * scale, z: 0 },          // bottom
  { x: -1.73 * scale, y: -1 * scale, z: 0 }, // bottom-left
  { x: -1.73 * scale, y: 1 * scale, z: 0 },  // top-left
];

// Back face vertices (z = depth)
const hexVertsBack = hexVerts.map(v => ({ ...v, z: depth }));

// Create front vertices
const front = hexVerts.map(v => builder.addVertex(v.x, v.y, v.z));
const back = hexVertsBack.map(v => builder.addVertex(v.x, v.y, v.z));

// Center points for depth effect
const frontCenter = builder.addVertex(0, 0, 0);
const backCenter = builder.addVertex(0, 0, depth);

// Front face triangles (pointing to center)
for (let i = 0; i < 6; i++) {
  const curr = front[i];
  const next = front[(i + 1) % 6];
  builder.addFace(curr, frontCenter, next);
}

// Back face triangles
for (let i = 0; i < 6; i++) {
  const curr = back[i];
  const next = back[(i + 1) % 6];
  builder.addFace(backCenter, curr, next);
}

// Side faces connecting front and back
for (let i = 0; i < 6; i++) {
  const f1 = front[i];
  const f2 = front[(i + 1) % 6];
  const b1 = back[i];
  const b2 = back[(i + 1) % 6];
  
  // Two triangles per side
  builder.addFace(f1, f2, b1);
  builder.addFace(f2, b2, b1);
}

// Now add internal triangular structure to match your design
// Create a layered hexagonal grid (similar to the triangular pattern)

function addHexGrid(centerZ, centerFactor = 0.8) {
  const z = centerZ;
  
  // Layer 1 - outer ring points
  const layer1 = [
    builder.addVertex(0, 2 * scale, z),
    builder.addVertex(1.73 * scale, 1 * scale, z),
    builder.addVertex(1.73 * scale, -1 * scale, z),
    builder.addVertex(0, -2 * scale, z),
    builder.addVertex(-1.73 * scale, -1 * scale, z),
    builder.addVertex(-1.73 * scale, 1 * scale, z),
  ];

  // Layer 2 - middle ring
  const layer2 = [
    builder.addVertex(0, 1.15 * scale, z),
    builder.addVertex(1 * scale, 0.57 * scale, z),
    builder.addVertex(1 * scale, -0.57 * scale, z),
    builder.addVertex(0, -1.15 * scale, z),
    builder.addVertex(-1 * scale, -0.57 * scale, z),
    builder.addVertex(-1 * scale, 0.57 * scale, z),
  ];

  // Center
  const center = builder.addVertex(0, 0, z);

  // Create triangular faces for the hexagonal grid
  for (let i = 0; i < 6; i++) {
    const next = (i + 1) % 6;
    // Outer triangles
    builder.addFace(layer1[i], layer1[next], layer2[i]);
    builder.addFace(layer1[next], layer2[next], layer2[i]);
    
    // Inner triangles
    builder.addFace(layer2[i], center, layer2[next]);
    builder.addFace(layer2[i], layer2[next], layer1[next]);
  }
}

// Add internal grid at middle depth
addHexGrid(depth / 2);

// Save the logo
const outputPath = path.join(__dirname, 'public', 'geometric-logo.obj');
builder.save(outputPath);

console.log('\n✨ 3D Geometric Logo created successfully!');
console.log(`Vertices: ${builder.vertices.length}`);
console.log(`Faces: ${builder.faces.length}`);
console.log('\nYou can now load "geometric-logo.obj" in the 3D viewer.');
