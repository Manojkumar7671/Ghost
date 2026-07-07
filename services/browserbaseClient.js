import axios from 'axios';
import { chromium } from 'playwright-core';

class BrowserbaseClient {
    constructor() {
        this.apiKey = process.env.BROWSERBASE_API_KEY;
        this.projectId = process.env.BROWSERBASE_PROJECT_ID;
        this.isConnected = !!(this.apiKey && this.projectId);
        this.baseURL = 'https://api.browserbase.com/v1';
    }

    getPromptString() {
        if (!this.isConnected) return "";
        return `
[LIVE BROWSERBASE WEBACTIONS AVAILABLE]
You have access to an autonomous headless cloud browser. To navigate, scrape, or extract real-time web content, you MUST output a raw JSON block.
Available Actions:
1. Action: "load_url"
   Schema: {"tool": "browserbase_execute", "action": "load_url", "payload": {"url": "https://example.com"}}
   Description: Loads a live web page and retrieves the raw text content.
2. Action: "extract_data"
   Schema: {"tool": "browserbase_execute", "action": "extract_data", "payload": {"url": "https://example.com", "query": "Extract the pricing tiers"}}
   Description: Loads the page and extracts visible text for the model to reason over (query is passed through for context, not server-side AI extraction).
`;
    }

    async executeTool(action, payload) {
        if (!this.isConnected) {
            throw new Error('Browserbase configuration missing or incomplete on host.');
        }
        if (!payload || !payload.url) {
            throw new Error('Missing destination URL parameter in payload.');
        }

        let sessionId;
        let browser;
        try {
            console.log(`[Browserbase Engine] Spawning cloud browser instance for action: ${action}`);

            // 1. Create a session — returns a connectUrl (CDP endpoint), NOT a REST extract path
            const sessionRes = await axios.post(`${this.baseURL}/sessions`, {
                projectId: this.projectId
            }, {
                headers: {
                    'x-bb-api-key': this.apiKey,
                    'Content-Type': 'application/json'
                },
                timeout: 20000
            });

            sessionId = sessionRes.data.id;
            const connectUrl = sessionRes.data.connectUrl;
            if (!sessionId || !connectUrl) {
                throw new Error('Browserbase did not return a session ID or connectUrl.');
            }

            // 2. Connect Playwright over CDP to the live cloud browser
            browser = await chromium.connectOverCDP(connectUrl);
            const context = browser.contexts()[0] || await browser.newContext();
            const page = context.pages()[0] || await context.newPage();

            await page.goto(payload.url, { waitUntil: 'domcontentloaded', timeout: 45000 });

            const title = await page.title();
            const bodyText = await page.evaluate(() => document.body?.innerText || "");
            const trimmedText = bodyText.slice(0, 8000); // keep payload sane for LLM context

            return {
                url: payload.url,
                title,
                query: payload.query || null,
                content: trimmedText
            };
        } catch (error) {
            console.error(`[Browserbase Critical Fail]:`, error.response?.data || error.message);
            throw new Error(`Cloud browser execution aborted: ${error.response?.data?.error || error.response?.status || error.message}`);
        } finally {
            if (browser) {
                try { await browser.close(); } catch (e) {}
            }
            if (sessionId) {
                axios.post(`${this.baseURL}/sessions/${sessionId}`, { status: 'REQUEST_RELEASE' }, {
                    headers: { 'x-bb-api-key': this.apiKey, 'Content-Type': 'application/json' }
                }).catch(() => {});
            }
        }
    }
}

export default new BrowserbaseClient();