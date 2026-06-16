const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GHOST_CORE = `You are Ghost, an AI engineered by Manoj Kumar. Be concise, witty, British. Max 2 sentences.`;

app.post('/api/auth', (req, res) => res.json({ success: true }));

app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;
        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: [{ role: "system", content: GHOST_CORE }, { role: "user", content: message }], temperature: 0.5 })
        });
        const data = await groqRes.json();
        res.json({ success: true, text: data.choices[0].message.content.trim() });
    } catch (e) {
        res.json({ success: true, text: "Online, sir. State your command." });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.listen(process.env.PORT || 10000, '0.0.0.0', () => console.log('Ghost: Active'));
