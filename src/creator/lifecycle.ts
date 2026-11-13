/**
 * Creator lifecycle scope.
 *
 * `initCreator()` runs every time the app enters the creator route and rebuilds
 * the panels. Anything a build step attaches to long-lived targets (document,
 * window, state slices) must be registered here so the next `initCreator()`
 * can tear it down first — otherwise handlers stack up (e.g. one Ctrl+Z
 * undoing N steps after N visits).
 */

export type Disposer = () => void;

export type DisposableScope = {
  /** Register a cleanup function; returns it for convenience. */
  track(dispose: Disposer): Disposer;
  /** addEventListener that is removed on dispose. */
  listen<K extends keyof DocumentEventMap>(
    target: Document,
    type: K,
    handler: (e: DocumentEventMap[K]) => void,
    options?: AddEventListenerOptions
  ): void;
  listen<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    handler: (e: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions
  ): void;
  listen(target: EventTarget, type: string, handler: (e: Event) => void, options?: AddEventListenerOptions): void;
  /** Run and clear all registered disposers (in reverse order). */
  dispose(): void;
  /** Number of live disposers (for tests/diagnostics). */
  size(): number;
};

export function createDisposableScope(): DisposableScope {
  let disposers: Disposer[] = [];
  return {
    track(dispose) {
      disposers.push(dispose);
      return dispose;
    },
    listen(target: EventTarget, type: string, handler: (e: Event) => void, options?: AddEventListenerOptions) {
      target.addEventListener(type, handler, options);
      disposers.push(() => target.removeEventListener(type, handler, options));
    },
    dispose() {
      const current = disposers;
      disposers = [];
      for (let i = current.length - 1; i >= 0; i--) {
        try {
          current[i]!();
        } catch {
          // a failing disposer must not prevent the rest from running
        }
      }
    },
    size() {
      return disposers.length;
    },
  };
}

/** Scope for the current creator visit; disposed at the start of each `initCreator()`. */
export const creatorScope: DisposableScope = createDisposableScope();
