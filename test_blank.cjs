const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  page.on('response', response => {
    console.log(`${response.status()} ${response.url()}`);
  });

  await page.goto('http://localhost:3000');
  await page.waitForLoadState('networkidle');

  await browser.close();
  process.exit(0);
})();
