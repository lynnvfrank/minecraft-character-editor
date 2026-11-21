/**
 * Home-view weather control: Clear / Rain / Snow / Surprise me, as four small icon buttons that
 * sit inside the time-of-day pill (ui/timeOfDayPanel.ts) after its Auto button, so sky controls
 * are in one place. Narrow windows show a single button instead that steps through the four
 * (styles/_weather.scss decides which shows).
 *
 * It only reads and writes the weather store (state/weather.ts); the rain, snow and light are
 * controllers/weatherController.ts and controllers/dayNightController.ts.
 */
import {
  WEATHER_LABELS,
  WEATHER_MODES,
  nextWeatherMode,
  type WeatherKind,
  type WeatherMode,
} from '../lib/weather';

export type WeatherPanelDeps = {
  store: {
    get: () => { readonly mode: WeatherMode; readonly current: WeatherKind };
    setMode: (mode: WeatherMode) => void;
    subscribe: (listener: () => void) => () => void;
  };
  /** Where to put the control. Default: inside the time-of-day pill (or its layer if there is none). */
  mount?: HTMLElement | null;
};

const ICONS: Record<WeatherMode, string> = { clear: '☀️', rain: '🌧️', snow: '❄️', auto: '🎲' };
const TITLES: Record<WeatherMode, string> = {
  clear: 'Clear skies',
  rain: 'Make it rain',
  snow: 'Let it snow',
  auto: 'Surprise me: the weather changes by itself',
};
const NOW: Record<WeatherKind, string> = { clear: 'clear', rain: 'raining', snow: 'snowing' };

export function createWeatherPanel(deps: WeatherPanelDeps) {
  const { store } = deps;

  const root = document.createElement('div');
  root.id = 'weather-control';
  root.className = 'weather-control';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Weather');

  const buttons = new Map<WeatherMode, HTMLButtonElement>();
  for (const mode of WEATHER_MODES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'weather-button';
    button.dataset.weather = mode;
    button.textContent = ICONS[mode];
    button.title = TITLES[mode];
    button.setAttribute('aria-label', WEATHER_LABELS[mode]);
    button.addEventListener('click', (e) => {
      store.setMode(mode);
      // After a mouse/touch click, give the keyboard back to the Move panel (arrows / WASD walk).
      if (e.detail > 0) button.blur();
    });
    buttons.set(mode, button);
    root.appendChild(button);
  }

  const cycle = document.createElement('button');
  cycle.type = 'button';
  cycle.className = 'weather-button weather-cycle';
  cycle.addEventListener('click', (e) => {
    store.setMode(nextWeatherMode(store.get().mode));
    if (e.detail > 0) cycle.blur();
  });
  root.appendChild(cycle);

  const mount = deps.mount ?? document.getElementById('time-of-day-panel');
  if (mount) {
    mount.appendChild(root);
  } else {
    // No time-of-day pill: a small pill of its own in the same layer.
    root.classList.add('weather-control--standalone');
    (document.getElementById('app-lower-left-panels')?.parentElement ?? document.body).appendChild(root);
  }

  function sync(): void {
    const { mode, current } = store.get();
    for (const [m, button] of buttons) {
      const active = m === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      // Surprise me: a quiet mark on what the sky is doing right now.
      button.classList.toggle('now', mode === 'auto' && m === current);
    }
    const auto = buttons.get('auto')!;
    auto.title = mode === 'auto' ? `Surprise me (now: ${NOW[current]})` : TITLES.auto;
    cycle.textContent = mode === 'auto' && current !== 'clear' ? `${ICONS.auto}${ICONS[current]}` : ICONS[mode];
    const label = mode === 'auto' ? `${WEATHER_LABELS.auto} (now: ${NOW[current]})` : WEATHER_LABELS[mode];
    cycle.title = `Weather: ${label}. Tap to change`;
    cycle.setAttribute('aria-label', `Weather: ${label}. Change`);
    root.dataset.mode = mode;
  }

  const unsubscribe = store.subscribe(sync);
  sync();

  return {
    root,
    dispose: () => {
      unsubscribe();
      root.remove();
    },
  };
}
