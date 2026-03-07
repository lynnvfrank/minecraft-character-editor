#!/usr/bin/env node

/**
 * POST /api/skin?name=<skin-name>
 * Example: npm run set-skin skin-anime1
 *          npm run set-skin RunningboyRig
 */

const base = process.env.API_BASE || 'http://localhost:5173';
const name = process.argv[2];

if (!name) {
  console.error('Usage: npm run set-skin <skin-name>');
  console.error('Example: npm run set-skin skin-anime1');
  process.exit(1);
}

const url = `${base}/api/skin?name=${encodeURIComponent(name)}`;
fetch(url, { method: 'POST' })
  .then((r) => r.json())
  .then((data) => {
    if (data.error) {
      console.error(data.error);
      process.exit(1);
    }
    console.log('Skin set to:', data.skin);
  })
  .catch((err) => {
    console.error('Request failed:', err.message);
    process.exit(1);
  });
