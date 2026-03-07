#!/usr/bin/env node

/**
 * Scans public/animations/ for .fbx files and writes public/animations/index.json.
 * Run before dev/build so new animations are auto-discovered.
 */

const fs = require('fs');
const path = require('path');

const ANIMATIONS_DIR = path.join(__dirname, '../public/animations');
const MANIFEST_PATH = path.join(ANIMATIONS_DIR, 'index.json');

if (!fs.existsSync(ANIMATIONS_DIR)) {
  fs.mkdirSync(ANIMATIONS_DIR, { recursive: true });
}

const files = fs.readdirSync(ANIMATIONS_DIR);
const animations = files
  .filter((f) => f.toLowerCase().endsWith('.fbx'))
  .sort()
  .map((f) => {
    const path_ = `/animations/${f}`;
    // e.g. "Acknowledging-RunningboyRig.fbx" -> key: "acknowledging", label: "Acknowledging"
    const base = f.replace(/\.fbx$/i, '');
    const namePart = base.replace(/-RunningboyRig$/i, '').trim();
    const key = namePart
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .toLowerCase()
      .replace(/\s+/g, '-');
    const label = namePart.replace(/-/g, ' ');
    return { path: path_, key, label };
  });

fs.writeFileSync(MANIFEST_PATH, JSON.stringify(animations, null, 2), 'utf-8');
console.log('[animations] Manifest updated:', animations.length, 'animation(s)');
