#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC_ROOT = path.join(ROOT, 'public');
const SKINS_MANIFEST_PATH = path.join(PUBLIC_ROOT, 'wardrobe', 'skins', 'index.json');
const WARDROBE_ROOT = path.join(PUBLIC_ROOT, 'wardrobe', 'parts');
const WARDROBE_PART_KEYS = ['hat', 'head', 'jacket', 'body', 'arms', 'sleeves', 'pants', 'legs'];

function loadJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function deleteIfExists(filePath) {
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

function clearSkinPreviews() {
  const skins = loadJsonSafe(SKINS_MANIFEST_PATH, []);
  let deleted = 0;
  const updated = Array.isArray(skins)
    ? skins.map((skin) => {
      if (typeof skin.preview === 'string') {
        const previewPath = path.join(PUBLIC_ROOT, skin.preview.replace(/^\//, ''));
        if (deleteIfExists(previewPath)) deleted += 1;
      }
      const { preview, ...rest } = skin;
      return rest;
    })
    : [];

  fs.writeFileSync(SKINS_MANIFEST_PATH, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
  console.log(`[clear-previews] Skin previews removed: ${deleted}`);
}

function clearWardrobePartPreviews() {
  let deleted = 0;

  for (const part of WARDROBE_PART_KEYS) {
    const manifestPath = path.join(WARDROBE_ROOT, part, 'index.json');
    const items = loadJsonSafe(manifestPath, []);
    if (!Array.isArray(items)) continue;

    const updated = items.map((item) => {
      if (typeof item.preview === 'string') {
        const previewPath = path.join(PUBLIC_ROOT, item.preview.replace(/^\//, ''));
        if (deleteIfExists(previewPath)) deleted += 1;
      }
      const { preview, ...rest } = item;
      return rest;
    });

    fs.writeFileSync(manifestPath, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
  }

  console.log(`[clear-previews] Wardrobe part previews removed: ${deleted}`);
}

function main() {
  const target = (process.argv[2] || '').toLowerCase();

  if (target === 'skins') {
    clearSkinPreviews();
    return;
  }

  if (target === 'parts') {
    clearWardrobePartPreviews();
    return;
  }

  if (target === 'wardrobe') {
    clearSkinPreviews();
    clearWardrobePartPreviews();
    return;
  }

  console.error('Usage: node scripts/clear-previews.js <skins|parts|wardrobe>');
  process.exit(1);
}

main();
