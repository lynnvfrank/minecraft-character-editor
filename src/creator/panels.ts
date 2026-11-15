/**
 * Creator panel contract. Every panel builds its DOM in `mount` and registers anything it attaches
 * to long-lived targets (document, window, state slices) on the given scope, so re-entering the
 * creator can tear the previous visit down. Which panels show in which edit mode is a separate
 * table: MODE_PANEL_CONFIGS in modePanels.ts.
 */
import type { DisposableScope } from './lifecycle';

export type CreatorPanel = {
  /** Short name for logs and errors. */
  name: string;
  mount: (scope: DisposableScope) => void;
};

/**
 * Mount panels in order. A panel that throws is reported and skipped, so one broken panel
 * doesn't leave the rest of the creator unbuilt. Returns the names of panels that failed.
 */
export function mountPanels(
  panels: readonly CreatorPanel[],
  scope: DisposableScope,
  onError: (name: string, error: unknown) => void = (name, error) =>
    console.error(`[creator] panel "${name}" failed to mount`, error)
): string[] {
  const failed: string[] = [];
  for (const panel of panels) {
    try {
      panel.mount(scope);
    } catch (error) {
      failed.push(panel.name);
      onError(panel.name, error);
    }
  }
  return failed;
}
