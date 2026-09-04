const { webkit } = require('playwright');

(async () => {
  let hasErrors = false;
  const browser = await webkit.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
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

  page.on('response', response => {
    if (response.status() >= 400) {
      console.error(`NETWORK ERROR: ${response.status()} on ${response.url()}`);
    }
  });

  await page.goto('https://ghost-34qz.onrender.com/');
  await page.waitForLoadState('networkidle');

  console.log("Checking UI interaction...");

  try {
      const visitorGateVisible = await page.locator('#visitorGateOverlay').isVisible();
      console.log(`visitorGateOverlay visible: ${visitorGateVisible}`);

      const loginOverlayVisible = await page.locator('#loginOverlay').isVisible();
      console.log(`loginOverlay visible: ${loginOverlayVisible}`);
  } catch (err) {
      console.error(`Interaction error: ${err.message}`);
      hasErrors = true;
  }

  await browser.close();
  if (hasErrors) process.exit(1);
  process.exit(0);
})();
