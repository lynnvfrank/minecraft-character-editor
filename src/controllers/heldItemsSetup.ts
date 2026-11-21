/**
 * Held items, wired up in one place so main.ts only needs one call and one per-frame line:
 * the store, the Hold panel, the 3D sync and the backup section ('heldItems').
 */
import { isHolderKey, parseHeldItemAssignments, type HeldItemAssignments } from '../domain/heldItems';
import type { SaveSection } from '../domain/saveFile';
import { createHeldItemsStore } from '../state/heldItemsStore';
import type { KeyValueStorage } from '../state/residentsStore';
import { createHoldPanel } from '../ui/holdPanel';
import type { CharacterState } from './characterTypes';
import { createHeldItemsController } from './heldItemsController';

type Route = 'creator' | 'viewer' | 'preview' | 'studio';

export type HeldItemsSetupDeps = {
  storage: KeyValueStorage | null;
  getSceneContext: () => { characters: Record<string, CharacterState> };
  getPrimary: () => CharacterState | undefined;
  /** Studio backup dancers (kept outside the scene's characters record). */
  getDancers: () => readonly CharacterState[];
  /** Holder key for a worn skin (an outfit's image → `outfit:<id>`). */
  keyOf: (skin: string) => string;
  getTimeOfDay?: () => number;
  saveRegistry: { register: (section: SaveSection<HeldItemAssignments>) => void };
};

/** The 'heldItems' backup section: a fully checked record, or null (skipped) when nothing usable. */
export function parseHeldItemsSection(raw: unknown): HeldItemAssignments | null {
  const parsed = parseHeldItemAssignments(raw);
  return parsed && Object.keys(parsed).length > 0 ? parsed : null;
}

export function setupHeldItems(deps: HeldItemsSetupDeps) {
  const store = createHeldItemsStore(deps.storage);

  const selectedKey = (): string | null => {
    const skin = deps.getPrimary()?.currentSkin;
    if (!skin) return null;
    const key = deps.keyOf(skin);
    return isHolderKey(key) ? key : null;
  };

  const panel = createHoldPanel({ getSelectedKey: selectedKey, store });
  const controller = createHeldItemsController({
    store,
    getCharacters: () => Object.values(deps.getSceneContext().characters),
    getExtraCharacters: deps.getDancers,
    keyOf: deps.keyOf,
    getTimeOfDay: deps.getTimeOfDay,
  });

  deps.saveRegistry.register({
    key: 'heldItems',
    label: 'Held items',
    read: () => (Object.keys(store.all()).length > 0 ? { ...store.all() } : undefined),
    parse: parseHeldItemsSection,
    write: (value) => store.merge(value),
    describe: (value) => {
      const n = Object.keys(value).length;
      return `Held items for ${n} ${n === 1 ? 'character' : 'characters'}`;
    },
  });

  let lastKey: string | null | undefined;
  return {
    store,
    /** Per frame: keep hands in line with the store; refresh the panel when someone else is selected. */
    update(route: Route): void {
      controller.update(route);
      const key = selectedKey();
      if (key !== lastKey) {
        lastKey = key;
        panel.refresh();
      }
    },
  };
}
