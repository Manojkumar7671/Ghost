const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

app.get('/ping', (req, res) => res.send('pong'));

async function performDeepResearch(query) {
    if (!TAVILY_API_KEY) return null;
    try {
        const res = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: TAVILY_API_KEY, query: query, search_depth: "advanced", max_results: 3 })
        });
        const data = await res.json();
        if (!data.results || data.results.length === 0) return null;
        let context = "--- LIVE WEB SEARCH CONTEXT ---\n";
        data.results.forEach((r, i) => { context += `Result [${i+1}]: ${r.content}\n\n`; });
        return context;
    } catch (e) { return null; }
}

app.post('/api/chat', async (req, res) => {
    try {
        const userMessage = req.body.message;
        const history = Array.isArray(req.body.history) ? req.body.history : [];
        
        let injectedContext = "";
        const researchTriggers = ['search', 'look up', 'learn', 'research', 'latest', 'news', 'weather', 'who is', 'what is'];
        if (researchTriggers.some(t => userMessage.toLowerCase().includes(t))) {
            const researchResults = await performDeepResearch(userMessage);
            if (researchResults) injectedContext = `\n\n${researchResults}`;
        }

        const systemPrompt = `You are Ghost. Address user as 'Boss'. 
        IF CODE/PAYLOAD GENERATED: Do NOT read aloud. Say "Here is the program, Boss". Route to sidebar.
        Keep all other speech extremely brief.`;

        const messages = [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: userMessage }];

        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages, max_tokens: 350, temperature: 0.5 })
        });

        const groqData = await groqResponse.json();
        const ghostText = groqData.choices[0].message.content;
        
        // logic for silent/concise response
        const hasCode = ghostText.includes('```');
        const spoken = hasCode ? "Here is the program, Boss." : ghostText;

        let audioBase64 = [];
        if (ELEVENLABS_API_KEY && !ghostText.includes('<open:')) {
            const ttsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM`, {
                method: 'POST',
                headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: spoken.replace(/<[^>]*>?/gm, ''), model_id: "eleven_turbo_v2_5" })
            });
            if (ttsResponse.ok) {
                const audioBuffer = await ttsResponse.arrayBuffer();
                audioBase64.push(Buffer.from(audioBuffer).toString('base64'));
            }
        }

        res.json({ success: true, text: ghostText, spoken: spoken, audio_b64: audioBase64 });
    } catch (error) { res.json({ success: false, text: error.message }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.listen(10000, '0.0.0.0', () => console.log('Ghost Active'));
```

### Step 2: Update the Frontend
You also need to make sure your `index.html` calls the new `spoken` field we added. In your `index.html`, find the `processInput` function and change the `playVoice` call to this:

```javascript
// Change this in your index.html:
playVoice(data.text, data.spoken, data.audio_b64);

// And update the playVoice function signature:
async function playVoice(text, spoken, audioB64) {
    // ... logic ...
    playNativeVoice(spoken, hasPayload); // Pass the spoken phrase here
}
```

### Step 3: Push
Run these in your terminal:
```bash
git add .
git commit -m "fix: restored full server logic and integrated spoken-phrase field"
git push origin main