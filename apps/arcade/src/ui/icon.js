import { createElement } from 'lucide';

/**
 * Lucide icons (ISC), the arcade's one icon set - not emoji, which every phone
 * draws differently, and nothing drawn by hand.
 *
 * Each icon is imported by name where it is used, so only those reach the
 * bundle.
 */

/** An inline SVG icon, sized in CSS pixels, coloured by `currentColor`. */
export function icon(node, size = 18, className = 'ic') {
  const svg = createElement(node, { width: size, height: size, 'stroke-width': 2.25, 'aria-hidden': 'true' });
  svg.setAttribute('class', className);
  return svg;
}

/** Icon then text, for buttons and headings; `after` puts the icon last (Next ›). */
export function withIcon(node, text, { size = 18, after = false } = {}) {
  const span = document.createElement('span');
  span.className = 'ic-label';
  const parts = [icon(node, size), document.createTextNode(text)];
  span.append(...(after ? parts.reverse() : parts));
  return span;
}

/** Shared by every overlay that uses icons: sits on the text baseline. */
const STYLE = `.ic { flex: none; vertical-align: -0.2em; } .ic-label { display: inline-flex; align-items: center; justify-content: center; gap: 0.4em; }`;
let styled = false;
export function styleIcons() {
  if (styled) return;
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);
  styled = true;
}
styleIcons();
