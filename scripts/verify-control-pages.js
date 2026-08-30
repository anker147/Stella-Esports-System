const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = `http://127.0.0.1:${Number(process.env.PORT || 3788)}/`;
const outputDir = path.resolve('.screenshots', 'control-v1.5');
const executablePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const cases = [
  { page: 'countdown', width: 1440, height: 900 },
  { page: 'countdown', width: 800, height: 700 },
  { page: 'bp', width: 1440, height: 900 },
  { page: 'bp', width: 1366, height: 768 },
  { page: 'bp', width: 1024, height: 768 },
  { page: 'bp', width: 800, height: 700 },
];

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ executablePath, headless: true });
  const results = [];

  try {
    for (const item of cases) {
      const page = await browser.newPage({ viewport: { width: item.width, height: item.height } });
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);

      // 单地址模式：未登录先通过登录壳进入，再按用例切换页面
      const hasLogin = await page.$('#loginFormUser');
      if (hasLogin) {
        const setupResponse = await page.request.get(`${baseUrl}api/auth/status`).then(response => response.json());
        if (setupResponse.setupRequired) {
          await page.request.post(`${baseUrl}api/auth/setup`, { data: { password: 'release-test-password' } });
        }
        await page.fill('#loginFormUser input[name="account"]', 'operator');
        await page.fill('#loginFormUser input[name="password"]', 'release-test-password');
        await page.click('#loginFormUser button[type=submit]');
        await page.waitForTimeout(900);
      }
      await page.click(`[data-page="${item.page}"]`);
      await page.waitForTimeout(800);

      const metrics = await page.evaluate(pageName => {
        const active = document.querySelector(`[data-page-panel="${pageName}"]`);
        const actionBar = document.querySelector('.bp-context-actions');
        const contextSelects = [...document.querySelectorAll('.bp-context-fields > label > select')];
        const rect = element => {
          if (!element) return null;
          const value = element.getBoundingClientRect();
          return { top: value.top, bottom: value.bottom, width: value.width, height: value.height };
        };
        return {
          page: pageName,
          bodyHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          activeWidth: rect(active)?.width,
          commentatorVisible: pageName !== 'bp' || Boolean(document.querySelector('#bpCommentatorImage')?.offsetParent),
          actionButtonCount: actionBar
            ? [...actionBar.querySelectorAll('button')].filter(button => button.offsetParent).length
            : 0,
          actionBarDisplay: actionBar ? getComputedStyle(actionBar).display : null,
          contextFieldRows: new Set(contextSelects.map(select => Math.round(select.getBoundingClientRect().top))).size,
        };
      }, item.page);

      assert.equal(metrics.bodyHorizontalOverflow, false);
      if (item.page === 'bp') {
        assert.equal(metrics.commentatorVisible, true);
        assert.equal(metrics.actionButtonCount, 11);
        assert.notEqual(metrics.actionBarDisplay, 'none');
        if (item.width > 900) assert.equal(metrics.contextFieldRows, 1);
      }

      const name = `${item.page}-${item.width}x${item.height}.png`;
      await page.screenshot({ path: path.join(outputDir, name), fullPage: true });
      results.push({ ...item, ...metrics, screenshot: name });
      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify(results, null, 2));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
