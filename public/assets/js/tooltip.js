(() => {
  const TOOLTIP_ID = 'systemTooltip';
  const TRIGGER_SELECTOR = '[data-tooltip], [title]:not(option)';
  const HOVER_DELAY = 360;
  const FOCUS_DELAY = 80;
  const HIDE_DELAY = 80;
  const VIEWPORT_MARGIN = 12;
  const TRIGGER_GAP = 8;

  const tooltip = document.createElement('div');
  tooltip.id = TOOLTIP_ID;
  tooltip.className = 'system-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.append(tooltip);

  const hoverQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let trigger = null;
  let pendingTrigger = null;
  let showTimer = 0;
  let hideTimer = 0;

  function clearTimers() {
    window.clearTimeout(showTimer);
    window.clearTimeout(hideTimer);
    showTimer = 0;
    hideTimer = 0;
  }

  function moveNativeTitle(element) {
    if (!(element instanceof HTMLElement) || element.matches('option') || !element.hasAttribute('title')) return;
    const value = String(element.getAttribute('title') || '').trim();
    if (value) element.dataset.tooltip = value;
    else element.removeAttribute('data-tooltip');
    element.removeAttribute('title');
  }

  function syncTitles(root) {
    if (!(root instanceof Element || root instanceof Document)) return;
    if (root instanceof Element && root.matches('[title]:not(option)')) moveNativeTitle(root);
    root.querySelectorAll('[title]:not(option)').forEach(moveNativeTitle);
  }

  function tooltipText(element) {
    moveNativeTitle(element);
    return String(element?.dataset.tooltip || '').trim();
  }

  function findTrigger(target) {
    if (!(target instanceof Element)) return null;
    const element = target.closest(TRIGGER_SELECTOR);
    return element && tooltipText(element) ? element : null;
  }

  function linkDescription(element) {
    const ids = String(element.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    if (!ids.includes(TOOLTIP_ID)) {
      element.setAttribute('aria-describedby', [...ids, TOOLTIP_ID].join(' '));
    }
  }

  function unlinkDescription(element) {
    if (!element) return;
    const ids = String(element.getAttribute('aria-describedby') || '').split(/\s+/)
      .filter(id => id && id !== TOOLTIP_ID);
    if (ids.length) element.setAttribute('aria-describedby', ids.join(' '));
    else element.removeAttribute('aria-describedby');
  }

  function positionTooltip(element) {
    const triggerRect = element.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - tooltipRect.width - VIEWPORT_MARGIN);
    const centeredLeft = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
    const left = Math.min(Math.max(centeredLeft, VIEWPORT_MARGIN), maxLeft);
    let top = triggerRect.top - tooltipRect.height - TRIGGER_GAP;
    let side = 'top';

    if (top < VIEWPORT_MARGIN) {
      top = triggerRect.bottom + TRIGGER_GAP;
      side = 'bottom';
    }

    const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - tooltipRect.height - VIEWPORT_MARGIN);
    tooltip.dataset.side = side;
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(Math.min(Math.max(top, VIEWPORT_MARGIN), maxTop))}px`;
  }

  function hideTooltip(immediate = false) {
    clearTimers();
    pendingTrigger = null;
    const previous = trigger;
    trigger = null;
    unlinkDescription(previous);
    tooltip.dataset.open = 'false';

    if (immediate || reducedMotionQuery.matches) {
      tooltip.hidden = true;
      return;
    }

    hideTimer = window.setTimeout(() => {
      if (!trigger) tooltip.hidden = true;
    }, 130);
  }

  function showTooltip(element) {
    const value = tooltipText(element);
    if (!value || !element.isConnected) return;
    clearTimers();
    if (trigger && trigger !== element) unlinkDescription(trigger);
    trigger = element;
    pendingTrigger = null;
    tooltip.textContent = value;
    tooltip.hidden = false;
    tooltip.dataset.open = 'false';
    linkDescription(element);
    positionTooltip(element);

    window.requestAnimationFrame(() => {
      if (trigger !== element) return;
      positionTooltip(element);
      tooltip.dataset.open = 'true';
    });
  }

  function scheduleShow(element, delay) {
    if (trigger === element) return;
    clearTimers();
    pendingTrigger = element;
    showTimer = window.setTimeout(() => showTooltip(element), delay);
  }

  function scheduleHide(element) {
    if (element !== trigger && element !== pendingTrigger) return;
    window.clearTimeout(showTimer);
    showTimer = 0;
    pendingTrigger = null;
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => hideTooltip(), HIDE_DELAY);
  }

  syncTitles(document);

  document.addEventListener('pointerover', event => {
    if (!hoverQuery.matches || event.pointerType === 'touch') return;
    const element = findTrigger(event.target);
    if (!element) return;
    if (event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) return;
    scheduleShow(element, HOVER_DELAY);
  }, true);

  document.addEventListener('pointerout', event => {
    const element = findTrigger(event.target);
    if (!element) return;
    if (event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) return;
    scheduleHide(element);
  }, true);

  document.addEventListener('focusin', event => {
    const element = findTrigger(event.target);
    if (element) scheduleShow(element, FOCUS_DELAY);
  });

  document.addEventListener('focusout', event => {
    const element = findTrigger(event.target);
    if (!element) return;
    if (event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) return;
    scheduleHide(element);
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && (trigger || pendingTrigger)) hideTooltip(true);
  });

  document.addEventListener('pointerdown', () => hideTooltip(true), true);
  document.addEventListener('scroll', () => hideTooltip(true), true);
  window.addEventListener('resize', () => hideTooltip(true));

  new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      if (mutation.type === 'attributes') {
        const element = mutation.target;
        if (element instanceof HTMLElement && element.hasAttribute('title')) moveNativeTitle(element);
        if (element === trigger) {
          const value = tooltipText(element);
          if (!value) hideTooltip(true);
          else {
            tooltip.textContent = value;
            positionTooltip(element);
          }
        }
        return;
      }

      mutation.addedNodes.forEach(node => {
        if (node instanceof Element) syncTitles(node);
      });
    });
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['title']
  });
})();
