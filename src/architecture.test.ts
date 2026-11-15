/**
 * Import boundaries between src/ folders (see docs/concepts/TAXONOMY.md).
 * Scans every non-test .ts file and fails on an import a folder isn't allowed to make.
 * To allow a new dependency, change the rule here and say why in TAXONOMY.md.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url));

/** Folders each layer must NOT import from. Layers not listed are unrestricted (controllers wire everything). */
const FORBIDDEN: Record<string, readonly string[]> = {
  // Pure foundations: no DOM features, no app wiring.
  domain: ['state', 'services', 'viewer', 'animation', 'ui', 'creator', 'controllers', 'events', 'debug'],
  lib: ['domain', 'state', 'services', 'viewer', 'animation', 'ui', 'creator', 'controllers', 'events', 'skin'],
  skin: ['state', 'services', 'viewer', 'animation', 'ui', 'creator', 'controllers', 'events', 'debug'],
  state: ['services', 'viewer', 'animation', 'ui', 'creator', 'controllers'],
  // Rendering and playback don't know about the creator UI or app wiring.
  viewer: ['creator', 'controllers', 'ui', 'services'],
  animation: ['creator', 'controllers', 'ui', 'viewer', 'services'],
  services: ['creator', 'controllers', 'ui', 'viewer'],
  // Feature UI talks to the app through state and events, not controllers.
  creator: ['controllers'],
  ui: ['controllers'],
};

/**
 * Known exceptions: `file -> folder`. Each needs a reason; remove the entry once fixed.
 */
const ALLOWED_EXCEPTIONS: Record<string, string> = {
  'viewer/controls.ts -> creator':
    '3D painting calls the creator paint API (paintStartFrom3D, ...). Fix by injecting those functions via setupCreator3DPaint deps.',
};

function listTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listTsFiles(full);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts') ? [full] : [];
  });
}

/** Files directly in src/ that belong to a layer (src/creator.ts is the creator's public API). */
const TOP_LEVEL_FILE_LAYERS: Record<string, string> = { 'creator.ts': 'creator', creator: 'creator' };

/** Top-level src folder of a file or import target, or '' for app entry files (main.ts). */
function layerOf(file: string): string {
  const rel = relative(SRC, file).split(sep);
  if (rel.length > 1) return rel[0]!;
  return TOP_LEVEL_FILE_LAYERS[rel[0]!] ?? '';
}

const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

function violations(): string[] {
  const out: string[] = [];
  for (const file of listTsFiles(SRC)) {
    const from = layerOf(file);
    const forbidden = FORBIDDEN[from];
    if (!forbidden) continue;
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2]!;
      const target = layerOf(resolve(dirname(file), spec));
      if (!target || target === from || !forbidden.includes(target)) continue;
      const key = `${relative(SRC, file).split(sep).join('/')} -> ${target}`;
      if (ALLOWED_EXCEPTIONS[key]) continue;
      out.push(`${key}  (import '${spec}')`);
    }
  }
  return out;
}

test('src/ folders respect their import boundaries', () => {
  assert.deepEqual(violations(), [], 'Forbidden imports found (see FORBIDDEN in src/architecture.test.ts)');
});

test('every allowed exception is still needed', () => {
  // Re-run with no exceptions; each listed exception must still match a real import.
  const saved = { ...ALLOWED_EXCEPTIONS };
  for (const k of Object.keys(ALLOWED_EXCEPTIONS)) delete ALLOWED_EXCEPTIONS[k];
  try {
    const found = violations().map((v) => v.split('  (')[0]);
    for (const key of Object.keys(saved)) {
      assert.ok(found.includes(key), `Exception "${key}" no longer applies; remove it from ALLOWED_EXCEPTIONS`);
    }
  } finally {
    Object.assign(ALLOWED_EXCEPTIONS, saved);
  }
});
