/**
 * "Your stuff" section of the About panel: Back up (download everything the user made as one JSON
 * file) and Restore (pick a file, see what it holds, confirm, apply to the live stores).
 * File contents are untrusted: they are checked by domain/saveFile.ts and shown as text only.
 */
import {
  applySaveFile,
  backupFileName,
  MAX_SAVE_FILE_LENGTH,
  type ParsedSaveFile,
  type SaveRegistry,
} from '../domain/saveFile';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function download(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatDay(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export function createBackupSection(registry: Pick<SaveRegistry, 'build' | 'parse'>): HTMLElement {
  const section = el('section', 'about-section backup-section');
  section.appendChild(el('h3', 'about-section-title', 'Your stuff'));
  section.appendChild(
    el('p', 'backup-hint', 'Save your combos and settings to a file, or bring them back from one.')
  );

  const backupBtn = el('button', 'backup-btn', 'Back up');
  backupBtn.type = 'button';
  backupBtn.id = 'backup-download-btn';
  const restoreBtn = el('button', 'backup-btn', 'Restore');
  restoreBtn.type = 'button';
  restoreBtn.id = 'backup-restore-btn';
  const file = el('input');
  file.type = 'file';
  file.accept = '.json,application/json';
  file.hidden = true;
  const row = el('div', 'backup-row');
  row.append(backupBtn, restoreBtn, file);

  const status = el('p', 'backup-status');
  status.setAttribute('role', 'status');
  const confirmBox = el('div', 'backup-confirm');
  confirmBox.hidden = true;
  section.append(row, status, confirmBox);

  const say = (text: string) => {
    status.textContent = text;
  };
  const closeConfirm = () => {
    confirmBox.hidden = true;
    confirmBox.replaceChildren();
  };

  backupBtn.addEventListener('click', () => {
    closeConfirm();
    try {
      const name = backupFileName(new Date());
      download(name, registry.build());
      say(`Saved ${name}`);
    } catch {
      say('Couldn’t make the backup file. Please try again.');
    }
  });

  restoreBtn.addEventListener('click', () => {
    file.value = ''; // picking the same file twice still fires "change"
    file.click();
  });

  function showSummary(parsed: Extract<ParsedSaveFile, { ok: true }>): void {
    const day = formatDay(parsed.savedAt);
    const list = el('ul', 'backup-list');
    for (const entry of parsed.entries) list.appendChild(el('li', '', entry.summary));
    const go = el('button', 'backup-btn backup-btn--primary', 'Restore');
    go.type = 'button';
    const cancel = el('button', 'backup-btn', 'Cancel');
    cancel.type = 'button';
    go.addEventListener('click', () => {
      const failed = applySaveFile(parsed);
      closeConfirm();
      say(failed.length === 0 ? 'Restored. Everything is back.' : `Restored, except: ${failed.join(', ')}.`);
    });
    cancel.addEventListener('click', () => {
      closeConfirm();
      say('');
    });
    const buttons = el('div', 'backup-row');
    buttons.append(go, cancel);
    const parts: HTMLElement[] = [el('p', 'backup-confirm-title', day ? `This backup from ${day} has:` : 'This backup has:'), list];
    if (parsed.skipped.length > 0) {
      parts.push(el('p', 'backup-note', `Can’t read, will skip: ${parsed.skipped.join(', ')}.`));
    }
    if (parsed.unknown.length > 0) {
      parts.push(el('p', 'backup-note', 'Some parts are from a newer version and will be skipped.'));
    }
    parts.push(el('p', 'backup-note', 'Settings in the list replace the ones you have now.'), buttons);
    confirmBox.replaceChildren(...parts);
    confirmBox.hidden = false;
    go.focus();
  }

  file.addEventListener('change', () => {
    const picked = file.files?.[0];
    if (!picked) return;
    closeConfirm();
    if (picked.size > MAX_SAVE_FILE_LENGTH) {
      say('That file is too big to be a Blockygotchi backup.');
      return;
    }
    picked
      .text()
      .then((text) => {
        const parsed = registry.parse(text);
        if (!parsed.ok) {
          say(parsed.reason);
          return;
        }
        say('');
        showSummary(parsed);
      })
      .catch(() => say('Couldn’t read that file.'));
  });

  return section;
}

/** Put the section in the About panel, right under the intro. Returns false if the panel isn't there. */
export function mountBackupSection(registry: Pick<SaveRegistry, 'build' | 'parse'>): boolean {
  const body = document.querySelector('.about-overlay .about-body');
  if (!body || body.querySelector('.backup-section')) return false;
  const section = createBackupSection(registry);
  const intro = body.querySelector('.about-intro');
  if (intro) intro.after(section);
  else body.prepend(section);
  return true;
}
