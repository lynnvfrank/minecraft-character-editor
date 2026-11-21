/**
 * Home-view "Time of day" control: a sun/moon icon, a 0–24 h slider, the time as a friendly label,
 * and an Auto toggle that lets the day run by itself. A small pill at the bottom center, clear of
 * the Move panels (top left), the Design/Studio buttons (bottom left) and the round buttons
 * (bottom right). It only reads and writes the time-of-day store (state/timeOfDay.ts); the
 * lighting itself is controllers/dayNightController.ts.
 */
import { formatTimeOfDay, isNightTime, partOfDay, wrapHours } from '../lib/dayNight';

export type TimeOfDayPanelDeps = {
  store: {
    get: () => { readonly time: number; readonly auto: boolean };
    setTime: (time: number) => void;
    setAuto: (auto: boolean) => void;
    subscribe: (listener: () => void) => () => void;
  };
};

const SUN_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></g></svg>';
const MOON_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="currentColor"/></svg>';

/** Slider resolution: a quarter of an hour. */
const SLIDER_STEP = 0.25;

export function createTimeOfDayPanel(deps: TimeOfDayPanelDeps) {
  const { store } = deps;

  const root = document.createElement('aside');
  root.id = 'time-of-day-panel';
  root.className = 'time-of-day';
  root.setAttribute('aria-label', 'Time of day');

  const icon = document.createElement('span');
  icon.className = 'time-of-day-icon';
  icon.setAttribute('aria-hidden', 'true');

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'time-of-day-slider';
  slider.min = '0';
  slider.max = '24';
  slider.step = String(SLIDER_STEP);
  slider.title = 'Time of day';
  slider.setAttribute('aria-label', 'Time of day');

  const label = document.createElement('span');
  label.className = 'time-of-day-label';

  const auto = document.createElement('button');
  auto.type = 'button';
  auto.className = 'time-of-day-auto';
  auto.textContent = 'Auto';

  root.append(icon, slider, label, auto);
  // Same layer as the Move panels and the Design button.
  (document.getElementById('app-lower-left-panels')?.parentElement ?? document.body).appendChild(root);

  let shownNight: boolean | null = null;
  let shownLabel = '';
  let shownAuto: boolean | null = null;

  function sync(): void {
    const { time, auto: isAuto } = store.get();
    // The slider's right end (24) is midnight too: leave the thumb there while it's being dragged.
    if (wrapHours(Number(slider.value)) !== time) slider.value = String(time);
    const text = formatTimeOfDay(time);
    if (text !== shownLabel) {
      shownLabel = text;
      label.textContent = text;
      slider.setAttribute('aria-valuetext', `${text} (${partOfDay(time).toLowerCase()})`);
    }
    const night = isNightTime(time);
    if (night !== shownNight) {
      shownNight = night;
      icon.innerHTML = night ? MOON_SVG : SUN_SVG;
      root.classList.toggle('is-night', night);
    }
    if (isAuto !== shownAuto) {
      shownAuto = isAuto;
      auto.classList.toggle('active', isAuto);
      auto.setAttribute('aria-pressed', String(isAuto));
      auto.title = isAuto ? 'Stop the day from passing' : 'Let the day pass by itself';
    }
  }

  slider.addEventListener('input', () => store.setTime(Number(slider.value)));
  // After a mouse/touch drag, give the keyboard back to the Move panel (arrows / WASD walk).
  // Keyboard users keep focus, so arrow keys go on nudging the time.
  let pointerDrag = false;
  slider.addEventListener('pointerdown', () => (pointerDrag = true));
  slider.addEventListener('change', () => {
    if (pointerDrag) slider.blur();
    pointerDrag = false;
  });
  auto.addEventListener('click', (e) => {
    store.setAuto(!store.get().auto);
    if (e.detail > 0) auto.blur();
  });

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
