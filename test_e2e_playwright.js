import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runE2ETest() {
    console.log('[E2E Test] Launching Chromium browser...');
    const browser = await chromium.launch({
        headless: true
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on('console', msg => {
        const text = msg.text();
        if (text.includes('[Task Poller]') || text.includes('[PDF') || text.includes('Error') || text.includes('error')) {
            console.log(`[Browser Console]: ${text}`);
        }
    });

    try {
        console.log('[E2E Test] Step 1: Navigating to http://localhost:3000...');
        await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

        console.log('[E2E Test] Logging in as Admin...');
        const showUnlockBtn = page.locator('#showUnlockBtn');
        if (await showUnlockBtn.isVisible()) {
            await showUnlockBtn.click();
        }

        await page.waitForSelector('#authInput', { state: 'visible', timeout: 5000 });
        await page.fill('#authInput', 'knightfall');
        await page.click('#ownerUnlockBtn');

        await page.waitForSelector('#app-layout.active', { state: 'visible', timeout: 10000 });
        console.log('[E2E Test] Admin login successful! App layout active.');

        await page.waitForTimeout(1500);

        // Step 2: Upload real PDF and send "Analyze this PDF"
        console.log('[E2E Test] Step 2: Attaching sample.pdf...');
        const pdfFilePath = path.join(__dirname, 'mini-swe-agent', 'sample.pdf');
        const attachmentInput = page.locator('#attachmentInput');
        await attachmentInput.setInputFiles(pdfFilePath);

        await page.waitForSelector('.message-card.user:has-text("sample.pdf")', { timeout: 5000 });
        console.log('[E2E Test] PDF file attached in chat UI.');

        console.log('[E2E Test] Sending message: "Analyze this PDF"...');
        await page.fill('#userInput', 'Analyze this PDF');
        await page.click('#sendBtn');

        // Step 3 & 4: Wait and watch chat UI for Ghost's response (under 60s)
        console.log('[E2E Test] Waiting for Ghost response in chat UI (up to 60s)...');
        const startTime = Date.now();

        await page.waitForFunction(() => {
            const cards = Array.from(document.querySelectorAll('#chatLog .message-card'));
            const userMsgIndex = cards.findIndex(c => c.classList.contains('user') && c.innerText.includes('Analyze this PDF'));
            if (userMsgIndex === -1) return false;
            const subsequentGhostMsg = cards.slice(userMsgIndex + 1).find(c => c.classList.contains('ghost'));
            return subsequentGhostMsg && subsequentGhostMsg.innerText.trim().length > 5;
        }, { timeout: 60000 });

        const elapsedMs = Date.now() - startTime;
        console.log(`[E2E Test] Ghost responded automatically in ${(elapsedMs / 1000).toFixed(1)}s!`);

        await page.waitForTimeout(2000);

        // Step 5: Ask about completed task ID
        console.log('[E2E Test] Step 5: Sending message: "what happened with task-1789043248597?"...');
        await page.fill('#userInput', 'what happened with task-1789043248597?');
        await page.click('#sendBtn');

        console.log('[E2E Test] Waiting for task evidence response in chat UI...');
        await page.waitForFunction(() => {
            const cards = Array.from(document.querySelectorAll('#chatLog .message-card'));
            const taskMsgIndex = cards.findIndex(c => c.classList.contains('user') && c.innerText.includes('task-1789043248597'));
            if (taskMsgIndex === -1) return false;
            const subsequentGhostMsg = cards.slice(taskMsgIndex + 1).find(c => c.classList.contains('ghost'));
            return subsequentGhostMsg && (subsequentGhostMsg.innerText.includes('task-1789043248597') || subsequentGhostMsg.innerText.includes('Execution Evidence'));
        }, { timeout: 30000 });

        console.log('[E2E Test] Task evidence received in chat UI!');

        await page.waitForTimeout(1000);

        // Step 6: Extract chat transcript as rendered in the browser DOM
        const transcript = await page.evaluate(() => {
            const chatLog = document.getElementById('chatLog');
            if (!chatLog) return 'No chat log found';

            const items = chatLog.querySelectorAll('.message-card, .welcome-card');
            const messages = [];

            items.forEach((item) => {
                const isUser = item.classList.contains('user');
                const isGhost = item.classList.contains('ghost') || item.classList.contains('welcome-card');
                const sender = isUser ? 'USER' : (isGhost ? 'GHOST' : 'SYSTEM');
                const text = (item.innerText || '').trim();
                if (text) {
                    messages.push(`[${sender}]:\n${text}`);
                }
            });

            return messages.join('\n\n---\n\n');
        });

        console.log('\n=================== ACTUAL BROWSER CHAT TRANSCRIPT ===================\n');
        console.log(transcript);
        console.log('\n======================================================================\n');

    } catch (err) {
        console.error('[E2E Test Error]:', err);
        const currentHtml = await page.evaluate(() => {
            const cl = document.getElementById('chatLog');
            return cl ? cl.innerText : 'No chat log';
        });
        console.log('[E2E Current ChatLog]:\n', currentHtml);
    } finally {
        await browser.close();
        console.log('[E2E Test] Browser closed.');
    }
}

runE2ETest();
