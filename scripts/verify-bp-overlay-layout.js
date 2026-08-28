const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

const port = Number(process.env.PORT || 3788);

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(`http://127.0.0.1:${port}/bp-overlay.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('.pick-board-layer')?.naturalWidth === 1920);
    await page.evaluate(async () => {
      const presentation = await fetch('/api/bp/presentation').then(response => response.json());
      const snapshot = presentation.snapshot;
      document.body.classList.add('overlay-valid');
      const stage = document.querySelector('#bpStage');
      stage.classList.add('playing');
      document.querySelector('#overlayEscapeLogo').src = snapshot.teams.escape.logoUrl;
      document.querySelector('#overlayHunterLogo').src = snapshot.teams.hunter.logoUrl;
      document.querySelector('#overlayEscapeName').textContent = snapshot.teams.escape.name;
      document.querySelector('#overlayHunterName').textContent = snapshot.teams.hunter.name;
      document.querySelector('#overlayEscapeScore').textContent = snapshot.score.escape;
      document.querySelector('#overlayHunterScore').textContent = snapshot.score.hunter;
      document.querySelector('#overlayDivision').textContent = snapshot.metadata.division;
      document.querySelector('#overlayRound').textContent = snapshot.metadata.round;
      document.querySelector('#overlayGame').textContent = snapshot.metadata.game;
      document.querySelector('#overlayStageImage').src = snapshot.metadata.stageImageUrl;
      for (const [slotId, slot] of Object.entries(snapshot.slots)) {
        const element = document.querySelector(`[data-slot="${slotId}"]`);
        if (!element || !slot.complete) continue;
        const image = element.querySelector('img');
        image.src = slot.imageUrl;
        image.hidden = false;
        element.querySelector('strong')?.replaceChildren(slot.text || '');
        element.classList.add('is-filled', 'settled');
      }
    });
    await page.waitForTimeout(4700);
    await page.evaluate(() => {
      document.body.classList.add('overlay-valid');
      const stage = document.querySelector('#bpStage');
      stage.style.animation = 'none';
      stage.style.opacity = '1';
    });
    await page.screenshot({ path: path.resolve('.screenshots', 'bp-overlay-layout.png') });

    const layout = await page.evaluate(() => {
      const rect = element => {
        const value = element.getBoundingClientRect();
        return ['left', 'top', 'right', 'bottom', 'width', 'height']
          .reduce((result, key) => ({ ...result, [key]: Math.round(value[key] * 10) / 10 }), {});
      };
      return {
        boardLoaded: document.querySelector('.pick-board-layer').naturalWidth === 1920,
        foregroundLoaded: getComputedStyle(document.querySelector('.pick-card'), '::after')
          .backgroundImage.includes('pick-frame-foreground.png'),
        escapePortrait: rect(document.querySelector('.escape-card-one img')),
        hunterPortrait: rect(document.querySelector('.hunter-card-one img')),
        division: rect(document.querySelector('.division-copy')),
        round: rect(document.querySelector('.round-copy')),
        game: rect(document.querySelector('.game-copy')),
      };
    });

    assert.equal(layout.boardLoaded, true);
    assert.equal(layout.foregroundLoaded, true);
    assert.deepEqual(layout.escapePortrait, {
      left: 29, top: 650, right: 196, bottom: 799, width: 167, height: 149,
    });
    assert.ok(layout.hunterPortrait.left >= 1144 && layout.hunterPortrait.right <= 1472);
    assert.ok(layout.hunterPortrait.top >= 716 && layout.hunterPortrait.bottom <= 1009);
    assert.equal(layout.round.left, 812);
    assert.equal(layout.game.left, 965);
    assert.ok(layout.round.bottom <= 805 && layout.game.bottom <= 805);
    console.log(JSON.stringify(layout, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
