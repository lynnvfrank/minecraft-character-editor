/**
 * "Dancers" section of the dance studio panel (`#/studio`): how many backup dancers join the
 * lead, how they stand, and whether they trail it a little (a canon).
 *
 * A separate module from studioPanel.ts, like the "Camera" section: it builds its own `<section>`
 * and inserts it into the panel. It only edits the settings store; the dancers themselves are
 * controllers/studioDancersController.ts.
 */
import { DANCE_OFFSETS_SEC, FORMATIONS, MAX_BACKUP_DANCERS, type Formation } from '../domain/groupDance';
import type { GroupDanceStore } from '../state/groupDanceStore';

export type StudioDancersPanelDeps = {
  /** The studio panel root (`#studio-panel`). */
  mount: HTMLElement | null;
  store: GroupDanceStore;
};

const COUNT_LABELS = ['Solo', '+1', '+2'];
const COUNT_TITLES = ['Dance alone', 'One backup dancer', 'Two backup dancers'];
const FORMATION_LABELS: Record<Formation, string> = { line: 'Line', triangle: 'Triangle', stagger: 'Stagger' };
const FORMATION_TITLES: Record<Formation, string> = {
  line: 'Side by side',
  triangle: 'Lead in front, two behind',
  stagger: 'A diagonal going back',
};

function offsetLabel(sec: number): string {
  if (sec === 0) return 'Together';
  if (sec === 0.25) return '¼ s';
  if (sec === 0.5) return '½ s';
  return `${sec} s`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function createStudioDancersPanel(deps: StudioDancersPanelDeps) {
  const { store } = deps;
  const root = el('section', 'studio-section studio-dancers');
  root.id = 'studio-dancers';
  root.append(el('h3', 'studio-section-title', 'Dancers'));

  /** A labelled row of choice buttons; returns a function that marks the chosen one. */
  function choiceRow<T>(
    label: string,
    options: readonly { value: T; text: string; title: string }[],
    onPick: (value: T) => void
  ): { row: HTMLElement; show: (value: T, enabled: boolean) => void } {
    const row = el('div', 'studio-row studio-dancers-row');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', label);
    row.append(el('span', 'studio-dancers-label', label));
    const buttons = options.map((opt) => {
      const btn = el('button', 'studio-btn studio-dancers-btn', opt.text);
      btn.type = 'button';
      btn.title = opt.title;
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', () => onPick(opt.value));
      row.append(btn);
      return btn;
    });
    return {
      row,
      show(value, enabled) {
        buttons.forEach((btn, i) => {
          btn.setAttribute('aria-pressed', String(options[i]!.value === value));
          btn.disabled = !enabled;
        });
      },
    };
  }

  const counts = Array.from({ length: MAX_BACKUP_DANCERS + 1 }, (_, n) => ({
    value: n,
    text: COUNT_LABELS[n] ?? `+${n}`,
    title: COUNT_TITLES[n] ?? `${n} backup dancers`,
  }));
  const countRow = choiceRow('Backup', counts, (count) => store.set({ count }));
  const formationRow = choiceRow(
    'Formation',
    FORMATIONS.map((f) => ({ value: f, text: FORMATION_LABELS[f], title: FORMATION_TITLES[f] })),
    (formation) => store.set({ formation })
  );
  const offsetRow = choiceRow(
    'Delay',
    DANCE_OFFSETS_SEC.map((sec) => ({
      value: sec as number,
      text: offsetLabel(sec),
      title: sec === 0 ? 'Everyone moves at the same time' : `Backup dancers follow ${sec} seconds behind`,
    })),
    (offsetSec) => store.set({ offsetSec })
  );

  const hint = el('p', 'studio-hint');
  hint.setAttribute('aria-live', 'polite');
  root.append(countRow.row, formationRow.row, offsetRow.row, hint);

  // Under the "Camera" section when it is there, else right under the header.
  const anchor = deps.mount?.querySelector('#studio-capture') ?? deps.mount?.querySelector('.studio-header');
  if (anchor) anchor.after(root);
  else deps.mount?.prepend(root);

  function render(): void {
    const s = store.get();
    const group = s.count > 0;
    countRow.show(s.count, true);
    formationRow.show(s.formation, group);
    offsetRow.show(s.offsetSec, group);
    hint.textContent = !group
      ? 'Bring friends on stage to dance along.'
      : s.offsetSec > 0
        ? 'Your friends follow a beat behind, like a wave.'
        : 'Your friends copy every move.';
  }
  store.subscribe(render);
  render();

  return { render };
}
