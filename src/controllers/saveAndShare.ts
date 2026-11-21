/**
 * Wires up saving and sharing: the backup file (About panel → "Your stuff") and the shared-combo
 * prompt for links that carry `?combo=<code>`. Called once from main.ts after the stores exist.
 *
 * Other features add their data to the backup with one line (any time; the file is built on demand):
 *   import { saveRegistry } from './controllers/saveAndShare';
 *   saveRegistry.register({ key: 'weather', label: 'Weather', read: () => store.get(), parse: parseWeather, write: (v) => store.set(v) });
 */
import { createSaveRegistry } from '../domain/saveFile';
import { withoutUnknownClips } from '../domain/sequenceImport';
import { decodeShareCode, SHARE_PARAM, urlWithoutShareParam } from '../domain/shareCode';
import { createCoreSaveSections, type CoreSaveStores } from '../state/saveSections';
import { mountBackupSection } from '../ui/backupSection';
import { showSharedComboPrompt, showToast } from '../ui/shareComboUi';

/** The app's one backup registry. */
export const saveRegistry = createSaveRegistry();

export type SaveAndShareDeps = CoreSaveStores & {
  /** Clip keys the app has loaded (empty until the animation list arrives). */
  getClipKeys: () => readonly string[];
};

function dropShareParam(): void {
  try {
    history.replaceState(history.state, '', urlWithoutShareParam(location.pathname, location.search, location.hash));
  } catch {
    /* sandboxed page: the param stays, which only means the prompt shows again on reload */
  }
}

/** If the page was opened from a share link, offer to add its combo. */
function offerSharedCombo(deps: SaveAndShareDeps): void {
  const code = new URLSearchParams(location.search).get(SHARE_PARAM);
  if (code === null) return;
  const decoded = decodeShareCode(code);
  if (!decoded.ok) {
    showToast(decoded.reason, 4000);
    dropShareParam();
    return;
  }
  const { label, steps } = decoded.combo;
  showSharedComboPrompt(label, (add) => {
    dropShareParam();
    if (!add) return;
    const known = new Set(deps.getClipKeys());
    // Before the clip list has loaded we can't tell; playback falls back to idle for unknown clips.
    const safeSteps = known.size > 0 ? withoutUnknownClips(steps, (name) => known.has(name)) : steps;
    const added = deps.savedSequences.importMany([{ id: '', label, steps: safeSteps }]);
    showToast(added > 0 ? 'Added! Find it in All moves → My combos.' : 'You already have this combo.', 3600);
  });
}

export function initSaveAndShare(deps: SaveAndShareDeps): void {
  for (const section of createCoreSaveSections(deps)) saveRegistry.register(section);
  mountBackupSection(saveRegistry);
  offerSharedCombo(deps);
}
