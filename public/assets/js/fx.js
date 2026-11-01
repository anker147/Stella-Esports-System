(function () {
  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  window.PageFX = {
    stagger(nodes, { base = 0, step = 40, cap = 14 } = {}) {
      if (prefersReducedMotion()) return;
      Array.from(nodes).forEach((node, index) => {
        node.classList.add('fly-in-item');
        node.style.animationDelay = `${base + Math.min(index, cap) * step}ms`;
      });
    },
    fly(node) {
      if (prefersReducedMotion()) return;
      node.classList.add('fly-in-item');
      node.style.animationDelay = '0ms';
    }
  };
})();
