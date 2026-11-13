/**
 * App theme (bright / dark): sets <html data-theme> for CSS tokens (styles/_theme.scss)
 * and recolors the 3D scene to match.
 */

import { setSkyTheme, type SkyTheme } from '../viewer/scene';

export type Theme = 'bright' | 'dark';

const STORAGE_KEY = 'app:theme';

/** Sky colors for the neutral lighting presets (see viewer/scene.ts setSkyTheme). */
export const SCENE_THEME: Record<Theme, SkyTheme> = {
  bright: { background: 0xcfe6ff, ground: 0x9fcf86 },
  dark: { background: 0x050710, ground: 0x1b1f3b },
};

let current: Theme = readStoredTheme();
let sceneReady = false;
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
  if (sceneReady) setSkyTheme(SCENE_THEME[current]);
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
export function initTheme(): void {
  sceneReady = true;
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
