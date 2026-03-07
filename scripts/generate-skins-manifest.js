#!/usr/bin/env node

/**
 * Scans public/skins/ for .png files and writes public/skins/index.json.
 * Run before dev/build so new skins are auto-discovered.
 */

const fs = require('fs');
const path = require('path');

const SKINS_DIR = path.join(__dirname, '../public/skins');
const MANIFEST_PATH = path.join(SKINS_DIR, 'index.json');

if (!fs.existsSync(SKINS_DIR)) {
  fs.mkdirSync(SKINS_DIR, { recursive: true });
}

const files = fs.readdirSync(SKINS_DIR);
const existing = fs.existsSync(MANIFEST_PATH)
  ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'))
  : [];
const existingByPath = Object.fromEntries(existing.map((s) => [s.path, s]));

const skins = files
  .filter((f) => f.toLowerCase().endsWith('.png') && !f.includes('-preview'))
  .sort()
  .map((f) => {
    const path_ = `/skins/${f}`;
    const label = f.replace(/\.png$/i, '').replace(/[-_]/g, ' ');
    const prev = existingByPath[path_] || {};
    return { path: path_, label, ...(prev.preview && { preview: prev.preview }) };
  });

fs.writeFileSync(MANIFEST_PATH, JSON.stringify(skins, null, 2), 'utf-8');
console.log('[skins] Manifest updated:', skins.length, 'skin(s)');
