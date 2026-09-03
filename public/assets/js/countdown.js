(function () {
  const ASSET_BASE = '/assets/countdown/';

  function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.min(Math.max(Math.floor(number), min), max);
  }

  function nonNegativeInteger(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.floor(number));
  }

  function currentRemaining(state) {
    if (!state) return 0;
    if (!state.running || !state.deadline) {
      return Math.max(0, Math.ceil(Number(state.remainingSeconds) || 0));
    }
    return Math.max(0, Math.ceil((Number(state.deadline) - Date.now()) / 1000));
  }

  function formatFourDigits(seconds) {
    return formatClock(seconds).replaceAll(':', '');
  }

  function formatClock(seconds) {
    const safe = Math.max(0, Math.ceil(Number(seconds) || 0));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const secs = safe % 60;
    const minuteSeconds = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    return hours > 0 ? `${String(hours).padStart(2, '0')}:${minuteSeconds}` : minuteSeconds;
  }

  function fitImages(root) {
    root.style.transform = 'none';
    window.requestAnimationFrame(() => {
      const available = Math.max(1, window.innerWidth - root.offsetLeft - 24);
      const scale = Math.min(1, available / Math.max(1, root.scrollWidth));
      root.style.transform = scale < 1 ? `scale(${scale})` : 'none';
    });
  }

  function renderImages(root, seconds) {
    const value = formatClock(seconds);
    if (root.children.length !== value.length) {
      root.replaceChildren(...[...value].map(char => {
        if (char === ':') {
          const colon = document.createElement('span');
          colon.className = 'colon';
          colon.setAttribute('aria-hidden', 'true');
          return colon;
        }
        const img = new Image();
        img.alt = char;
        img.addEventListener('load', () => fitImages(root));
        return img;
      }));
    }
    [...value].forEach((char, index) => {
      if (char === ':') return;
      const img = root.children[index];
      if (img.dataset.digit === char) return;
      img.dataset.digit = char;
      img.alt = char;
      img.src = `${ASSET_BASE}${char}.png`;
    });
    fitImages(root);
  }

  for (let digit = 0; digit <= 9; digit += 1) {
    const image = new Image();
    image.src = `${ASSET_BASE}${digit}.png`;
  }

  window.CountdownHub = {
    clamp,
    nonNegativeInteger,
    currentRemaining,
    formatFourDigits,
    formatClock,
    renderImages
  };
})();
