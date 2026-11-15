/**
 * About / Attribution panel: a "?" button (bottom-right, home view) that opens an overlay
 * crediting libraries and assets. Keep in sync with docs/ATTRIBUTION-ASSESSMENT.md.
 */

interface Credit {
  name: string;
  detail: string;
  license: string;
  url?: string;
}

const LIBRARIES: Credit[] = [
  { name: 'three.js', detail: '3D rendering, FBX/GLTF loaders, controls', license: 'MIT', url: 'https://threejs.org' },
  { name: 'tween.js', detail: 'Animation tweening', license: 'MIT', url: 'https://github.com/tweenjs/tween.js' },
  { name: 'XState', detail: 'State machines', license: 'MIT', url: 'https://stately.ai/docs/xstate' },
  { name: 'Socket.IO', detail: 'Local messaging', license: 'MIT', url: 'https://socket.io' },
  { name: 'Express', detail: 'Local server', license: 'MIT', url: 'https://expressjs.com' },
  { name: 'Electron', detail: 'Desktop app shell (includes Chromium and Node.js)', license: 'MIT', url: 'https://www.electronjs.org' },
  { name: 'electron-store', detail: 'Settings storage', license: 'MIT', url: 'https://github.com/sindresorhus/electron-store' },
  { name: 'dotenv', detail: 'Configuration', license: 'BSD-2-Clause', url: 'https://github.com/motdotla/dotenv' },
  { name: 'minimatch', detail: 'Pattern matching', license: 'BlueOak-1.0.0', url: 'https://github.com/isaacs/minimatch' },
  { name: 'Vite, Sass, TypeScript', detail: 'Build tooling', license: 'MIT / Apache-2.0' },
];

const ASSETS: Credit[] = [
  { name: 'Animations', detail: 'Character animations by Adobe Mixamo', license: 'Mixamo terms', url: 'https://www.mixamo.com' },
  { name: 'Running Boy character rig', detail: 'Minecraft-style character model, rigged with Mixamo (source to be confirmed)', license: 'TBD' },
  { name: 'Lucide', detail: 'Interface icons', license: 'ISC', url: 'https://lucide.dev' },
];

const DISCLAIMER =
  'Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft. ' +
  'Minecraft is a trademark of Mojang Synergies AB.';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function creditList(title: string, items: Credit[]): HTMLElement {
  const section = el('section', 'about-section');
  section.appendChild(el('h3', 'about-section-title', title));
  const list = el('ul', 'about-list');
  for (const item of items) {
    const li = el('li', 'about-item');
    const head = el('div', 'about-item-head');
    if (item.url) {
      const a = el('a', 'about-item-name', item.name);
      a.href = item.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      head.appendChild(a);
    } else {
      head.appendChild(el('span', 'about-item-name', item.name));
    }
    head.appendChild(el('span', 'about-license', item.license));
    li.appendChild(head);
    li.appendChild(el('div', 'about-item-detail', item.detail));
    list.appendChild(li);
  }
  section.appendChild(list);
  return section;
}

export function initAboutPanel(): void {
  if (document.getElementById('about-btn')) return;

  const btn = el('button', 'about-btn', '?');
  btn.type = 'button';
  btn.id = 'about-btn';
  btn.title = 'About & credits';
  btn.setAttribute('aria-label', 'About and credits');
  btn.setAttribute('aria-haspopup', 'dialog');

  const overlay = el('div', 'about-overlay');
  overlay.hidden = true;
  const panel = el('div', 'about-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'about-title');

  const header = el('header', 'about-header');
  const title = el('h2', 'about-title', 'About Blockygotchi');
  title.id = 'about-title';
  const close = el('button', 'about-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  header.append(title, close);

  const body = el('div', 'about-body');
  body.appendChild(
    el('p', 'about-intro', 'A playful 3D character viewer and skin editor for blocky characters. A personal hobby project.'),
  );
  body.appendChild(creditList('Libraries', LIBRARIES));
  body.appendChild(creditList('Assets', ASSETS));
  body.appendChild(el('p', 'about-disclaimer', DISCLAIMER));

  panel.append(header, body);
  overlay.appendChild(panel);

  const open = () => {
    overlay.hidden = false;
    close.focus();
  };
  const hide = () => {
    overlay.hidden = true;
    btn.focus();
  };
  btn.addEventListener('click', open);
  close.addEventListener('click', hide);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) hide();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) hide();
  });

  document.body.append(btn, overlay);
}
