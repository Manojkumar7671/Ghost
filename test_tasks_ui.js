import { chromium } from 'playwright';

async function testTaskStatusPanel() {
    console.log('[Test] Launching Chromium...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        console.log('[Test] Navigating to http://localhost:3000...');
        await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

        console.log('[Test] Unlocking Ghost as Admin...');
        const showUnlockBtn = page.locator('#showUnlockBtn');
        if (await showUnlockBtn.isVisible()) {
            await showUnlockBtn.click();
        }

        await page.waitForSelector('#authInput', { state: 'visible', timeout: 5000 });
        await page.fill('#authInput', 'knightfall');
        await page.click('#ownerUnlockBtn');

        await page.waitForSelector('#app-layout.active', { state: 'visible', timeout: 10000 });
        console.log('[Test] Admin logged in.');

        // Wait for tasks container in sidebar to display tasks
        console.log('[Test] Waiting for #tasksContainer and #tasksList in sidebar...');
        await page.waitForSelector('#tasksContainer', { state: 'visible', timeout: 5000 });
        await page.waitForSelector('#tasksList .task-item', { state: 'visible', timeout: 5000 });

        const taskCount = await page.locator('#tasksList .task-item').count();
        console.log(`[Test] Successfully loaded ${taskCount} tasks in sidebar.`);

        // Inspect the first 3 tasks in the sidebar
        const taskItemsText = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('#tasksList .task-item'));
            return items.slice(0, 5).map(item => {
                const goal = item.querySelector('.task-item-goal')?.innerText || '';
                const badge = item.querySelector('.task-status-badge')?.innerText || '';
                const meta = item.querySelector('.task-item-meta')?.innerText || '';
                return { goal, badge, meta };
            });
        });

        console.log('\n--- Recent Tasks in Sidebar ---');
        console.log(JSON.stringify(taskItemsText, null, 2));

        // Click on the first task (task-1789043248597)
        console.log('\n[Test] Clicking first task in list to view evidence...');
        const firstTask = page.locator('#tasksList .task-item').first();
        await firstTask.click();

        // Wait for task modal to display
        await page.waitForSelector('#taskEvidenceModal', { state: 'visible', timeout: 5000 });
        console.log('[Test] Task evidence modal opened!');

        // Read modal contents
        const modalData = await page.evaluate(() => {
            return {
                id: document.getElementById('taskModalId')?.innerText,
                badge: document.getElementById('taskModalBadge')?.innerText,
                goal: document.getElementById('taskModalGoal')?.innerText,
                elapsed: document.getElementById('taskModalElapsed')?.innerText,
                evidence: document.getElementById('taskModalEvidence')?.innerText
            };
        });

        console.log('\n=================== MODAL EVIDENCE CONTENT ===================');
        console.log(`Task ID: ${modalData.id}`);
        console.log(`Status:  ${modalData.badge}`);
        console.log(`Goal:    ${modalData.goal}`);
        console.log(`Elapsed: ${modalData.elapsed}`);
        console.log(`Evidence:\n${modalData.evidence}`);
        console.log('===============================================================\n');

        // Close modal
        console.log('[Test] Closing modal via close button...');
        await page.click('#closeTaskModalBtn');
        await page.waitForSelector('#taskEvidenceModal', { state: 'hidden', timeout: 3000 });
        console.log('[Test] Modal successfully closed.');

        console.log('\nSUCCESS: Task status panel and evidence modal verified in browser!');
    } catch (err) {
        console.error('[Test Failed]:', err);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

testTaskStatusPanel();
