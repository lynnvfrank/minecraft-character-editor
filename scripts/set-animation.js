#!/usr/bin/env node

/**
 * POST /api/animation?name=<animation-name>
 * Example: npm run set-animation happy
 *          npm run set-animation bored
 */

const base = process.env.API_BASE || 'http://localhost:5173';
const name = process.argv[2];

if (!name) {
  console.error('Usage: npm run set-animation <animation-name>');
  console.error('Example: npm run set-animation happy');
  console.error('Options: bored, crying, laughing, shrugging, happy, ninja-idle, blow-a-kiss');
  process.exit(1);
}

const url = `${base}/api/animation?name=${encodeURIComponent(name)}`;
fetch(url, { method: 'POST' })
  .then((r) => r.json())
  .then((data) => {
    if (data.error) {
      console.error(data.error);
      process.exit(1);
    }
    console.log('Animation set to:', data.animation);
  })
  .catch((err) => {
    console.error('Request failed:', err.message);
    process.exit(1);
  });
