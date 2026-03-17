import { subscribe, CREATOR_EVENTS } from '../creatorEvents';
import { hexToHsva, hsvaToHex, adjustHexBrightness, isValidHex } from '../types/color';
import { getCreatorPanelsContainer } from './container';
import type { ColorPickerContext } from './api';

const SWATCH_COUNT = 5;
const DELTA_STEP = 20;

let fiveSwatchKeyHandler: ((e: KeyboardEvent) => void) | null = null;

/** Delta for swatch at index i when active is at activeIndex: (i - activeIndex) * 20 */
function getDeltaForIndex(i: number, activeIndex: number): number {
  return (i - activeIndex) * DELTA_STEP;
}

/** Compute the 5 swatch colors from base (color at activeIndex). */
function computeSwatchColors(baseHex: string, activeIndex: number): string[] {
  const result: string[] = [];
  for (let i = 0; i < SWATCH_COUNT; i++) {
    result.push(adjustHexBrightness(baseHex, getDeltaForIndex(i, activeIndex)));
  }
  return result;
}

/** Update color picker UI from hex (call when swatch/hex/toolbar changes). */
export function updateColorPickerFromHex(panel: HTMLElement, hex: string): void {
  const normalized = hex.slice(0, 7).toLowerCase();
  const hsva = hexToHsva(normalized);
  const h = Math.round(hsva.h);
  const s = Math.round(hsva.s);
  const v = Math.round(hsva.v);
  panel.dataset.hue = String(h);
  panel.dataset.sat = String(s);
  panel.dataset.val = String(v);
  const svDot = panel.querySelector('.creator-color-picker-sv-dot') as HTMLElement;
  if (svDot) {
    svDot.style.left = `${s}%`;
    svDot.style.top = `${100 - v}%`;
  }
  const hueDot = panel.querySelector('.creator-color-picker-hue-dot') as HTMLElement;
  if (hueDot) {
    hueDot.style.left = `${(h / 360) * 100}%`;
  }
  const sv = panel.querySelector('.creator-color-picker-sv') as HTMLElement;
  if (sv) {
    sv.style.background = `linear-gradient(to top, rgba(0,0,0,1) 0%, transparent 100%), linear-gradient(to right, rgba(255,255,255,1) 0%, transparent 100%), hsl(${h}, 100%, 50%)`;
  }
}

export function buildColorPickerPanel(ctx: ColorPickerContext): void {
  const container = getCreatorPanelsContainer();
  if (!container) return;

  let panel = document.getElementById('creator-color-picker-panel');
  if (panel) panel.remove();

  const currentColor = ctx.getCurrentColor();
  const hsva = hexToHsva(currentColor);
  const h = Math.round(hsva.h);
  const s = Math.round(hsva.s);
  const v = Math.round(hsva.v);
  const baseGradient = `linear-gradient(to top, rgba(0,0,0,1) 0%, transparent 100%), linear-gradient(to right, rgba(255,255,255,1) 0%, transparent 100%), hsl(${h}, 100%, 50%)`;

  panel = document.createElement('div');
  panel.id = 'creator-color-picker-panel';
  panel.className = 'creator-color-picker-panel';
  panel.setAttribute('aria-label', 'Color picker');
  panel.dataset.hue = String(h);
  panel.dataset.sat = String(s);
  panel.dataset.val = String(v);
  const panelEl = panel;

  let activeSwatchIndex = 2; // center by default
  let swatchColors = computeSwatchColors(currentColor, activeSwatchIndex);

  let lastChangeFromPickerDrag = false;
  let lastChangeFromPickerSwatchClick = false;

  const header = document.createElement('div');
  header.className = 'creator-color-picker-header';
  const titleSpan = document.createElement('span');
  titleSpan.className = 'creator-color-picker-title';
  titleSpan.textContent = 'Color';
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'creator-color-picker-toggle';
  toggleBtn.title = 'Minimize panel';
  toggleBtn.setAttribute('aria-label', 'Minimize panel');
  const minimizeIcon = document.createElement('span');
  minimizeIcon.className = 'creator-color-picker-icon creator-color-picker-icon-minimize';
  minimizeIcon.textContent = '▼';
  const expandIcon = document.createElement('span');
  expandIcon.className = 'creator-color-picker-icon creator-color-picker-icon-expand';
  expandIcon.textContent = '▲';
  toggleBtn.append(minimizeIcon, expandIcon);
  header.append(titleSpan, toggleBtn);

  const expandable = document.createElement('div');
  expandable.className = 'creator-color-picker-expandable';
  const svWrap = document.createElement('div');
  svWrap.className = 'creator-color-picker-sv-wrap';
  const saturationValueArea = document.createElement('div');
  saturationValueArea.className = 'creator-color-picker-sv';
  saturationValueArea.style.background = baseGradient;
  saturationValueArea.setAttribute('role', 'slider');
  saturationValueArea.tabIndex = 0;
  saturationValueArea.setAttribute('aria-label', 'Saturation and brightness');
  saturationValueArea.setAttribute('aria-valuemin', '0');
  saturationValueArea.setAttribute('aria-valuemax', '100');
  const saturationValueIndicator = document.createElement('span');
  saturationValueIndicator.className = 'creator-color-picker-sv-dot';
  saturationValueIndicator.style.left = `${s}%`;
  saturationValueIndicator.style.top = `${100 - v}%`;
  saturationValueArea.appendChild(saturationValueIndicator);
  svWrap.appendChild(saturationValueArea);

  const hueRow = document.createElement('div');
  hueRow.className = 'creator-color-picker-hue-row';
  const hueSlider = document.createElement('div');
  hueSlider.className = 'creator-color-picker-hue-bar';
  hueSlider.setAttribute('role', 'slider');
  hueSlider.tabIndex = 0;
  hueSlider.setAttribute('aria-valuemin', '0');
  hueSlider.setAttribute('aria-valuemax', '360');
  hueSlider.setAttribute('aria-valuenow', String(h));
  hueSlider.setAttribute('aria-label', 'Hue');
  const hueIndicator = document.createElement('span');
  hueIndicator.className = 'creator-color-picker-hue-dot';
  hueIndicator.style.left = `${(h / 360) * 100}%`;
  hueSlider.appendChild(hueIndicator);
  hueRow.appendChild(hueSlider);
  expandable.append(svWrap, hueRow);

  const swatchRow = document.createElement('div');
  swatchRow.className = 'creator-color-picker-swatch-row creator-color-picker-five-swatches';
  const swatchEls: HTMLElement[] = [];
  for (let i = 0; i < SWATCH_COUNT; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'creator-color-picker-swatch-btn';
    btn.dataset.index = String(i);
    btn.style.backgroundColor = swatchColors[i];
    const delta = getDeltaForIndex(i, activeSwatchIndex);
    btn.title = delta === 0 ? 'Current color' : delta > 0 ? `+${delta} brighter` : `${delta} darker`;
    if (i === activeSwatchIndex) btn.classList.add('active');
    btn.addEventListener('click', () => {
      activeSwatchIndex = i;
      lastChangeFromPickerSwatchClick = true;
      ctx.applyColor(swatchColors[i]);
      swatchEls.forEach((el, idx) => {
        el.classList.toggle('active', idx === activeSwatchIndex);
      });
    });
    swatchRow.appendChild(btn);
    swatchEls.push(btn);
  }

  panel.append(header, expandable, swatchRow);

  let colorPickerMinimized = false;
  const updateColorPickerCollapsedUI = () => {
    panelEl.classList.toggle('creator-color-picker-panel-collapsed', colorPickerMinimized);
    minimizeIcon.setAttribute('aria-hidden', String(colorPickerMinimized));
    expandIcon.setAttribute('aria-hidden', String(!colorPickerMinimized));
    toggleBtn.title = colorPickerMinimized ? 'Expand panel' : 'Minimize panel';
    toggleBtn.setAttribute('aria-label', colorPickerMinimized ? 'Expand panel' : 'Minimize panel');
  };
  toggleBtn.addEventListener('click', () => {
    colorPickerMinimized = !colorPickerMinimized;
    updateColorPickerCollapsedUI();
  });
  updateColorPickerCollapsedUI();

  /** Update current color and UI. Pass addToSwatch=false during drag to avoid adding every frame. */
  const commitFromPicker = (addToSwatch = false): void => {
    const hVal = Math.max(0, Math.min(360, parseFloat(panelEl.dataset.hue ?? '0')));
    const sVal = Math.max(0, Math.min(100, parseFloat(panelEl.dataset.sat ?? '100')));
    const vVal = Math.max(0, Math.min(100, parseFloat(panelEl.dataset.val ?? '100')));
    const hex = hsvaToHex(hVal, sVal, vVal, 100).slice(0, 7);
    lastChangeFromPickerDrag = true;
    ctx.applyColor(hex, addToSwatch);
  };

  const updateActiveSwatchPreview = (hex: string): void => {
    swatchEls[activeSwatchIndex].style.backgroundColor = hex;
  };

  const setSaturationValueFromPoint = (clientX: number, clientY: number, addToSwatch: boolean): void => {
    const rect = saturationValueArea.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const sVal = Math.round(x * 100);
    const vVal = Math.round((1 - y) * 100);
    panelEl.dataset.sat = String(sVal);
    panelEl.dataset.val = String(vVal);
    saturationValueIndicator.style.left = `${sVal}%`;
    saturationValueIndicator.style.top = `${y * 100}%`;
    const hVal = parseFloat(panelEl.dataset.hue ?? '0');
    saturationValueArea.style.background = `linear-gradient(to top, rgba(0,0,0,1) 0%, transparent 100%), linear-gradient(to right, rgba(255,255,255,1) 0%, transparent 100%), hsl(${hVal}, 100%, 50%)`;
    const hex = hsvaToHex(hVal, sVal, vVal, 100).slice(0, 7);
    updateActiveSwatchPreview(hex);
    commitFromPicker(addToSwatch);
  };

  const setHueFromPoint = (clientX: number, addToSwatch: boolean): void => {
    const rect = hueSlider.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const hVal = Math.round(x * 360);
    panelEl.dataset.hue = String(hVal);
    hueIndicator.style.left = `${x * 100}%`;
    const sVal = parseFloat(panelEl.dataset.sat ?? '100');
    const vVal = parseFloat(panelEl.dataset.val ?? '100');
    saturationValueArea.style.background = `linear-gradient(to top, rgba(0,0,0,1) 0%, transparent 100%), linear-gradient(to right, rgba(255,255,255,1) 0%, transparent 100%), hsl(${hVal}, 100%, 50%)`;
    const hex = hsvaToHex(hVal, sVal, vVal, 100).slice(0, 7);
    updateActiveSwatchPreview(hex);
    commitFromPicker(addToSwatch);
  };

  const onSaturationValueDrag = (e: MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setSaturationValueFromPoint(e.clientX, e.clientY, false);
    const move = (m: MouseEvent) => setSaturationValueFromPoint(m.clientX, m.clientY, false);
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      commitFromPicker(true);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  const onHueDrag = (e: MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setHueFromPoint(e.clientX, false);
    const move = (m: MouseEvent) => setHueFromPoint(m.clientX, false);
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      commitFromPicker(true);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  const onSaturationValueTouch = (e: TouchEvent, addToSwatch: boolean) => {
    e.preventDefault();
    const t = e.touches[0];
    if (t) setSaturationValueFromPoint(t.clientX, t.clientY, addToSwatch);
  };
  const onHueTouch = (e: TouchEvent, addToSwatch: boolean) => {
    e.preventDefault();
    const t = e.touches[0];
    if (t) setHueFromPoint(t.clientX, addToSwatch);
  };
  saturationValueArea.addEventListener('mousedown', onSaturationValueDrag);
  saturationValueArea.addEventListener('touchstart', (e) => {
    onSaturationValueTouch(e, false);
    const move = (ev: TouchEvent) => onSaturationValueTouch(ev, false);
    const end = () => {
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
      commitFromPicker(true);
    };
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end, { once: true });
  }, { passive: false });
  hueSlider.addEventListener('mousedown', onHueDrag);
  hueSlider.addEventListener('touchstart', (e) => {
    onHueTouch(e, false);
    const move = (ev: TouchEvent) => onHueTouch(ev, false);
    const end = () => {
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
      commitFromPicker(true);
    };
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end, { once: true });
  }, { passive: false });

  const updateActiveSwatchUI = () => {
    swatchEls.forEach((el, idx) => {
      el.classList.toggle('active', idx === activeSwatchIndex);
      el.draggable = idx === activeSwatchIndex;
    });
  };
  updateActiveSwatchUI();

  swatchEls.forEach((el) => {
    el.addEventListener('dragstart', (e: Event) => {
      if (el !== swatchEls[activeSwatchIndex]) return;
      const ev = e as DragEvent;
      if (ev.dataTransfer) {
        ev.dataTransfer.setData('text/plain', ctx.getCurrentColor());
        ev.dataTransfer.effectAllowed = 'copy';
      }
    });
  });

  swatchRow.classList.add('creator-color-picker-drop-target');
  swatchRow.addEventListener('dragover', (e) => {
    e.preventDefault();
    (e as DragEvent).dataTransfer!.dropEffect = 'copy';
    swatchRow.classList.add('creator-color-picker-drag-over');
  });
  swatchRow.addEventListener('dragleave', (e) => {
    if (!swatchRow.contains((e as DragEvent).relatedTarget as Node)) {
      swatchRow.classList.remove('creator-color-picker-drag-over');
    }
  });
  swatchRow.addEventListener('drop', (e) => {
    e.preventDefault();
    swatchRow.classList.remove('creator-color-picker-drag-over');
    const hex = (e as DragEvent).dataTransfer?.getData('text/plain');
    if (hex && isValidHex(hex)) {
      ctx.applyColor(hex.toLowerCase(), false);
    }
  });

  const handleFiveSwatchKeys = (e: KeyboardEvent) => {
    if (document.body.dataset.route !== 'creator') return;
    const target = e.target as HTMLElement;
    const inInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (inInput) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'z' || e.key === 'Z' || e.key === 'ArrowLeft') {
      if (activeSwatchIndex <= 0) return;
      e.preventDefault();
      activeSwatchIndex--;
      lastChangeFromPickerSwatchClick = true;
      ctx.applyColor(swatchColors[activeSwatchIndex]!);
      updateActiveSwatchUI();
    } else if (e.key === 'c' || e.key === 'C' || e.key === 'ArrowRight') {
      if (activeSwatchIndex >= SWATCH_COUNT - 1) return;
      e.preventDefault();
      activeSwatchIndex++;
      lastChangeFromPickerSwatchClick = true;
      ctx.applyColor(swatchColors[activeSwatchIndex]!);
      updateActiveSwatchUI();
    }
  };
  if (fiveSwatchKeyHandler) document.removeEventListener('keydown', fiveSwatchKeyHandler);
  fiveSwatchKeyHandler = handleFiveSwatchKeys;
  document.addEventListener('keydown', handleFiveSwatchKeys);

  subscribe(CREATOR_EVENTS.CURRENT_COLOR_CHANGE, (e: CustomEvent<{ color: string }>) => {
    const color = (e.detail?.color ?? ctx.getCurrentColor()).slice(0, 7).toLowerCase();
    const picker = document.getElementById('creator-color-picker-panel') as HTMLElement | null;
    if (!picker) return;
    updateColorPickerFromHex(picker, color);
    if (lastChangeFromPickerSwatchClick) {
      lastChangeFromPickerSwatchClick = false;
      updateActiveSwatchUI();
      return;
    }
    if (lastChangeFromPickerDrag) {
      lastChangeFromPickerDrag = false;
      swatchColors = computeSwatchColors(color, activeSwatchIndex);
      swatchEls.forEach((el, i) => {
        (el as HTMLElement).style.backgroundColor = swatchColors[i];
        const delta = getDeltaForIndex(i, activeSwatchIndex);
        el.title = delta === 0 ? 'Current color' : delta > 0 ? `+${delta} brighter` : `${delta} darker`;
      });
      updateActiveSwatchUI();
      return;
    }
    activeSwatchIndex = 2;
    swatchColors = computeSwatchColors(color, activeSwatchIndex);
    swatchEls.forEach((el, i) => {
      (el as HTMLElement).style.backgroundColor = swatchColors[i];
      const delta = getDeltaForIndex(i, activeSwatchIndex);
      el.title = delta === 0 ? 'Current color' : delta > 0 ? `+${delta} brighter` : `${delta} darker`;
    });
    updateActiveSwatchUI();
  });

  container.appendChild(panel);
  updateColorPickerFromHex(panel as HTMLElement, currentColor);
}
