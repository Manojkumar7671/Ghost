app.post('/api/chat', async (req, res) => {
    try {
        const message = req.body.message;
        const history = req.body.history || []; 

        // 🛑 THE HARD INTERCEPTOR (BYPASS THE AI ENTIRELY) 🛑
        // If Boss asks about these topics, the server responds instantly. 
        // The LLM never even sees the question, so it physically cannot hallucinate.
        const lowerMsg = message.toLowerCase();
        const forbiddenTopics = ['schedule', 'calendar', 'meeting', 'agenda', 'my day'];
        
        if (forbiddenTopics.some(topic => lowerMsg.includes(topic))) {
            return res.json({ 
                success: true, 
                text: "I am a cloud entity, Boss. I do not have access to your local Mac calendar or system files." 
            });
        }

        // THE "CATTLE PROD" INJECTION (Kept for other rules)
        const enforcedMessage = `[SYSTEM OVERRIDE ENFORCEMENT: 
1. Keep voice response to MAX 2 sentences. 
3. You MUST output <search> query </search> for weather, news, or time. Do not guess.
4. If providing code, stop speaking and type 'matrix' above it.]

User command: ${message}`;

        let formattedMessages = [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: enforcedMessage }
        ];

        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.1-8b-instant',
                messages: formattedMessages,
                temperature: 0.15 
            })
        });

        if (!groqRes.ok) throw new Error("Primary engine fault");
        const data = await groqRes.json();
        let text = data.choices[0].message.content;

        const searchMatch = text.match(/<search>([\s\S]*?)<\/search>/i);
        if (searchMatch) {
            const query = searchMatch[1].trim();
            try {
                const searchRes = await fetch("https://api.tavily.com/search", {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ api_key: TAVILY_API_KEY, query: query, max_results: 3 })
                });
                const searchData = await searchRes.json();
                let searchOutput = searchData.results.map(r => `Title: ${r.title}\nURL: ${r.url}\nSummary: ${r.content}`).join("\n\n");
                
                text = text.replace(/<search>([\s\S]*?)<\/search>/ig, `\nmatrix\n\`\`\`text\n[Web Oracle Execution: Success]\n\n${searchOutput}\n\`\`\`\n`);
            } catch (err) {
                text = text.replace(/<search>([\s\S]*?)<\/search>/ig, `\n[Web Oracle Fault: ${err.message}]\n`);
            }
        }

        res.json({ success: true, text: text.trim() });

    } catch (e) {
        console.error("Backend Error:", e);
        res.json({ success: false, text: "System error, Boss. I am investigating." });
    }
});
