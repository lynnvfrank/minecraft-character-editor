/**
 * Electron status bar and first-run onboarding.
 * Only runs when window.electronAPI exists (i.e. in Electron).
 */

declare global {
  interface Window {
    electronAPI?: {
      getStatus: () => Promise<{ running: boolean; port: number; url: string; isFirstRun?: boolean }>;
      startServer: () => Promise<{ port: number; url: string }>;
      stopServer: () => Promise<{ port: number }>;
    };
  }
}

export function initElectronStatus(): void {
  if (typeof window === 'undefined' || !window.electronAPI) return;

  const api = window.electronAPI;
  const bar = document.createElement('div');
  bar.id = 'electron-status-bar';
  bar.innerHTML = `
    <div class="electron-status-content">
      <span class="electron-status-label">Server</span>
      <span class="electron-status-value" id="electron-status-url">—</span>
      <button type="button" id="electron-status-toggle" class="electron-status-toggle" aria-label="Collapse">▼</button>
    </div>
    <div class="electron-status-details" id="electron-status-details">
      <div class="electron-status-first-run" id="electron-status-first-run" hidden>
        <p><strong>First run:</strong> The app runs a local server. External tools can control the character via <code>POST /api/skin</code> and <code>POST /api/animation</code>.</p>
      </div>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    body.electron-app { --electron-status-bar-height: 34px; }
    body.electron-app { padding-bottom: var(--electron-status-bar-height); }
    body.electron-app #creator-view-wrapper {
      bottom: var(--electron-status-bar-height);
    }
    body.electron-app[data-route="creator"] #creator-panel {
      bottom: var(--electron-status-bar-height);
    }
    body.electron-app[data-route="viewer"] .app-lower-left-panels {
      bottom: calc(var(--electron-status-bar-height) + 0.75rem);
    }
    #electron-status-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: rgba(0,0,0,0.85);
      color: #ccc;
      font-size: 12px;
      font-family: system-ui, sans-serif;
      z-index: 10000;
      border-top: 1px solid #333;
    }
    .electron-status-content { display: flex; align-items: center; gap: 8px; padding: 6px 12px; }
    .electron-status-label { font-weight: 600; }
    .electron-status-value { flex: 1; font-family: monospace; }
    .electron-status-toggle { background: none; border: none; color: #888; cursor: pointer; padding: 2px 6px; font-size: 10px; }
    .electron-status-details { padding: 0 12px 8px; max-height: 80px; overflow: auto; }
    .electron-status-details.collapsed { display: none; }
    .electron-status-first-run { background: rgba(80,120,200,0.2); padding: 8px; border-radius: 4px; margin-top: 6px; }
    .electron-status-first-run p { margin: 0; }
    .electron-status-first-run code { font-size: 11px; }
  `;
  document.head.appendChild(style);
  document.body.classList.add('electron-app');
  document.body.appendChild(bar);

  const urlEl = document.getElementById('electron-status-url')!;
  const detailsEl = document.getElementById('electron-status-details')!;
  const firstRunEl = document.getElementById('electron-status-first-run')!;
  const toggleBtn = document.getElementById('electron-status-toggle')!;

  let collapsed = false;
  const syncLayoutOffset = () => {
    const height = Math.ceil(bar.getBoundingClientRect().height);
    document.body.style.setProperty('--electron-status-bar-height', `${height}px`);
  };

  toggleBtn.addEventListener('click', () => {
    collapsed = !collapsed;
    detailsEl.classList.toggle('collapsed', collapsed);
    toggleBtn.textContent = collapsed ? '▶' : '▼';
    syncLayoutOffset();
  });

  async function refresh() {
    try {
      const s = await api.getStatus();
      urlEl.textContent = s.running ? s.url : 'Stopped';
      if (s.isFirstRun && firstRunEl) {
        firstRunEl.hidden = false;
      }
      syncLayoutOffset();
    } catch {
      urlEl.textContent = 'Error';
      syncLayoutOffset();
    }
  }

  syncLayoutOffset();
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => syncLayoutOffset());
    observer.observe(bar);
  }
  refresh();
}
