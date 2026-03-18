#!/usr/bin/env node

/**
 * Scans public/wardrobe/skins/ for .png files and writes public/wardrobe/skins/index.json.
 * Run before dev/build so new skins are auto-discovered.
 */

const fs = require('fs');
const path = require('path');

const SKINS_DIR = path.join(__dirname, '../public/wardrobe/skins');
const MANIFEST_PATH = path.join(SKINS_DIR, 'index.json');

if (!fs.existsSync(SKINS_DIR)) {
  fs.mkdirSync(SKINS_DIR, { recursive: true });
}

const files = fs.readdirSync(SKINS_DIR);
const existing = fs.existsSync(MANIFEST_PATH)
  ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'))
  : [];
const existingByPath = Object.fromEntries(existing.map((s) => [s.path, s]));
const existingByName = Object.fromEntries(
  existing.map((s) => [path.basename(String(s.path || '')), s])
);

function normalizePreviewPath(previewPath) {
  if (typeof previewPath !== 'string') return undefined;
  return previewPath.replace(/^\/skins\/previews\//, '/wardrobe/skins/previews/');
}

function getPreviewPathForSkin(filename) {
  const previewName = `${filename.replace(/\.png$/i, '')}-preview.png`;
  const previewFilePath = path.join(SKINS_DIR, 'previews', previewName);
  if (!fs.existsSync(previewFilePath)) return undefined;
  return `/wardrobe/skins/previews/${previewName}`;
}

const skins = files
  .filter((f) => f.toLowerCase().endsWith('.png') && !f.includes('-preview'))
  .sort()
  .map((f) => {
    const path_ = `/wardrobe/skins/${f}`;
    const fallbackLabel = f.replace(/\.png$/i, '').replace(/[-_]/g, ' ');
    const prev = existingByPath[path_] || existingByName[f] || {};
    const preview = normalizePreviewPath(prev.preview) || getPreviewPathForSkin(f);
    return {
      path: path_,
      label: prev.label || fallbackLabel,
      ...(preview && { preview })
    };
  });

fs.writeFileSync(MANIFEST_PATH, JSON.stringify(skins, null, 2), 'utf-8');
console.log('[skins] Manifest updated:', skins.length, 'skin(s)');
