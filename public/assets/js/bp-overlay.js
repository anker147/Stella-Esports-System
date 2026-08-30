(function () {
  const stage = document.getElementById('bpStage');
  const video = document.getElementById('bpBaseVideo');
  const escapeLogo = document.getElementById('overlayEscapeLogo');
  const hunterLogo = document.getElementById('overlayHunterLogo');
  const escapeName = document.getElementById('overlayEscapeName');
  const hunterName = document.getElementById('overlayHunterName');
  const escapeScore = document.getElementById('overlayEscapeScore');
  const hunterScore = document.getElementById('overlayHunterScore');
  const division = document.getElementById('overlayDivision');
  const round = document.getElementById('overlayRound');
  const game = document.getElementById('overlayGame');
  const stageImage = document.getElementById('overlayStageImage');
  const countdown = document.getElementById('overlayCountdown');
  const countdownTens = document.getElementById('overlayCountdownTens');
  const countdownOnes = document.getElementById('overlayCountdownOnes');
  const timerProgress = document.getElementById('overlayTimerProgress');
  const slotElements = new Map([...document.querySelectorAll('[data-slot]')].map(element => [element.dataset.slot, element]));
  const assetPromises = new Map();

  let events = null;
  let latestPresentation = null;
  let latestSnapshot = null;
  let previousSlots = {};
  let activeIntroEpoch = null;
  let playTimer = null;
  let watchdogTimer = null;
  let timerFrame = null;
  let applyToken = 0;
  let serverOffset = 0;
  let visible = false;
  let lastDigits = '';

  const digitSource = digit => `/assets/match-intro/bp-countdown/${digit}.png`;
  const serverNow = () => Date.now() + serverOffset;

  function clearPlayTimer() {
    clearTimeout(playTimer);
    playTimer = null;
  }

  function invalidate() {
    clearPlayTimer();
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
    visible = false;
    activeIntroEpoch = null;
    document.body.classList.remove('overlay-valid');
    stage.style.animation = 'none';
  }

  function pulseWatchdog() {
    clearTimeout(watchdogTimer);
    if (!visible) return;
    stage.style.animation = 'none';
    void stage.offsetWidth;
    stage.style.animation = 'overlay-watchdog 3.2s steps(1, end) forwards';
    watchdogTimer = setTimeout(invalidate, 3200);
  }

  function showOverlay() {
    visible = true;
    document.body.classList.add('overlay-valid');
    pulseWatchdog();
  }

  function preloadImage(url) {
    if (!url) return Promise.resolve();
    if (assetPromises.has(url)) return assetPromises.get(url);
    const promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = resolve;
      image.onerror = () => reject(new Error(t('bo.loadFailed', { url })));
      image.src = url;
    });
    assetPromises.set(url, promise);
    return promise;
  }

  function preloadVideo() {
    if (video.readyState >= 2) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(t('bo.bgVideoTimeout'))), 8000);
      const done = callback => {
        clearTimeout(timeout);
        video.removeEventListener('loadeddata', loaded);
        video.removeEventListener('error', failed);
        callback();
      };
      const loaded = () => done(resolve);
      const failed = () => done(() => reject(new Error(t('bo.bgVideoFailed'))));
      video.addEventListener('loadeddata', loaded, { once: true });
      video.addEventListener('error', failed, { once: true });
      video.load();
    });
  }

  function preloadSnapshot(snapshot) {
    const urls = [
      snapshot.teams.escape.logoUrl,
      snapshot.teams.hunter.logoUrl,
      snapshot.metadata.stageImageUrl,
      ...Object.values(snapshot.slots).map(slot => slot.imageUrl)
    ].filter(Boolean);
    return Promise.all([preloadVideo(), ...urls.map(preloadImage)]);
  }

  function animateSlot(element, mode) {
    element.classList.remove('slot-reveal', 'slot-clear');
    if (mode === 'slot-clear') element.classList.remove('settled');
    void element.offsetWidth;
    element.classList.add(mode);
    setTimeout(() => {
      element.classList.remove(mode);
      if (mode === 'slot-reveal' && element.classList.contains('is-filled')) element.classList.add('settled');
    }, 760);
  }

  function renderSlot(slotId, slot) {
    const element = slotElements.get(slotId);
    if (!element) return;
    const image = element.querySelector('img');
    const text = element.querySelector('strong');
    const previous = previousSlots[slotId];
    const changed = previous && (
      previous.complete !== slot.complete ||
      previous.characterId !== slot.characterId ||
      previous.text !== slot.text
    );
    if (image) {
      if (slot.imageUrl) {
        if (image.getAttribute('src') !== slot.imageUrl) image.src = slot.imageUrl;
        image.hidden = false;
      } else {
        image.hidden = true;
        image.removeAttribute('src');
      }
    }
    if (text) text.textContent = slot.text || '';
    element.classList.toggle('is-filled', Boolean(slot.complete));
    if (!slot.complete) element.classList.remove('settled');
    if (visible && changed) animateSlot(element, slot.complete ? 'slot-reveal' : 'slot-clear');
  }

  function renderSnapshot(snapshot) {
    escapeLogo.src = snapshot.teams.escape.logoUrl;
    hunterLogo.src = snapshot.teams.hunter.logoUrl;
    escapeName.textContent = snapshot.teams.escape.name;
    hunterName.textContent = snapshot.teams.hunter.name;
    escapeScore.textContent = String(snapshot.score.escape || 0);
    hunterScore.textContent = String(snapshot.score.hunter || 0);
    division.textContent = snapshot.metadata.division;
    round.textContent = snapshot.metadata.round;
    game.textContent = snapshot.metadata.game;
    stageImage.src = snapshot.metadata.stageImageUrl;
    for (const [slotId, slot] of Object.entries(snapshot.slots)) renderSlot(slotId, slot);
    previousSlots = JSON.parse(JSON.stringify(snapshot.slots));
    latestSnapshot = snapshot;
  }

  function renderDigits(seconds) {
    const value = String(Math.max(0, Math.min(99, seconds))).padStart(2, '0');
    if (value === lastDigits) return;
    lastDigits = value;
    countdownTens.src = digitSource(value[0]);
    countdownOnes.src = digitSource(value[1]);
    countdown.classList.toggle('narrow-tens', value[0] === '1');
    countdown.setAttribute('aria-label', value);
  }

  function updateTimer() {
    if (latestSnapshot?.timer) {
      const timer = latestSnapshot.timer;
      const durationMs = Math.max(1, Number(timer.durationSeconds || 30) * 1000);
      const remainingMs = timer.running && timer.deadline
        ? Math.max(0, Number(timer.deadline) - serverNow())
        : Math.max(0, Number(timer.remainingSeconds || 0) * 1000);
      const ratio = Math.max(0, Math.min(1, remainingMs / durationMs));
      renderDigits(Math.ceil(remainingMs / 1000));
      timerProgress.style.clipPath = `inset(0 ${(1 - ratio) * 50}%)`;
    }
    timerFrame = requestAnimationFrame(updateTimer);
  }

  function replayIntro() {
    stage.classList.remove('playing');
    void stage.offsetWidth;
    stage.classList.add('playing');
  }

  function applyAnimationStyle(style) {
    stage.classList.toggle('animation-classic', style === 'classic');
  }

  function startIntro(epoch) {
    const presentation = latestPresentation;
    if (!presentation?.dynamicEnabled || !presentation.snapshot || presentation.introEpoch !== epoch) return;
    if (serverNow() > Number(presentation.commandExpiresAt || 0)) {
      invalidate();
      return;
    }
    activeIntroEpoch = epoch;
    applyAnimationStyle(presentation.snapshot.animationStyle);
    renderSnapshot(presentation.snapshot);
    showOverlay();
    replayIntro();
  }

  function scheduleIntro(presentation) {
    clearPlayTimer();
    if (!presentation.playAt || !presentation.commandExpiresAt) {
      invalidate();
      return;
    }
    if (activeIntroEpoch === presentation.introEpoch && visible) return;
    const delay = Number(presentation.playAt) - serverNow();
    if (Number(presentation.commandExpiresAt) < serverNow()) {
      invalidate();
      return;
    }
    if (delay <= 0) startIntro(presentation.introEpoch);
    else playTimer = setTimeout(() => startIntro(presentation.introEpoch), delay);
  }

  async function applyPresentation(presentation) {
    const token = ++applyToken;
    latestPresentation = presentation;
    if (Number.isFinite(presentation.serverTime)) serverOffset = presentation.serverTime - Date.now();
    if (!presentation.dynamicEnabled || !presentation.snapshot || presentation.visibility === 'hidden') {
      invalidate();
      return;
    }
    try {
      await preloadSnapshot(presentation.snapshot);
      if (token !== applyToken || latestPresentation.sequence !== presentation.sequence) return;
      renderSnapshot(presentation.snapshot);
      if (activeIntroEpoch === presentation.introEpoch && visible) {
        pulseWatchdog();
        return;
      }
      scheduleIntro(presentation);
    } catch {
      invalidate();
    }
  }

  function connect() {
    events?.close();
    events = new EventSource('/api/bp/presentation/events');
    events.addEventListener('presentation', event => {
      try {
        applyPresentation(JSON.parse(event.data));
      } catch {
        invalidate();
      }
    });
    events.addEventListener('heartbeat', event => {
      try {
        const heartbeat = JSON.parse(event.data);
        serverOffset = heartbeat.serverTime - Date.now();
        if (!heartbeat.dynamicEnabled) invalidate();
        else if (visible) pulseWatchdog();
      } catch {
        invalidate();
      }
    });
    events.onerror = invalidate;
  }

  for (let digit = 0; digit <= 9; digit += 1) preloadImage(digitSource(digit)).catch(() => {});
  updateTimer();
  connect();
  window.addEventListener('beforeunload', () => {
    events?.close();
    clearPlayTimer();
    clearTimeout(watchdogTimer);
    cancelAnimationFrame(timerFrame);
  });
})();
