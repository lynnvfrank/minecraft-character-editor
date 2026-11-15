/**
 * Electron local-server info, shown as a section in the About panel.
 * (It used to be a fixed bar along the bottom, which covered the corner buttons and panels.)
 * Only runs when window.electronAPI exists (i.e. in Electron). Call after initAboutPanel().
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
  const aboutBody = document.querySelector('.about-body');
  if (!aboutBody) return;

  const section = document.createElement('section');
  section.className = 'about-section about-server';
  const heading = document.createElement('h3');
  heading.className = 'about-section-title';
  heading.textContent = 'Local server';
  const url = document.createElement('code');
  url.className = 'about-server-url';
  url.textContent = '…';
  const hint = document.createElement('p');
  hint.className = 'about-server-hint';
  hint.innerHTML =
    'External tools can drive the character with <code>POST /api/skin</code> and <code>POST /api/animation</code> on this address.';
  section.append(heading, url, hint);

  // Right after the intro paragraph.
  const intro = aboutBody.querySelector('.about-intro');
  aboutBody.insertBefore(section, intro ? intro.nextSibling : aboutBody.firstChild);

  window.electronAPI
    .getStatus()
    .then((s) => {
      url.textContent = s.running ? s.url : 'Stopped';
    })
    .catch(() => {
      url.textContent = 'Unavailable';
    });
}
