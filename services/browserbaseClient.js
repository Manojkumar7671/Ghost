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
        this.isConnected = !!(this.apiKey && this.projectId);
    }

    getPromptString() {
        return `
To control the headless browser, use the "browserbase_execute" tool.
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
        if (!this.isConnected) throw new Error('Browserbase is not configured.');
        if (actionName !== 'load_url_or_extract_data' && actionName !== 'execute_actions') {
            throw new Error(`Unsupported browser action: ${actionName}`);
        }

        const { url, actions = [], runId = null, resumeFromStep = 0, safeUser = 'unknown' } = payload;
        if (!url) throw new Error('URL is required for browserbase_execute.');

        const effectiveRunId = runId || `run_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const wsEndpoint = `wss://connect.browserbase.com?apiKey=${this.apiKey}&projectId=${this.projectId}`;
        let browser;
        const results = [];

        try {
            browser = await chromium.connectOverCDP(wsEndpoint);
            const context = browser.contexts()[0];
            const page = await context.newPage();

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            results.push({ step: 'navigation', status: 'success', url });

            for (let i = resumeFromStep; i < actions.length; i++) {
                const step = actions[i];
                const stepTimeout = step.timeout || 10000;

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
        } finally {
            if (browser) await browser.close();
        }
    }
}

export default new BrowserbaseClient();