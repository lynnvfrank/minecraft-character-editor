#!/usr/bin/env node
/**
 * List available models from an LM Studio/OpenAI-compatible endpoint.
 * Usage:
 *   node scripts/list-lmstudio-models.js http://192.168.8.199:1234
 */
// http://192.168.8.133:1234
const baseUrl = (process.argv[2] || 'http://192.168.8.199:1234').replace(/\/$/, '');
const endpoints = ['/v1/models', '/models'];

async function tryFetchJson(url) {
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

function extractModels(payload) {
  const data = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload)
      ? payload
      : [];

  return data
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry.id === 'string') return entry.id;
      if (entry && typeof entry.model === 'string') return entry.model;
      if (entry && typeof entry.name === 'string') return entry.name;
      return null;
    })
    .filter(Boolean);
}

async function main() {
  let lastError = null;

  for (const path of endpoints) {
    const url = `${baseUrl}${path}`;
    try {
      const payload = await tryFetchJson(url);
      const models = extractModels(payload);

      if (!models.length) {
        console.log(`Connected to ${url}, but no models were returned.`);
        process.exit(0);
      }

      console.log(`Available models from ${url}:`);
      for (const model of models) {
        console.log(`- ${model}`);
      }
      process.exit(0);
    } catch (err) {
      lastError = err;
    }
  }

  console.error(`Failed to fetch models from ${baseUrl}`);
  if (lastError) console.error(lastError.message || String(lastError));
  process.exit(1);
}

main();
