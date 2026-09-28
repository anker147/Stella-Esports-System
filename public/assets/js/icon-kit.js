/* Icon kit: renders <svg data-icon="name"> stubs through the Morphicons
 * engine (see assets/vendor/morphicons/) so any icon can morph smoothly
 * into any other. Hydration also covers nodes injected later via a
 * MutationObserver, so classic scripts can just emit the stub markup. */
import { createMorph } from '../vendor/morphicons/dom.js?v=1';
import ICON_NODES from './icon-data.js?v=1';

const SVG_NS = 'http://www.w3.org/2000/svg';
const handles = new WeakMap();
const applied = new WeakMap();
const warned = new Set();

function ensureSvgAttrs(svg) {
  svg.setAttribute('viewBox', '0 0 24 24');
  if (!svg.getAttribute('fill')) {
    svg.setAttribute('fill', svg.hasAttribute('data-icon-fill') ? 'currentColor' : 'none');
  }
  svg.setAttribute('stroke', 'currentColor');
  if (!svg.getAttribute('stroke-width')) svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
}

function hydrate(svg, options = {}) {
  const name = svg.getAttribute('data-icon');
  if (!name || applied.get(svg) === name) return;
  const icon = ICON_NODES[name];
  if (!icon) {
    if (!warned.has(name)) {
      warned.add(name);
      console.warn(`[icon-kit] unknown icon "${name}"`);
    }
    return;
  }
  ensureSvgAttrs(svg);
  let handle = handles.get(svg);
  if (!handle) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const path = document.createElementNS(SVG_NS, 'path');
    svg.appendChild(path);
    handle = createMorph(path, icon, { reducedMotion: 'user' });
    handles.set(svg, handle);
    applied.set(svg, name);
    return;
  }
  applied.set(svg, name);
  if (options.animate) handle.morphTo(icon, options.spring);
  else handle.set(icon);
}

function scan(root) {
  if (root.matches?.('svg[data-icon]')) hydrate(root);
  if (typeof root.querySelectorAll === 'function') {
    root.querySelectorAll('svg[data-icon]').forEach(hydrate);
  }
}

const observer = new MutationObserver(records => {
  for (const record of records) {
    if (record.type === 'attributes') {
      hydrate(record.target);
      continue;
    }
    for (const node of record.addedNodes) scan(node);
  }
});

scan(document);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['data-icon']
});

window.IconKit = {
  has: name => Object.prototype.hasOwnProperty.call(ICON_NODES, name),
  /* Jump to an icon without animating. */
  set(svg, name) {
    if (!svg || !name) return;
    svg.setAttribute('data-icon', name);
    hydrate(svg);
  },
  /* Morph to an icon with spring physics; spring is a preset name
   * ("spring" | "smooth" | "snappy" | "bouncy") or { stiffness, damping }. */
  morph(svg, name, spring) {
    if (!svg || !name) return;
    svg.setAttribute('data-icon', name);
    hydrate(svg, { animate: true, spring });
  },
  handle: svg => handles.get(svg) || null
};
