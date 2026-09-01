const { chromium } = require('playwright');

(async () => {
  let hasErrors = false;
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.error(`PAGE ERROR: ${msg.text()}`);
      hasErrors = true;
    } else {
      console.log(`PAGE LOG: ${msg.text()}`);
    }
  });

  page.on('pageerror', err => {
    console.error(`PAGE EXCEPTION: ${err.message}`);
    hasErrors = true;
  });

  await page.goto('http://localhost:3000');
  await page.waitForLoadState('networkidle');

  console.log("Checking UI interaction...");

  try {
      // 1. Actions menu click
      const actionsMenuBtn = await page.locator('#actionsMenuBtn').or(page.locator('.actions-menu-btn')).first();
      if (await actionsMenuBtn.count() > 0) {
          console.log("Clicking Actions menu...");
          await actionsMenuBtn.click();
          await page.waitForTimeout(500); // Wait for animation
          const isVisible = await page.locator('#actionsDropdown').isVisible();
          console.log(`Actions dropdown visible after click? ${isVisible}`);
      } else {
          console.log("No actions menu button found");
      }

      // 2. Visitor "Continue" button click
      const continueBtn = await page.locator('text=Continue').or(page.locator('#visitorContinueBtn')).first();
      if (await continueBtn.count() > 0) {
          console.log("Clicking Continue button...");
          await continueBtn.click();
          await page.waitForTimeout(500);
          console.log("Continue button clicked successfully");
      } else {
          console.log("No Continue button found");
      }
  } catch (err) {
      console.error(`Interaction error: ${err.message}`);
  }

  await browser.close();
  if (hasErrors) process.exit(1);
  process.exit(0);
})();
