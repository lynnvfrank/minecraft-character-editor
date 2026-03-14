/**
 * SVG icons for editor tools panel. Uses currentColor for theme consistency.
 * Icons are 20×20 viewBox, designed for ~20px display.
 */

function createSvgIcon(paths: string[], viewBox = '0 0 20 20'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

/** Hand icon for Navigate (pan/orbit tool). */
export function iconNavigate(): SVGSVGElement {
  return createSvgIcon([
    'M3.5 8.5c-1.2 0-2 1.2-2 2.5 0 1 .5 1.8 1.2 2.2l-.2 2.5h8l-.2-2.5c.7-.4 1.2-1.2 1.2-2.2 0-1.3-.8-2.5-2-2.5',
    'M7.5 6.5V4c0-.5.4-1 1-1s1 .5 1 1v2.5',
    'M12.5 6.5V4c0-.5-.4-1-1-1s-1 .5-1 1v2.5',
  ]);
}

/** Brush icon. */
export function iconBrush(): SVGSVGElement {
  return createSvgIcon([
    'M4 16l2.5-2.5 3.5 1 5-5-1.5-1.5-5 5-1-3.5L4 16',
    'M7 7l1.5 1.5',
    'M3.5 16.5l2-2.5 2.5 1',
  ]);
}

/** Eraser icon. */
export function iconEraser(): SVGSVGElement {
  return createSvgIcon([
    'M6 11.5l3.5-3.5 5 5-3.5 3.5H4l-1.5-1.5 2.5-3.5z',
    'M9.5 8l5 5',
  ]);
}

/** Paint bucket / fill icon. */
export function iconFill(): SVGSVGElement {
  return createSvgIcon([
    'M4 13.5l3.5-3.5h5l3.5 3.5v2.5H4v-2.5z',
    'M7.5 10V6l4-4 4 4v4',
    'M11.5 6l1.5-1.5',
  ]);
}

/** Eyedropper icon. */
export function iconEyedropper(): SVGSVGElement {
  return createSvgIcon([
    'M5 15l2.5-2.5',
    'M7.5 12.5l1.5 1.5 5-5-1.5-1.5-5 5z',
    'M6.5 17.5l-1.5 1.5',
    'M7.5 12.5l-2.5 2.5',
  ]);
}
