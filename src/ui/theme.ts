/**
 * App theme (bright / dark): sets <html data-theme> for CSS tokens (styles/_theme.scss)
 * and recolors the 3D scene to match.
 */

import * as THREE from 'three';

export type Theme = 'bright' | 'dark';

const STORAGE_KEY = 'app:theme';

export const SCENE_THEME: Record<Theme, { background: number; ground: number; hemiGround: number }> = {
  bright: { background: 0xcfe6ff, ground: 0x9fcf86, hemiGround: 0x6f8a5a },
  dark: { background: 0x050710, ground: 0x1b1f3b, hemiGround: 0x202030 },
};

let current: Theme = readStoredTheme();
let scene: THREE.Scene | null = null;
const listeners = new Set<(t: Theme) => void>();

function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'bright' || v === 'dark') return v;
  } catch {
    // ignore
  }
  return 'bright';
}

export function getTheme(): Theme {
  return current;
}

function applySceneColors(): void {
  if (!scene) return;
  const c = SCENE_THEME[current];
  scene.background = new THREE.Color(c.background);
  scene.traverse((obj) => {
    if (obj.name === 'ground' && (obj as THREE.Mesh).isMesh) {
      ((obj as THREE.Mesh).material as THREE.MeshStandardMaterial).color.setHex(c.ground);
    }
    if ((obj as THREE.HemisphereLight).isHemisphereLight) {
      (obj as THREE.HemisphereLight).groundColor.setHex(c.hemiGround);
    }
  });
}

export function setTheme(theme: Theme): void {
  current = theme;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore
  }
  applySceneColors();
  listeners.forEach((fn) => fn(theme));
}

export function onThemeChange(fn: (t: Theme) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Call once after the scene exists. Applies the stored theme and adds the toggle button. */
export function initTheme(sceneRef: THREE.Scene): void {
  scene = sceneRef;
  setTheme(current);

  if (document.getElementById('theme-toggle-btn')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'theme-toggle-btn';
  btn.className = 'theme-toggle-btn';
  const sync = () => {
    const next = current === 'bright' ? 'dark' : 'bright';
    btn.textContent = current === 'bright' ? '☾' : '☀';
    btn.title = `Switch to ${next} theme`;
    btn.setAttribute('aria-label', btn.title);
  };
  btn.addEventListener('click', () => {
    setTheme(current === 'bright' ? 'dark' : 'bright');
  });
  onThemeChange(sync);
  sync();
  document.body.appendChild(btn);
}

// Apply tokens as early as possible to avoid a flash of the wrong theme.
if (typeof document !== 'undefined') document.documentElement.dataset.theme = current;
