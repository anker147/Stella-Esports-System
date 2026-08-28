const { chromium } = require('playwright');
const path = require('node:path');

const videoPath = process.argv[2] || 'file:///F:/BP%E9%9D%A2%E6%9D%BF%E5%B1%95%E5%BC%80.mp4';
const outputDir = path.resolve('.screenshots', 'bp-reference');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(videoPath, { waitUntil: 'load' });
  await page.addStyleTag({ content: `
    html, body { margin: 0; width: 100%; height: 100%; background: #000; overflow: hidden; }
    video { width: 100% !important; height: 100% !important; object-fit: contain; }
  ` });
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return video.readyState >= 1 && Number.isFinite(video.duration);
  }, null, { timeout: 15000 });

  const metadata = await page.locator('video').evaluate((video) => ({
    duration: video.duration,
    width: video.videoWidth,
    height: video.videoHeight,
  }));
  console.log(JSON.stringify(metadata));

  const times = [0, 0.35, 0.7, 1.05, 1.4, 1.75, 2.1, 2.45, 2.8, 3.15, 3.5];

  for (let index = 0; index < times.length; index += 1) {
    const time = times[index];
    await page.locator('video').evaluate((video, nextTime) => new Promise((resolve) => {
      video.addEventListener('seeked', resolve, { once: true });
      video.currentTime = nextTime;
    }), time);
    const name = `frame-${String(index).padStart(2, '0')}-${time.toFixed(2).replace('.', '_')}s.png`;
    await page.screenshot({ path: path.join(outputDir, name) });
    console.log(name);
  }

  await browser.close();
})();
