/**
 * Sharing a combo as a link: the "Share" action (copy to clipboard, or show the link to copy by
 * hand), a small toast, and the "Add shared combo?" prompt shown when the app opens from such a
 * link. Everything that comes from a link or a file is put on the page as text, never as HTML.
 * The code format is domain/shareCode.ts.
 */
import type { SavedSequence } from '../domain/sequences';
import { encodeShareCode, shareLink } from '../domain/shareCode';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function layer(): HTMLElement {
  let host = document.getElementById('share-layer');
  if (!host) {
    host = el('div', 'share-layer');
    host.id = 'share-layer';
    document.body.appendChild(host);
  }
  return host;
}

let toastTimer = 0;

/** A short message at the top of the screen that goes away by itself. */
export function showToast(message: string, ms = 2600): void {
  const host = layer();
  host.querySelector('.share-toast')?.remove();
  const toast = el('div', 'share-toast', message);
  toast.setAttribute('role', 'status');
  host.appendChild(toast);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.remove(), ms);
}

/** Clipboard not available: show the link in a field the user can copy from. */
function showLinkField(link: string): void {
  const host = layer();
  host.querySelector('.share-card--link')?.remove();
  const card = el('div', 'share-card share-card--link');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Share link');
  const input = el('input', 'share-link-input');
  input.type = 'text';
  input.readOnly = true;
  input.value = link;
  input.setAttribute('aria-label', 'Link to this combo');
  input.addEventListener('focus', () => input.select());
  const done = el('button', 'share-btn', 'Done');
  done.type = 'button';
  done.addEventListener('click', () => card.remove());
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') card.remove();
  });
  const row = el('div', 'share-card-row');
  row.append(input, done);
  card.append(el('p', 'share-card-text', 'Copy this link to share your combo:'), row);
  host.appendChild(card);
  input.focus();
  input.select();
}

/** Copy a link to `combo` to the clipboard and say so; falls back to a selectable field. */
export async function shareCombo(combo: Pick<SavedSequence, 'label' | 'steps'>): Promise<void> {
  const encoded = encodeShareCode(combo);
  if (!encoded.ok) {
    showToast(encoded.reason);
    return;
  }
  const link = shareLink(encoded.code, location.origin, location.pathname);
  try {
    if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
    await navigator.clipboard.writeText(link);
    showToast('Link copied');
  } catch {
    showLinkField(link);
  }
}

/**
 * Non-blocking "Add shared combo “<label>”?" card. `onAnswer(true)` for Add, `false` for No thanks
 * (or Escape). The label is shown as text.
 */
export function showSharedComboPrompt(label: string, onAnswer: (add: boolean) => void): void {
  const host = layer();
  host.querySelector('.share-card--prompt')?.remove();
  const card = el('div', 'share-card share-card--prompt');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Shared combo');
  const text = el('p', 'share-card-text', `Add shared combo “${label}”?`);
  const add = el('button', 'share-btn share-btn--primary', 'Add');
  add.type = 'button';
  const no = el('button', 'share-btn', 'No thanks');
  no.type = 'button';
  const answer = (yes: boolean) => {
    card.remove();
    onAnswer(yes);
  };
  add.addEventListener('click', () => answer(true));
  no.addEventListener('click', () => answer(false));
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') answer(false);
  });
  const row = el('div', 'share-card-row share-card-row--end');
  row.append(no, add);
  card.append(text, row);
  host.appendChild(card);
}
