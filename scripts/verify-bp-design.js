const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const port = Number(process.env.PORT || 3788);
const designUrl = `http://127.0.0.1:${port}/bp-animation-design.html?clean`;

const round = value => Math.round(value * 100) / 100;

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const failedRequests = [];
    page.on('requestfailed', request => {
      if (request.resourceType() !== 'media') failedRequests.push(request.url());
    });
    await page.goto(designUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(100);

    const layout = await page.evaluate(() => {
      const rect = element => {
        const bounds = element.getBoundingClientRect();
        return {
          left: Math.round(bounds.left * 100) / 100,
          top: Math.round(bounds.top * 100) / 100,
          right: Math.round(bounds.right * 100) / 100,
          bottom: Math.round(bounds.bottom * 100) / 100,
          width: Math.round(bounds.width * 100) / 100,
          height: Math.round(bounds.height * 100) / 100,
        };
      };
      const contains = (outer, inner) => {
        const parent = outer.getBoundingClientRect();
        const child = inner.getBoundingClientRect();
        return child.left >= parent.left && child.top >= parent.top
          && child.right <= parent.right && child.bottom <= parent.bottom;
      };
      const freeze = (element, name, currentTime) => {
        const animation = element.getAnimations().find(item => item.animationName === name);
        assertAnimation(animation, name);
        animation.pause();
        animation.currentTime = currentTime;
        return animation;
      };
      const assertAnimation = (animation, name) => {
        if (!animation) throw new Error(`Missing animation: ${name}`);
      };

      const pickBoard = document.querySelector('.pick-board-layer');
      const trackReveal = document.querySelector('.countdown-track-reveal');
      const trackProgress = document.querySelector('.countdown-track-progress');
      const trackImage = trackProgress.querySelector('img');
      const pickCards = [...document.querySelectorAll('.pick-card')];
      const banTokens = [...document.querySelectorAll('.ban-token')];
      const banFrames = [...document.querySelectorAll('.ban-frame')];

      freeze(pickBoard, 'panel-rise', 1000);
      freeze(trackReveal, 'track-reveal', 1000);
      const drain = freeze(trackProgress, 'track-drain', 16850);
      pickCards.forEach(card => freeze(card, 'slot-rise', 4000));
      banTokens.forEach(token => freeze(token, 'ban-rise', 3000));
      banFrames.forEach(frame => freeze(frame, 'ban-rise', 3000));

      const suppliedLayers = [
        pickBoard,
        trackImage,
        document.querySelector('.versus-layer'),
        document.querySelector('.division-layer'),
        document.querySelector('.bracket-layer'),
        ...banFrames,
      ];

      return {
        suppliedLayers: suppliedLayers.map(image => ({
          source: new URL(image.currentSrc).pathname,
          naturalSize: [image.naturalWidth, image.naturalHeight],
          loaded: image.complete && image.naturalWidth > 0,
        })),
        pickBoard: rect(pickBoard),
        track: rect(trackReveal),
        trackClipPathAtHalf: getComputedStyle(trackProgress).clipPath,
        trackKeyframes: drain.effect.getKeyframes().map(frame => frame.clipPath),
        trackTiming: getComputedStyle(trackProgress).animationTimingFunction,
        trackDuration: getComputedStyle(trackProgress).animationDuration,
        counts: {
          picks: pickCards.length,
          bans: banTokens.length,
          banFrames: banFrames.length,
          oldShells: document.querySelectorAll('.bp-base-art, .bp-cover-art, .board-core').length,
        },
        contained: {
          picks: pickCards.map(card => contains(card, card.querySelector('img'))),
          bans: banTokens.map(token => contains(token, token.querySelector('img'))),
        },
        layers: {
          track: getComputedStyle(trackReveal).zIndex,
          banFrame: getComputedStyle(banFrames[0]).zIndex,
          banToken: getComputedStyle(banTokens[0]).zIndex,
        },
        preservedDesign: {
          pickDelays: pickCards.map(card => getComputedStyle(card).animationDelay),
          firstEscape: rect(pickCards[0]),
          firstHunter: rect(document.querySelector('.hunter-card-one')),
          pickFont: getComputedStyle(pickCards[0].querySelector('strong')).fontFamily,
          scoreFont: getComputedStyle(document.querySelector('.team-score-left')).fontFamily,
          scoreLeft: getComputedStyle(document.querySelector('.team-score-left')).left,
          scoreRight: getComputedStyle(document.querySelector('.team-score-right')).right,
          scoreTop: getComputedStyle(document.querySelector('.team-score-left')).top,
        },
      };
    });

    console.log(JSON.stringify(layout, null, 2));

    assert.deepEqual(failedRequests, []);
    assert.ok(layout.suppliedLayers.every(layer => layer.loaded));
    assert.ok(layout.suppliedLayers.every(layer => (
      layer.naturalSize[0] === 1920 && layer.naturalSize[1] === 1080
    )));
    assert.ok(layout.suppliedLayers.every(layer => layer.source.startsWith('/assets/match-intro/bp-layout/')));
    assert.deepEqual(layout.pickBoard, {
      left: 0, top: 0, right: 1920, bottom: 1080, width: 1920, height: 1080,
    });
    assert.deepEqual(layout.track, layout.pickBoard);
    assert.deepEqual(layout.trackKeyframes, ['inset(0px)', 'inset(0px 50%)']);
    assert.equal(layout.trackClipPathAtHalf, 'inset(0px 25%)');
    assert.equal(layout.trackTiming, 'linear');
    assert.equal(layout.trackDuration, '30s');
    assert.deepEqual(layout.counts, { picks: 10, bans: 3, banFrames: 3, oldShells: 0 });
    assert.ok(layout.contained.picks.every(Boolean));
    assert.ok(layout.contained.bans.every(Boolean));
    assert.deepEqual(layout.layers, { track: '5', banFrame: '7', banToken: '8' });
    assert.deepEqual(layout.preservedDesign.pickDelays, [
      '1.98s', '2.12s', '2.26s', '2.4s', '2.54s',
      '2.68s', '2.82s', '2.96s', '1.98s', '2.12s',
    ]);
    assert.deepEqual(layout.preservedDesign.firstEscape, {
      left: 27, top: 612, right: 198, bottom: 820, width: 171, height: 208,
    });
    assert.deepEqual(layout.preservedDesign.firstHunter, {
      left: 1142, top: 645.98, right: 1470.98, bottom: 1050.98, width: 328.98, height: 405,
    });
    assert.match(layout.preservedDesign.pickFont, /尔雅酷黑体/);
    assert.match(layout.preservedDesign.scoreFont, /尔雅酷黑体/);
    assert.equal(layout.preservedDesign.scoreLeft, '717.109px');
    assert.equal(layout.preservedDesign.scoreRight, '718.078px');
    assert.equal(layout.preservedDesign.scoreTop, '192.234px');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
