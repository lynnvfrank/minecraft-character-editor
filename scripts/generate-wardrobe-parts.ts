#!/usr/bin/env node

/**
 * Generate wardrobe part-only skins (Approach 1).
 *
 * For each full outfit in public/wardrobe/skins/index.json:
 * - Load the source 64×64 skin PNG
 * - Extract/crop the relevant region(s) for each part using bounds from src/skin
 * - Write PNGs to public/wardrobe/parts/<part>/ and update that part's index.json
 *
 * This script is idempotent and can be run before dev/build.
 * Bounds are imported from the shared source of truth (src/skin).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { LAYER_KEYS, SKIN_LAYER_BOUNDS } from '../src/skin';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const SKINS_MANIFEST = path.join(PROJECT_ROOT, 'public', 'wardrobe', 'skins', 'index.json');
const WARDROBE_PARTS_ROOT = path.join(PROJECT_ROOT, 'public', 'wardrobe', 'parts');

let createCanvas: (w: number, h: number) => { getContext: (c: string) => CanvasRenderingContext2D; toBuffer: (mime: string) => Buffer };
let loadImage: (src: string) => Promise<unknown>;
try {
  const canvas = require('canvas') as { createCanvas: typeof createCanvas; loadImage: typeof loadImage };
  createCanvas = canvas.createCanvas;
  loadImage = canvas.loadImage;
} catch {
  console.warn('[wardrobe] Optional dependency "canvas" not installed; skipping wardrobe part generation.');
  process.exit(0);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadJsonSafe<T>(p: string, fallback: T): T {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function getWardrobePreviewInfo(part: string, id: string): { publicPath: string; filePath: string } {
  const filename = `${id}-preview.png`;
  return {
    publicPath: `/wardrobe/parts/${part}/previews/${filename}`,
    filePath: path.join(WARDROBE_PARTS_ROOT, part, 'previews', filename),
  };
}

async function main(): Promise<void> {
  ensureDir(WARDROBE_PARTS_ROOT);

  if (!fs.existsSync(SKINS_MANIFEST)) {
    console.error('[wardrobe] Missing skins manifest at', SKINS_MANIFEST);
    process.exit(1);
  }

  const skins = loadJsonSafe<{ path: string; label?: string }[]>(SKINS_MANIFEST, []);
  if (!Array.isArray(skins) || skins.length === 0) {
    console.log('[wardrobe] No skins found in manifest; nothing to do.');
    return;
  }

  const publicRoot = path.join(PROJECT_ROOT, 'public');

  /** part -> manifest entries */
  const manifests: Record<string, { path: string; items: { id?: string; path?: string; label?: string; preview?: string }[] }> = {};

  for (const part of LAYER_KEYS) {
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

    let img: unknown;
    try {
      img = await loadImage(srcPath);
    } catch (e) {
      console.warn('[wardrobe] Failed to load skin image, skipping:', srcPath, String(e));
      continue;
    }

    const baseName = path.basename(relPath, path.extname(relPath));

    for (const part of LAYER_KEYS) {
      const boundsList = SKIN_LAYER_BOUNDS[part];
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
        label: `${skin.label ?? baseName} (${part})`,
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
        if (!existingEntry) {
          existingManifest.push(nextEntry);
        }
        continue;
      }

      const canvas = createCanvas(64, 64);
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, 64, 64);

      for (const b of boundsList) {
        ctx.drawImage(img as CanvasImageSource, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h);
      }

      const outPng = canvas.toBuffer('image/png');
      fs.writeFileSync(outPath, outPng);

      if (!existingEntry) {
        existingManifest.push(nextEntry);
      }
    }
  }

  // Write manifests
  for (const part of LAYER_KEYS) {
    const { path: manifestPath, items } = manifests[part];
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
