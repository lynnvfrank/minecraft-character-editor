#!/usr/bin/env node

/**
 * Clears the animation manifest (public/animations/index.json) by writing [].
 * Run with: npm run animations:clean
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'public', 'animations', 'index.json');

const dir = path.dirname(MANIFEST_PATH);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

fs.writeFileSync(MANIFEST_PATH, '[]\n', 'utf-8');
console.log('[clear-animations] Manifest cleared:', MANIFEST_PATH);
