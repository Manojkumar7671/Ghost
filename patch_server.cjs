const fs = require('fs');
const content = fs.readFileSync('server.js', 'utf8');

const newRoute = `
app.post('/api/coding-copilot', chatLimiter, securityMiddleware, async (req, res) => {
    try {
        const token = req.cookies && req.cookies.ghost_session;
        if (!token && process.env.GHOST_DEPLOYMENT_MODE !== 'public') {
            return res.status(401).json({ success: false, error: 'Unauthorized: Session missing or invalid.' });
        }

        const isAdmin = checkIsAdmin(req);
        if (!isAdmin) {
            return res.status(401).json({ success: false, error: 'Unauthorized: Owner access required.' });
        }

        const message = req.body.message || '';
        if (!message.trim()) {
            return res.json({ success: false, error: 'Empty request.' });
        }

        const systemPrompt = "You are a coding copilot. Output a code draft/plan only. You do not execute code, write files, or run commands. Always prefix response with 'PLAN ONLY — NO LOCAL WRITES'.";

        // Code-level guard: use direct LLM chat without passing any tool schemas
        const { chat: localChat } = require('./src/tools/llm.js');
        let responseText = await localChat([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message }
        ], { maxTokens: 2048 });

        // Fallback guard to ensure prefix is strictly applied
        if (!responseText.includes('PLAN ONLY — NO LOCAL WRITES')) {
            responseText = 'PLAN ONLY — NO LOCAL WRITES\\n\\n' + responseText;
        }

        return res.json({ success: true, text: responseText, mode: 'plan-only' });
    } catch (err) {
        console.error('[Coding Copilot Error]:', err);
        return res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});
`;

const updated = content.replace("app.post('/api/runs/:runId/cancel'", newRoute + "\\napp.post('/api/runs/:runId/cancel'");
fs.writeFileSync('server.js', updated);
console.log('Patched server.js');
