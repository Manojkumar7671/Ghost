import axios from 'axios';

class BrowserbaseClient {
    constructor() {
        this.apiKey = process.env.BROWSERBASE_API_KEY;
        this.projectId = process.env.BROWSERBASE_PROJECT_ID;
        this.isConnected = !!(this.apiKey && this.projectId);
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
            
            const response = await axios.post('https://www.browserbase.com/v1/extract', {
                url: payload.url,
                text_query: payload.query || "Extract all readable text and core metadata structure",
                project_id: this.projectId
            }, {
                headers: {
                    'x-bb-api-key': this.apiKey,
                    'Content-Type': 'application/json'
                },
                timeout: 50000 
            });
            
            return response.data;
        } catch (error) {
            console.error(`[Browserbase Critical Fail]:`, error.response?.data || error.message);
            throw new Error(`Cloud browser execution aborted: ${error.response?.data?.error || error.message}`);
        }
    }
}

export default new BrowserbaseClient();
