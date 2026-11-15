/**
 * AppContext: one registry for the services `main()` builds at startup (scene, character
 * controller, animation manager, ...). Module-level code reads them from here instead of
 * from late-bound `let` placeholders.
 *
 * - `provide` registers a service once; a second provide for the same key throws.
 * - `get` throws if the service isn't ready yet (use it where the service must exist).
 * - `tryGet` returns undefined before startup (use it in callbacks that can fire early).
 */
export type AppContext<S extends object> = {
  provide<K extends keyof S>(key: K, value: S[K]): S[K];
  get<K extends keyof S>(key: K): S[K];
  tryGet<K extends keyof S>(key: K): S[K] | undefined;
  has(key: keyof S): boolean;
};

export function createAppContext<S extends object>(): AppContext<S> {
  const services = new Map<keyof S, unknown>();
  return {
    provide(key, value) {
      if (services.has(key)) throw new Error(`AppContext: "${String(key)}" is already provided`);
      services.set(key, value);
      return value;
    },
    get(key) {
      if (!services.has(key)) throw new Error(`AppContext: "${String(key)}" is not ready yet`);
      return services.get(key) as S[typeof key];
    },
    tryGet(key) {
      return services.get(key) as S[typeof key] | undefined;
    },
    has(key) {
      return services.has(key);
    },
  };
}
