const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  page.on('console', msg => {
    console.log(`PAGE LOG: ${msg.text()}`);
  });

  await page.goto('http://localhost:3000');
  await page.waitForLoadState('networkidle');

  await browser.close();
  process.exit(0);
})();
