/**
 * Model-specific mesh name → UV part key mapping.
 * Supports new rigs via config without code changes.
 */

import type { UVPartKey } from './layout';

export type { UVPartKey };

/** Rule: when mesh name matches, return part. Evaluated in order; first match wins. */
export type MappingRule = {
  /** Substring (case-insensitive) or RegExp. */
  match: string | RegExp;
  part: UVPartKey;
};

/** Model key (from path) → ordered rules. Use registerMeshPartMapping() to add. */
const MESH_PART_CONFIG: Record<string, MappingRule[]> = {};

/** Known models use heuristics (same logic as before). Add explicit rules to override. */
const KNOWN_MODELS = new Set(['RunningboyRig']);

/** Derive model key from path, e.g. "/models/RunningboyRig.fbx" → "RunningboyRig" */
function modelKeyFromPath(path: string): string {
  const base = path.split('/').pop() || path;
  return base.replace(/\.(fbx|glb|gltf)$/i, '');
}

/** Heuristic fallback. Matches RunningboyRig / Mixamo-style mesh names. */
function heuristicMeshToPart(meshName: string): UVPartKey | null {
  const n = meshName.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (n.includes('head') && !n.includes('hat') && !n.includes('layer') && !n.includes('access')) return 'head';
  if (n.includes('hat') || (n.includes('head') && (n.includes('layer') || n.includes('access')))) return 'hat';
  if (n.includes('body') && !n.includes('layer') && !n.includes('jacket')) return 'body';
  if (n.includes('jacket') || (n.includes('body') && n.includes('layer'))) return 'jacket';
  if (n.includes('sleeve') && n.includes('r')) return 'sleeveR';
  if (n.includes('sleeve') && n.includes('l')) return 'sleeveL';
  if (n.includes('pant') && n.includes('r')) return 'pantsR';
  if (n.includes('pant') && n.includes('l')) return 'pantsL';
  if (n.includes('arm') && !n.includes('layer') && !n.includes('sleeve')) {
    if (n.includes('left') || (n.includes('l') && !n.includes('right'))) return 'armL';
    return 'armR';
  }
  if (n.includes('leg') && !n.includes('layer') && !n.includes('pant')) {
    if (n.includes('left') || (n.includes('l') && !n.includes('right'))) return 'legL';
    return 'legR';
  }
  return null;
}

/**
 * Map mesh name to UV part key. Uses config for known models, heuristics as fallback.
 * @param meshName - Raw mesh name from FBX
 * @param modelPath - Model path (e.g. "/models/RunningboyRig.fbx") for config lookup
 */
export function getMinecraftPartFromMeshName(meshName: string, modelPath?: string): UVPartKey | null {
  const key = modelPath ? modelKeyFromPath(modelPath) : null;
  const rules = key ? MESH_PART_CONFIG[key] : null;

  if (rules && rules.length > 0) {
    const normalized = meshName.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const { match, part } of rules) {
      const matches =
        typeof match === 'string'
          ? normalized.includes(match.toLowerCase())
          : match.test(meshName) || match.test(normalized);
      if (matches) return part;
    }
  }

  const result = heuristicMeshToPart(meshName);
  if (key && !KNOWN_MODELS.has(key) && !MESH_PART_CONFIG[key]) {
    console.warn(`[meshPartMapping] Unknown model "${key}"; using heuristics. Add to KNOWN_MODELS or registerMeshPartMapping() for explicit mapping.`);
  }
  return result;
}

/** Register a custom mapping for a model. Use for new rigs. */
export function registerMeshPartMapping(modelKey: string, rules: MappingRule[]): void {
  MESH_PART_CONFIG[modelKey] = rules;
}
