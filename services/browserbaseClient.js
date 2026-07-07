import axios from 'axios';

class BrowserbaseClient {
    constructor() {
        this.apiKey = process.env.BROWSERBASE_API_KEY;
        this.projectId = process.env.BROWSERBASE_PROJECT_ID;
        this.isConnected = !!(this.apiKey && this.projectId);
        this.baseURL = 'https://api.browserbase.com/v1'; // FIXED: was www.browserbase.com (marketing site, 404s)
    }

    getPromptString() {
        if (!this.isConnected) return "";
        return `
[LIVE BROWSERBASE WEBACTIONS AVAILABLE]
You have access to an autonomous headless cloud browser. To navigate, scrape, or extract real-time web content, you MUST output a raw JSON block.
Available Actions:
1. Action: "load_url"
   Schema: {"tool": "browserbase_execute", "action": "load_url", "payload": {"url": "https://example.com"}}
   Description: Loads a live web page and retrieves the raw text/DOM structures.
2. Action: "extract_data"
   Schema: {"tool": "browserbase_execute", "action": "extract_data", "payload": {"url": "https://example.com", "query": "Extract the pricing tiers"}}
   Description: Leverages Browserbase AI extraction to pull specific structured fields or tables from target domains.
`;
    }

    async executeTool(action, payload) {
        if (!this.isConnected) {
            throw new Error('Browserbase configuration missing or incomplete on host.');
        }
        if (!payload || !payload.url) {
            throw new Error('Missing destination URL parameter in payload.');
        }

        try {
            console.log(`[Browserbase Engine] Spawning cloud browser instance for action: ${action}`);

            // 1. Create a session
            const sessionRes = await axios.post(`${this.baseURL}/sessions`, {
                projectId: this.projectId
            }, {
                headers: {
                    'x-bb-api-key': this.apiKey,
                    'Content-Type': 'application/json'
                },
                timeout: 20000
            });

            const sessionId = sessionRes.data.id;
            if (!sessionId) {
                throw new Error('Browserbase did not return a session ID.');
            }

            // 2. Use the Extract endpoint against that session's target URL
            const response = await axios.post(`${this.baseURL}/extract`, {
                sessionId,
                url: payload.url,
                query: payload.query || "Extract all readable text and core metadata structure"
            }, {
                headers: {
                    'x-bb-api-key': this.apiKey,
                    'Content-Type': 'application/json'
                },
                timeout: 50000
            });

            // 3. Always release the session so it doesn't hang billing/usage
            axios.post(`${this.baseURL}/sessions/${sessionId}`, { status: 'REQUEST_RELEASE' }, {
                headers: { 'x-bb-api-key': this.apiKey, 'Content-Type': 'application/json' }
            }).catch(() => {}); // best-effort cleanup, don't block on failure

            return response.data;
        } catch (error) {
            console.error(`[Browserbase Critical Fail]:`, error.response?.data || error.message);
            throw new Error(`Cloud browser execution aborted: ${error.response?.data?.error || error.response?.status || error.message}`);
        }
    }
}

export default new BrowserbaseClient();