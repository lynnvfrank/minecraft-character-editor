#!/usr/bin/env node
/**
 * Packs the Mixamo FBX clips into one binary GLB so the app doesn't ship them as
 * standalone, drop-in reusable FBX files (see docs/ATTRIBUTION-ASSESSMENT.md §2).
 *
 * Source:  assets-src/animations/*.fbx   (not shipped; falls back to public/animations/)
 * Output:  public/animations/animations.glb   (one clip per FBX, clip.name = manifest key)
 *          public/animations/index.json       ({ path, key, label } per clip; path points at the GLB)
 *
 * Usage: node scripts/pack-animations.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_CANDIDATES = [path.join(ROOT, 'assets-src', 'animations'), path.join(ROOT, 'public', 'animations')];
const OUT_DIR = path.join(ROOT, 'public', 'animations');
const OUT_GLB = path.join(OUT_DIR, 'animations.glb');
const OUT_MANIFEST = path.join(OUT_DIR, 'index.json');
const GLB_URL = '/animations/animations.glb';

// GLTFExporter's binary path reads Blobs with FileReader, which Node lacks.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => { this.result = buf; this.onloadend?.(); });
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`;
        this.onloadend?.();
      });
    }
  };
}

/** Same key/label rules as scripts/generate-animations-manifest.js. */
function keyAndLabel(file) {
  const base = file.replace(/\.fbx$/i, '').replace(/-RunningboyRig$/i, '');
  const key = base.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  const label = base.replace(/-/g, ' ');
  return { key, label };
}

const srcDir = SRC_CANDIDATES.find((d) => fs.existsSync(d) && fs.readdirSync(d).some((f) => /\.fbx$/i.test(f)));
if (!srcDir) {
  console.error('[pack-animations] No FBX files found in', SRC_CANDIDATES.join(' or '));
  process.exit(1);
}
const files = fs.readdirSync(srcDir).filter((f) => /\.fbx$/i.test(f)).sort();

const loader = new FBXLoader();
const clips = [];
const manifest = [];
const targetNames = new Set();

for (const file of files) {
  const buf = fs.readFileSync(path.join(srcDir, file));
  const group = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  if (!group.animations.length) {
    console.warn('[pack-animations] No animation in', file);
    continue;
  }
  const { key, label } = keyAndLabel(file);
  const clip = group.animations[0].clone();
  clip.name = key;
  for (const track of clip.tracks) targetNames.add(THREE.PropertyBinding.parseTrackName(track.name).nodeName);
  clips.push(clip);
  manifest.push({ path: GLB_URL, key, label });
}

// A flat set of named nodes is enough: tracks bind by node name and hold local transforms.
const root = new THREE.Group();
root.name = 'AnimationRoot';
for (const name of targetNames) {
  const node = new THREE.Object3D();
  node.name = name;
  root.add(node);
}

const glb = await new GLTFExporter().parseAsync(root, { binary: true, animations: clips, onlyVisible: false });
fs.writeFileSync(OUT_GLB, Buffer.from(glb));
fs.writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
console.log(
  `[pack-animations] ${clips.length} clips from ${path.relative(ROOT, srcDir)} -> ${path.relative(ROOT, OUT_GLB)} ` +
    `(${(glb.byteLength / 1024).toFixed(0)} KB, ${targetNames.size} nodes)`,
);
