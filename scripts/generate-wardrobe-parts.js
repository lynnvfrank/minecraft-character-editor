#!/usr/bin/env node

/**
 * Generate wardrobe part-only skins (Approach 1).
 *
 * For each full outfit in public/wardrobe/skins/index.json:
 * - Load the source 64×64 skin PNG
 * - Extract/crop the relevant region(s) for each part
 * - Write PNGs to public/wardrobe/parts/<part>/ and update that part's index.json
 *
 * This script is idempotent and can be run before dev/build.
 */

const fs = require('fs');
const path = require('path');

let createCanvas;
let loadImage;
try {
  // Lazy-load canvas; if missing, skip generation so dev/build still work.
  // To enable wardrobe parts generation, install it: npm install --save-dev canvas
  // (or add a compatible alternative and update this script).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const canvas = require('canvas');
  createCanvas = canvas.createCanvas;
  loadImage = canvas.loadImage;
} catch {
  console.warn('[wardrobe] Optional dependency "canvas" not installed; skipping wardrobe part generation.');
  process.exit(0);
}

const PROJECT_ROOT = path.join(__dirname, '..');
const SKINS_MANIFEST = path.join(PROJECT_ROOT, 'public', 'wardrobe', 'skins', 'index.json');
const WARDROBE_PARTS_ROOT = path.join(PROJECT_ROOT, 'public', 'wardrobe', 'parts');

const PART_BOUNDS = {
  hat: [{ x: 32, y: 0, w: 32, h: 16 }],
  head: [{ x: 0, y: 0, w: 32, h: 16 }],
  body: [{ x: 16, y: 16, w: 24, h: 16 }],
  jacket: [{ x: 16, y: 32, w: 24, h: 16 }],
  arms: [
    { x: 40, y: 16, w: 16, h: 16 },
    { x: 32, y: 48, w: 16, h: 16 },
  ],
  sleeves: [
    { x: 40, y: 32, w: 16, h: 16 },
    { x: 48, y: 48, w: 16, h: 16 },
  ],
  pants: [
    { x: 0, y: 32, w: 16, h: 16 }, // Right pants
    { x: 0, y: 48, w: 16, h: 16 }, // Left pants
  ],
  legs: [
    { x: 0, y: 16, w: 16, h: 16 }, // Right leg
    { x: 16, y: 48, w: 16, h: 16 }, // Left leg
  ],
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadJsonSafe(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return fallback;
  }
}

function getWardrobePreviewInfo(part, id) {
  const filename = `${id}-preview.png`;
  return {
    publicPath: `/wardrobe/parts/${part}/previews/${filename}`,
    filePath: path.join(WARDROBE_PARTS_ROOT, part, 'previews', filename),
  };
}

async function main() {
  ensureDir(WARDROBE_PARTS_ROOT);

  if (!fs.existsSync(SKINS_MANIFEST)) {
    console.error('[wardrobe] Missing skins manifest at', SKINS_MANIFEST);
    process.exit(1);
  }

  const skins = loadJsonSafe(SKINS_MANIFEST, []);
  if (!Array.isArray(skins) || skins.length === 0) {
    console.log('[wardrobe] No skins found in manifest; nothing to do.');
    return;
  }

  const publicRoot = path.join(PROJECT_ROOT, 'public');

  /** part -> manifest entries */
  const manifests = {};

  for (const part of Object.keys(PART_BOUNDS)) {
    const partDir = path.join(WARDROBE_PARTS_ROOT, part);
    ensureDir(partDir);
    ensureDir(path.join(partDir, 'previews'));
    const manifestPath = path.join(partDir, 'index.json');
    manifests[part] = {
      path: manifestPath,
      items: loadJsonSafe(manifestPath, []),
    };
  }

  for (const skin of skins) {
    const relPath = skin.path.startsWith('/') ? skin.path.slice(1) : skin.path;
    const srcPath = path.join(publicRoot, relPath);
    if (!fs.existsSync(srcPath)) {
      console.warn('[wardrobe] Source skin not found, skipping:', srcPath);
      continue;
    }

    let img;
    try {
      img = await loadImage(srcPath);
    } catch (e) {
      console.warn('[wardrobe] Failed to load skin image, skipping:', srcPath, String(e));
      continue;
    }

    const baseName = path.basename(relPath, path.extname(relPath));

    for (const [part, boundsList] of Object.entries(PART_BOUNDS)) {
      const partDir = path.join(WARDROBE_PARTS_ROOT, part);
      const id = `${baseName}-${part}`;
      const outName = `${id}.png`;
      const outPath = path.join(partDir, outName);
      const publicOutPath = `/wardrobe/parts/${part}/${outName}`;
      const existingManifest = manifests[part].items;
      const existingEntry = existingManifest.find((m) => m.path === publicOutPath || m.id === id);
      const previewInfo = getWardrobePreviewInfo(part, id);
      const previewPath =
        existingEntry?.preview ||
        (fs.existsSync(previewInfo.filePath) ? previewInfo.publicPath : undefined);
      const nextEntry = {
        id,
        path: publicOutPath,
        label: `${skin.label} (${part})`,
        ...(previewPath ? { preview: previewPath } : {}),
      };
      if (existingEntry) {
        existingEntry.id = nextEntry.id;
        existingEntry.path = nextEntry.path;
        existingEntry.label = nextEntry.label;
        if (nextEntry.preview) existingEntry.preview = nextEntry.preview;
        else delete existingEntry.preview;
      }

      // Skip if already generated.
      if (fs.existsSync(outPath)) {
        // Ensure manifest has an entry.
        if (!existingEntry) {
          existingManifest.push(nextEntry);
        }
        continue;
      }

      const canvas = createCanvas(64, 64);
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, 64, 64);

      for (const b of boundsList) {
        ctx.drawImage(
          img,
          b.x,
          b.y,
          b.w,
          b.h,
          b.x,
          b.y,
          b.w,
          b.h
        );
      }

      const outPng = canvas.toBuffer('image/png');
      fs.writeFileSync(outPath, outPng);

      if (!existingEntry) {
        existingManifest.push(nextEntry);
      }
    }
  }

  // Write manifests
  for (const [part, { path: manifestPath, items }] of Object.entries(manifests)) {
    items.sort((a, b) => String(a.label).localeCompare(String(b.label)));
    fs.writeFileSync(manifestPath, JSON.stringify(items, null, 2), 'utf-8');
    console.log(`[wardrobe] ${part} parts updated:`, items.length);
  }

  console.log('[wardrobe] Part generation complete.');
}

main().catch((err) => {
  console.error('[wardrobe] Unhandled error:', err);
  process.exit(1);
});

