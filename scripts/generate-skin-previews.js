#!/usr/bin/env node

/**
 * Generates 3D preview images for full skins and wardrobe parts by loading the
 * Preview route in Puppeteer and capturing the Three.js canvas.
 *
 * Full-skin previews are written to public/wardrobe/skins/previews and update
 * public/wardrobe/skins/index.json.
 *
 * Wardrobe part previews are written to public/wardrobe/parts/<part>/previews
 * and update each part's index.json with a preview field.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..');
const PREVIEW_CONFIG_ROOT = path.join(ROOT, 'src/config/preview');
const MANIFEST_PATH = path.join(ROOT, 'public/wardrobe/skins/index.json');
const PREVIEWS_DIR = path.join(ROOT, 'public/wardrobe/skins/previews');
const WARDROBE_ROOT = path.join(ROOT, 'public/wardrobe/parts');
const WARDROBE_PART_KEYS = [
  'hat',
  'head',
  'jacket',
  'body',
  'arms',
  'sleeves',
  'pants',
  'legs',
  'torso',
  'jacketGroup',
  'bottom',
  'center',
  'top',
  'all',
];
const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;
const FULL_OUTFIT_PREVIEW_CONFIG_PATH = path.join(PREVIEW_CONFIG_ROOT, 'skins', 'preview.config.json');
const PANEL_SELECTORS = [
  '#controls-bar',
  '#app-lower-left-panels',
  '#test-controls',
  '#creator-panel',
  '#creator-view-wrapper .creator-left-panels',
  '#creator-upper-right-panels-root',
  '#preview-lower-right-panels'
];
const previewConfigCache = new Map();

function getSkinPreviewInfo(skin) {
  const basename = path.basename(skin.path, path.extname(skin.path));
  return {
    basename,
    previewPath: `/wardrobe/skins/previews/${basename}-preview.png`,
    outPath: path.join(PREVIEWS_DIR, `${basename}-preview.png`)
  };
}

function getWardrobePartPreviewInfo(part, item) {
  const id = item.id || path.basename(item.path, path.extname(item.path));
  const previewFilename = `${id}-preview.png`;
  return {
    id,
    previewPath: `/wardrobe/parts/${part}/previews/${previewFilename}`,
    outPath: path.join(WARDROBE_ROOT, part, 'previews', previewFilename)
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function getPreviewConfigPath(presetKey) {
  if (presetKey === 'fullOutfit') return FULL_OUTFIT_PREVIEW_CONFIG_PATH;
  return path.join(PREVIEW_CONFIG_ROOT, 'parts', presetKey, 'preview.config.json');
}

function loadPreviewConfig(presetKey) {
  if (previewConfigCache.has(presetKey)) {
    return previewConfigCache.get(presetKey);
  }

  const filePath = getPreviewConfigPath(presetKey);
  const config = loadJsonSafe(filePath, null);
  if (!config?.viewport?.width || !config?.viewport?.height) {
    throw new Error(`Missing preview viewport config for "${presetKey}" at ${filePath}`);
  }

  previewConfigCache.set(presetKey, config);
  return config;
}

function requestBaseUrl() {
  return new Promise((resolve, reject) => {
    const req = http.get(BASE_URL, { agent: false }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', reject);
  });
}

async function isServerAvailable() {
  try {
    await requestBaseUrl();
    return true;
  } catch {
    return false;
  }
}

function waitForServer(ms = 5000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + ms;
    const check = () => {
      requestBaseUrl()
        .then(() => resolve())
        .catch(() => {
          if (Date.now() > deadline) reject(new Error('Server did not start in time'));
          else setTimeout(check, 250);
        });
    };
    check();
  });
}

function buildPreviewUrl(query = {}) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value == null || value === '') return;
    params.set(key, value);
  });
  const queryString = params.toString();
  return `${BASE_URL}${queryString ? `?${queryString}` : ''}#/preview`;
}

function getCaptureViewport(part = null) {
  return loadPreviewConfig(part ?? 'fullOutfit').viewport;
}

async function openPreviewRoute(page) {
  await page.setViewport(getCaptureViewport());
  await page.goto(buildPreviewUrl(), {
    waitUntil: 'networkidle2',
    timeout: 30000
  });
  await page.waitForSelector('#three-canvas-container canvas', { timeout: 30000 });
  await page.waitForFunction(
    () => typeof window.__previewCapture?.setPreviewState === 'function',
    { timeout: 30000 }
  );
  await page.evaluate(async () => {
    await window.__previewCapture.waitUntilReady();
  });
}

async function applyPreviewState(page, query = {}) {
  await page.setViewport(getCaptureViewport(query.part ?? null));
  await page.evaluate(async (state) => {
    await window.__previewCapture.setPreviewState(state);
  }, query);
}

async function hidePanels(page) {
  await page.evaluate((selectors) => {
    selectors.forEach((sel) => {
      const el = document.querySelector(sel);
      if (el) el.style.setProperty('display', 'none', 'important');
    });
  }, PANEL_SELECTORS);
}

async function showPanels(page) {
  await page.evaluate((selectors) => {
    selectors.forEach((sel) => {
      const el = document.querySelector(sel);
      if (el) el.style.removeProperty('display');
    });
  }, PANEL_SELECTORS);
}

async function captureCanvasScreenshot(page, outPath) {
  const canvas = await page.$('#three-canvas-container canvas');
  if (!canvas) return false;
  const box = await canvas.boundingBox();
  if (!box) return false;

  await hidePanels(page);
  await wait(150);
  await page.screenshot({
    path: outPath,
    clip: {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height
    },
    omitBackground: true
  });
  await showPanels(page);
  return true;
}

function hasMissingFullSkinPreviews(skins) {
  return skins.some((skin) => !fs.existsSync(getSkinPreviewInfo(skin).outPath));
}

function hasMissingWardrobePartPreviews() {
  return WARDROBE_PART_KEYS.some((part) => {
    const manifestPath = path.join(WARDROBE_ROOT, part, 'index.json');
    if (!fs.existsSync(manifestPath)) return false;
    const items = loadJsonSafe(manifestPath, []);
    if (!Array.isArray(items)) return false;
    return items.some((item) => !fs.existsSync(getWardrobePartPreviewInfo(part, item).outPath));
  });
}

async function generateFullSkinPreviews(getPage, skins) {
  ensureDir(PREVIEWS_DIR);
  const updatedSkins = [];

  for (const skin of skins) {
    const { basename, previewPath, outPath } = getSkinPreviewInfo(skin);

    if (fs.existsSync(outPath)) {
      console.log('[previews] Skipping existing skin preview:', basename);
      updatedSkins.push({ ...skin, preview: previewPath });
      continue;
    }

    try {
      const page = await getPage();
      await applyPreviewState(page, {
        skin: skin.path,
        cameraPreset: 'fullOutfit'
      });
      const saved = await captureCanvasScreenshot(page, outPath);
      if (saved) {
        console.log('[previews] Saved skin preview:', basename);
        updatedSkins.push({ ...skin, preview: previewPath });
      } else {
        console.warn('[previews] Canvas not found for skin:', skin.path);
        updatedSkins.push(skin);
      }
    } catch (err) {
      console.warn('[previews] Failed skin preview:', skin.path, String(err));
      updatedSkins.push(skin);
    }
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(updatedSkins, null, 2), 'utf-8');
  return updatedSkins;
}

async function generateWardrobePartPreviews(getPage, baseSkinPath) {
  if (!baseSkinPath) {
    console.warn('[previews] No base skin available; skipping wardrobe part previews.');
    return;
  }

  for (const part of WARDROBE_PART_KEYS) {
    const partDir = path.join(WARDROBE_ROOT, part);
    const manifestPath = path.join(partDir, 'index.json');
    if (!fs.existsSync(manifestPath)) continue;

    const previewDir = path.join(partDir, 'previews');
    ensureDir(previewDir);

    const items = loadJsonSafe(manifestPath, []);
    if (!Array.isArray(items) || items.length === 0) continue;

    const updatedItems = [];
    for (const item of items) {
      const { id, previewPath, outPath } = getWardrobePartPreviewInfo(part, item);

      if (fs.existsSync(outPath)) {
        console.log('[previews] Skipping existing wardrobe preview:', id);
        updatedItems.push({ ...item, preview: previewPath });
        continue;
      }

      try {
        const page = await getPage();
        await applyPreviewState(page, {
          skin: item.path,
          baseSkin: baseSkinPath,
          part,
          cameraPreset: part
        });
        const saved = await captureCanvasScreenshot(page, outPath);
        if (saved) {
          console.log('[previews] Saved wardrobe preview:', id);
          updatedItems.push({ ...item, preview: previewPath });
        } else {
          console.warn('[previews] Canvas not found for wardrobe part:', item.path);
          updatedItems.push(item);
        }
      } catch (err) {
        console.warn('[previews] Failed wardrobe preview:', item.path, String(err));
        updatedItems.push(item);
      }
    }

    fs.writeFileSync(manifestPath, JSON.stringify(updatedItems, null, 2), 'utf-8');
  }
}

async function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('[previews] Run npm run generate-skins first');
    process.exit(1);
  }

  const skins = loadJsonSafe(MANIFEST_PATH, []);
  if (!Array.isArray(skins) || skins.length === 0) {
    console.log('[previews] No skins to process');
    return;
  }

  const needsCapture = hasMissingFullSkinPreviews(skins) || hasMissingWardrobePartPreviews();

  let vite = null;
  if (needsCapture) {
    const serverAlreadyRunning = await isServerAvailable();
    // Important: do NOT spawn `npm run dev` here, because `dev` itself may run
    // `generate-previews` which would recurse. We only need the Vite server.
    vite = serverAlreadyRunning
      ? null
      : spawn('npm', ['run', 'dev:server'], {
        cwd: ROOT,
        stdio: 'pipe',
        shell: true,
        env: { ...process.env, FORCE_COLOR: '0' }
      });

    if (vite) {
      try {
        await waitForServer(30000);
      } catch (err) {
        vite.kill('SIGTERM');
        console.error('[previews] Failed to start dev server:', err.message);
        process.exit(1);
      }
    } else {
      console.log('[previews] Reusing existing dev server at', BASE_URL);
    }
  } else {
    console.log('[previews] All preview images already exist; updating manifests only.');
  }
  let browser = null;
  let page = null;

  try {
    const getPage = async () => {
      if (page) return page;
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
      });
      page = await browser.newPage();
      page.on('pageerror', (err) => console.error('[previews] Page error:', err.message));
      page.on('console', (msg) => {
        if (msg.type() === 'error') console.error('[previews] Console:', msg.text());
      });
      await openPreviewRoute(page);
      return page;
    };

    const updatedSkins = await generateFullSkinPreviews(getPage, skins);
    const baseSkinPath =
      updatedSkins.find((skin) => skin.path === '/wardrobe/skins/skin-base.png')?.path ??
      updatedSkins[0]?.path ??
      null;

    await generateWardrobePartPreviews(getPage, baseSkinPath);
    console.log('[previews] Done. Skin and wardrobe manifests updated with preview paths.');
  } finally {
    if (browser) await browser.close();
    if (vite) vite.kill('SIGKILL');
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('[previews]', err);
    process.exit(1);
  });
