const { chromium } = require('playwright');
const path = require('path');

(async () => {
  let hasErrors = false;
  const userDataDir = path.join(__dirname, 'playwright_user_data');
  const context = await chromium.launchPersistentContext(userDataDir, {
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
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

  console.log("Setting dummy localStorage state to simulate returning user...");
  // We need to visit the domain first to set localStorage
  await page.goto('https://ghost-34qz.onrender.com/');
  await page.evaluate(() => {
      localStorage.setItem('ghost_owner_display_name', 'Manoj');
      // any other things?
  });
  
  console.log("Reloading...");
  await page.reload({ waitUntil: 'networkidle' });

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

  await context.close();
  if (hasErrors) process.exit(1);
  process.exit(0);
})();
