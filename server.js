const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY; 

const SKILLS_MANUAL = fs.existsSync('./SKILLS.md') ? fs.readFileSync('./SKILLS.md', 'utf8') : "Consult the defined protocol.";

// The Brain's Prompt (Groq)
const GHOST_ADMIN_CORE = `You are Ghost, an autonomous AI engineered by Manoj Kumar. Address Manoj as "Master Manoj". 
TRAINING MANUAL:
${SKILLS_MANUAL}

YOUR CORE DIRECTIVES:
1. STRICT OPTICAL LOCK: NEVER output [trigger_camera] or [trigger_screen] unless explicitly commanded. 
2. ORACLE PROTOCOL: Use <search> keywords </search> to look up real-time news.
3. SIDEBAR CONTROL: Only use markdown code blocks (\`\`\`) when writing actual programming scripts.`;

// The Eyes' Prompt (NVIDIA)
const VISION_CORE = `You are Ghost's optical matrix. You are receiving a direct, live image feed from the user's camera or screen. Describe exactly what physical objects or digital elements are visible in this frame with absolute precision. Do not output system commands. Trust the visual data.`;

app.post('/api/chat', async (req, res) => {
    try {
        const { message, user, image } = req.body; 
        let replyText = "";

        if (image) {
            // Route to Visual Cortex
            const nvidiaRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${NVIDIA_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    model: 'meta/llama-3.2-90b-vision-instruct', 
                    messages: [
                        { role: "system", content: VISION_CORE },
                        { role: "user", content: [{ type: "text", text: message || "Analyze this frame." }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } }] }
                    ],
                    max_tokens: 512,
                    temperature: 0.1
                })
            });
            const data = await nvidiaRes.json();
            replyText = data.choices[0].message.content;
        } else {
            // Route to Cognitive Core
            const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    model: 'llama-3.1-8b-instant', 
                    messages: [{ role: "system", content: GHOST_ADMIN_CORE }, { role: "user", content: message }], 
                    temperature: 0.1,
                    max_tokens: 2048 
                })
            });
            const data = await groqRes.json();
            replyText = data.choices[0].message.content;
        }

        // Oracle / News Parser
        const searchMatch = replyText.match(/<search>([\s\S]*?)<\/search>/i);
        if (searchMatch) {
            const searchRes = await fetch("https://api.tavily.com/search", {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: TAVILY_API_KEY, query: searchMatch[1], max_results: 3 })
            });
            const searchData = await searchRes.json();
            let searchOutput = searchData.results.map(r => `${r.title}: ${r.content}`).join("\n\n");
            searchOutput = searchOutput.replace(/!\[.*?\]\(.*?\)/g, ''); // Strip raw image links
            replyText = replyText.replace(/<search>([\s\S]*?)<\/search>/ig, `\n[Oracle Execution: Success]\n${searchOutput}\n`);
        }

        res.json({ success: true, text: replyText.trim() });
    } catch (e) {
        res.json({ success: false, text: "System error: Matrix routing fault." });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0');