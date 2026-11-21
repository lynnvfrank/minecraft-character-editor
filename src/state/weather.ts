/**
 * The home view's weather choice (clear / rain / snow / auto), persisted to localStorage, plus
 * what the sky is doing right now: the same as the choice, except in auto ("Surprise me") where
 * controllers/weatherController.ts changes it every few minutes. `current` is not persisted.
 * The rules are lib/weather.ts.
 */
import { createSubscribable, type Unsubscribe } from '../lib/subscribable';
import { DEFAULT_WEATHER_MODE, parseWeatherMode, type WeatherKind, type WeatherMode } from '../lib/weather';

export const WEATHER_KEY = 'world.weather';

/** Minimal Storage shape so tests can pass a Map-backed fake (Node has no localStorage). */
export type KeyValueStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export type WeatherSettings = { mode: WeatherMode };
export type WeatherState = WeatherSettings & { current: WeatherKind };

/** Read settings from untrusted JSON; anything malformed falls back to clear. */
export function parseWeatherSettings(json: string | null): WeatherSettings {
  if (!json) return { mode: DEFAULT_WEATHER_MODE };
  try {
    const data: unknown = JSON.parse(json);
    if (!data || typeof data !== 'object') return { mode: DEFAULT_WEATHER_MODE };
    return { mode: parseWeatherMode((data as Record<string, unknown>).mode) };
  } catch {
    return { mode: DEFAULT_WEATHER_MODE };
  }
}

const currentFor = (mode: WeatherMode): WeatherKind => (mode === 'auto' ? 'clear' : mode);

export function createWeatherStore(storage: KeyValueStorage | null) {
  const read = (): string | null => {
    try {
      return storage?.getItem(WEATHER_KEY) ?? null;
    } catch {
      return null;
    }
  };
  const { mode } = parseWeatherSettings(read());
  let state: WeatherState = { mode, current: currentFor(mode) };
  const slice = createSubscribable();

  return {
    get: (): Readonly<WeatherState> => state,
    setMode(next: WeatherMode): void {
      const mode = parseWeatherMode(next);
      if (mode === state.mode) return;
      // Going to auto keeps the sky as it is until the auto weather makes its first pick.
      state = { mode, current: mode === 'auto' ? state.current : mode };
      try {
        storage?.setItem(WEATHER_KEY, JSON.stringify({ mode } satisfies WeatherSettings));
      } catch {
        /* storage full or blocked: keep the in-memory value for this visit */
      }
      slice.notify();
    },
    /** Auto only: what the weather has just turned into. Ignored for a fixed choice. */
    setCurrent(kind: WeatherKind): void {
      if (state.mode !== 'auto' || kind === state.current) return;
      state = { ...state, current: kind };
      slice.notify();
    },
    subscribe: (listener: () => void): Unsubscribe => slice.subscribe(listener),
  };
}

export type WeatherStore = ReturnType<typeof createWeatherStore>;
