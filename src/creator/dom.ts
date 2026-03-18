/**
 * Lightweight DOM helper for creator panels.
 * Creates elements with attributes and children; reduces createElement/setAttribute verbosity.
 */

/** Create an element with attributes and optional children. */
export function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | undefined>,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== undefined) {
        const name = k === 'className' ? 'class' : k;
        e.setAttribute(name, v);
      }
    }
  }
  for (const c of children) {
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}
