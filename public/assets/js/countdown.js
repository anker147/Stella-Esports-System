(function () {
  const ASSET_BASE = '/assets/countdown/';

  function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.min(Math.max(Math.floor(number), min), max);
  }

  function currentRemaining(state) {
    if (!state) return 0;
    if (!state.running || !state.deadline) {
      return Math.max(0, Math.ceil(Number(state.remainingSeconds) || 0));
    }
    return Math.max(0, Math.ceil((Number(state.deadline) - Date.now()) / 1000));
  }

  function formatFourDigits(seconds) {
    const safe = Math.min(99 * 60 + 59, Math.max(0, Math.ceil(Number(seconds) || 0)));
    const minutes = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${String(minutes).padStart(2, '0').slice(-2)}${String(secs).padStart(2, '0')}`;
  }

  function formatClock(seconds) {
    const digits = formatFourDigits(seconds);
    return `${digits.slice(0, 2)}:${digits.slice(2)}`;
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
  }

  for (let digit = 0; digit <= 9; digit += 1) {
    const image = new Image();
    image.src = `${ASSET_BASE}${digit}.png`;
  }

  window.CountdownHub = {
    clamp,
    currentRemaining,
    formatFourDigits,
    formatClock,
    renderImages
  };
})();
