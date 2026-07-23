import { chromium } from 'playwright-core';
import pkg from 'pg';

const { Pool } = pkg;
let pool;
if (process.env.SUPABASE_DB_URL) {
    pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, max: 2 });
}

class BrowserbaseClient {
    constructor() {
        this.apiKey = process.env.BROWSERBASE_API_KEY;
        this.projectId = process.env.BROWSERBASE_PROJECT_ID;
        // Always connected since we have local Playwright fallback as well
        this.isConnected = true;
        this.activeBrowser = null;
        this.activePage = null;
    }

    getPromptString() {
        return `
To control the browser, use the "browser_automation" tool.
Payload must include a "url" and an "actions" array.
Supported actions: "click" (requires selector), "type" (requires selector, text), "scroll" (requires amount), "extract" (requires selector).
Example payload:
{
  "url": "https://example.com",
  "actions": [
    { "action": "click", "selector": "#login-btn" },
    { "action": "type", "selector": "#email", "text": "master@manoj.com" },
    { "action": "scroll", "amount": 500 },
    { "action": "extract", "selector": ".dashboard-data" }
  ]
}`;
    }

    async _persistProgress(runId, safeUser, url, actions, results) {
        if (!pool) return;
        try {
            await pool.query(
                `INSERT INTO browserbase_runs (run_id, user_id, url, actions, results, updated_at)
                 VALUES ($1, $2, $3, $4, $5, NOW())
                 ON CONFLICT (run_id) DO UPDATE SET
                     user_id = EXCLUDED.user_id,
                     url = EXCLUDED.url,
                     actions = EXCLUDED.actions,
                     results = EXCLUDED.results,
                     updated_at = NOW()`,
                [runId, safeUser, url, JSON.stringify(actions), JSON.stringify(results)]
            );
        } catch (err) {
            console.error('[Browserbase] Failed to persist progress:', err.message);
        }
    }

    async executeTool(actionName, payload) {
        if (actionName !== 'load_url_or_extract_data' && actionName !== 'execute_actions') {
            throw new Error(`Unsupported browser action: ${actionName}`);
        }

        let { url, actions = [], runId = null, resumeFromStep = 0, safeUser = 'unknown', triggerSource = 'automated_flow' } = payload;
        console.log(`[Security Audit] browserbaseClient.executeTool triggered by source: ${triggerSource}`);
        if (triggerSource !== 'user_message') {
            throw new Error(`Browser automation blocked: Browser execution is restricted in automated or background flows (trigger source: ${triggerSource}).`);
        }

        if (!url) {
            if (this.activePage && !this.activePage.isClosed()) {
                url = this.activePage.url();
                console.log(`[Browserbase] No URL specified in payload, reusing active page URL: ${url}`);
            } else {
                url = 'https://www.google.com';
                console.log(`[Browserbase] No URL specified and no active page open, defaulting to: ${url}`);
            }
        }

        const effectiveRunId = runId || `run_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const wsEndpoint = `wss://connect.browserbase.com?apiKey=${this.apiKey}&projectId=${this.projectId}`;
        const results = [];

        try {
            let browser;
            const useBrowserbase = !!(this.apiKey && this.projectId);

            if (useBrowserbase) {
                if (this.activeBrowser && this.activeBrowser.isConnected()) {
                    console.log('[Browserbase] Reusing active Browserbase session...');
                    browser = this.activeBrowser;
                } else {
                    console.log('[Browserbase] Connecting new Browserbase session...');
                    browser = await chromium.connectOverCDP(wsEndpoint);
                    this.activeBrowser = browser;
                    this.activePage = null;
                }
            } else {
                if (this.activeBrowser && this.activeBrowser.isConnected()) {
                    console.log('[Browserbase] Reusing active local browser session...');
                    browser = this.activeBrowser;
                } else {
                    console.log('[Browserbase] Launching local Chromium browser...');
                    browser = await chromium.launch({ headless: false });
                    this.activeBrowser = browser;
                    this.activePage = null;
                }
            }

            let page;
            if (this.activePage && !this.activePage.isClosed()) {
                console.log('[Browserbase] Reusing active browser page...');
                page = this.activePage;
            } else {
                console.log('[Browserbase] Opening new page...');
                const context = browser.contexts()[0] || await browser.newContext();
                page = await context.newPage();
                this.activePage = page;
            }

            // Determine if we need to navigate or if we are already on the target URL/page
            const currentUrl = page.url();
            let needsNavigation = true;
            if (currentUrl && currentUrl !== 'about:blank') {
                try {
                    const pageDomain = new URL(currentUrl).hostname.replace('www.', '');
                    const targetUrlObj = new URL(url);
                    const targetDomain = targetUrlObj.hostname.replace('www.', '');
                    const isTargetGenericLanding = targetUrlObj.pathname === '/' || targetUrlObj.pathname === '';
                    
                    if (pageDomain === targetDomain) {
                        const cleanCurrent = currentUrl.replace(/\/$/, '');
                        const cleanTarget = url.replace(/\/$/, '');
                        if (isTargetGenericLanding || cleanCurrent === cleanTarget) {
                            console.log(`[Browserbase] Already on target domain/URL "${pageDomain}" (${currentUrl}), skipping navigation.`);
                            needsNavigation = false;
                        }
                    }
                } catch (e) {
                    console.warn('[Browserbase] URL matching failed:', e.message);
                }
            }

            if (needsNavigation) {
                console.log(`[Browserbase] Navigating to URL: ${url}`);
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
                results.push({ step: 'navigation', status: 'success', url });
            } else {
                results.push({ step: 'navigation', status: 'success', url: currentUrl, note: 'reused existing page' });
            }

            for (let i = resumeFromStep; i < actions.length; i++) {
                const step = actions[i];
                const stepTimeout = step.timeout || 15000;

                try {
                    if (step.action === 'click') {
                        await page.click(step.selector, { timeout: stepTimeout });
                        results.push({ step: i, action: 'click', status: 'success', selector: step.selector });

                    } else if (step.action === 'type') {
                        await page.fill(step.selector, step.text, { timeout: stepTimeout });
                        results.push({ step: i, action: 'type', status: 'success', selector: step.selector });

                    } else if (step.action === 'scroll') {
                        await page.mouse.wheel(0, step.amount);
                        await page.waitForTimeout(1000);
                        results.push({ step: i, action: 'scroll', status: 'success', amount: step.amount });

                    } else if (step.action === 'extract') {
                        const content = await page.textContent(step.selector, { timeout: stepTimeout });
                        results.push({ step: i, action: 'extract', status: 'success', data: (content || '').trim() });

                    } else {
                        throw new Error(`Unknown action type: ${step.action}`);
                    }

                    await this._persistProgress(effectiveRunId, safeUser, url, actions, results);

                } catch (stepErr) {
                    results.push({
                        step: i,
                        action: step.action,
                        status: 'failed',
                        error: stepErr.message,
                    });
                    await this._persistProgress(effectiveRunId, safeUser, url, actions, results);
                    return {
                        finalUrl: page.url(),
                        stepResults: results,
                        runId: effectiveRunId,
                        canResumeFromStep: i,
                    };
                }
            }

            return { finalUrl: page.url(), stepResults: results, runId: effectiveRunId, canResumeFromStep: null };
        } catch (error) {
            console.error('Browserbase Execution Error:', error);
            throw new Error(`Browser automation failed: ${error.message}`);
        }
    }
}

export default new BrowserbaseClient();