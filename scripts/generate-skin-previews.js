#!/usr/bin/env node

/**
 * Generates 3D preview images for each skin by loading the app in Puppeteer,
 * applying each skin to the model, and capturing canvas screenshots.
 * Requires: npm run generate-skins first, then a running dev server.
 * Run: npm run generate-skin-previews
 *
 * The script starts the dev server, captures screenshots, then stops it.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'public/skins/index.json');
const PREVIEWS_DIR = path.join(ROOT, 'public/skins/previews');
const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;

function waitForServer(ms = 5000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + ms;
    const check = () => {
      http.get(BASE_URL, (res) => {
        resolve();
      }).on('error', () => {
        if (Date.now() > deadline) reject(new Error('Server did not start in time'));
        else setTimeout(check, 200);
      });
    };
    check();
  });
}

async function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('[previews] Run npm run generate-skins first');
    process.exit(1);
  }

  const skins = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  if (skins.length === 0) {
    console.log('[previews] No skins to process');
    return;
  }

  if (!fs.existsSync(PREVIEWS_DIR)) {
    fs.mkdirSync(PREVIEWS_DIR, { recursive: true });
  }

  const vite = spawn('npm', ['run', 'dev'], {
    cwd: ROOT,
    stdio: 'pipe',
    shell: true,
    env: { ...process.env, FORCE_COLOR: '0' }
  });

  let serverReady = false;
  vite.stdout.on('data', (d) => {
    const s = d.toString();
    if (s.includes('localhost') || s.includes('127.0.0.1')) serverReady = true;
  });

  try {
    await waitForServer(30000);
  } catch (e) {
    vite.kill('SIGTERM');
    console.error('[previews] Failed to start dev server:', e.message);
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
  });

  try {
    const page = await browser.newPage();

    page.on('pageerror', (err) => console.error('[previews] Page error:', err.message));
    page.on('console', (msg) => {
      const t = msg.type();
      if (t === 'error') console.error('[previews] Console:', msg.text());
    });

    await page.setViewport({ width: 400, height: 600 });
    await page.goto(`${BASE_URL}?cameraZ=3&fov=35`, { waitUntil: 'networkidle2', timeout: 20000 });

    await page.waitForSelector('#three-canvas-container canvas', { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 3000));

    const updatedSkins = [];

    for (let i = 0; i < skins.length; i++) {
      const skin = skins[i];
      const basename = path.basename(skin.path, '.png');
      const previewPath = `/skins/previews/${basename}-preview.png`;
      const outPath = path.join(PREVIEWS_DIR, `${basename}-preview.png`);

      if (i > 0) {
        const btn = await page.$(`.skin-preview[data-skin="${skin.path}"]`);
        if (btn) {
          await btn.click();
          await new Promise((r) => setTimeout(r, 600));
        }
      }

      const canvas = await page.$('#three-canvas-container canvas');
      if (!canvas) {
        console.warn('[previews] Canvas not found for', skin.path);
        updatedSkins.push(skin);
        continue;
      }

      const box = await canvas.boundingBox();
      if (box) {
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
        console.log('[previews] Saved:', basename);
        updatedSkins.push({ ...skin, preview: previewPath });
      } else {
        updatedSkins.push(skin);
      }
    }

    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(updatedSkins, null, 2), 'utf-8');
    console.log('[previews] Done. Manifest updated with preview paths.');
  } finally {
    await browser.close();
    vite.kill('SIGKILL');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[previews]', err);
  process.exit(1);
});
