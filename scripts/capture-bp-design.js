const { chromium } = require('playwright');
const path = require('node:path');

const port = Number(process.env.PORT || 3788);
const designUrl = `http://127.0.0.1:${port}/bp-animation-design.html?clean`;

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const outputDir = path.resolve('.screenshots', 'bp-design');
  const times = [0.35, 0.8, 1.45, 1.75, 2.05, 2.35, 3.2];

  for (const time of times) {
    await page.goto(designUrl, { waitUntil: 'networkidle' });
    await page.evaluate(() => play());
    await page.waitForTimeout(time * 1000);
    await page.screenshot({
      path: path.join(outputDir, `bp-design-${time.toFixed(2).replace('.', '_')}s.png`),
    });
  }

  await browser.close();
})();
