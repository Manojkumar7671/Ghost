const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// --- 1. TAVILY DEEP RESEARCH AGENT ---
async function performDeepResearch(query) {
    if (!TAVILY_API_KEY) return null;
    console.log("[SYSTEM] Initiating Deep Research for:", query);
    try {
        const res = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                api_key: TAVILY_API_KEY, 
                query: query, 
                search_depth: "advanced", 
                max_results: 3 
            })
        });
        const data = await res.json();
        if (!data.results) return null;
        
        let researchData = "--- LIVE INTERNET RESEARCH DATA ---\n";
        data.results.forEach((r, i) => { researchData += `Source ${i+1}: ${r.content}\n\n`; });
        return researchData;
    } catch (e) {
        console.error("Tavily Search Failed:", e);
        return null;
    }
}

app.post('/api/chat', async (req, res) => {
    try {
        const userMessage = req.body.message;
        const history = req.body.history || [];
        
        // --- 2. RESEARCH TRIGGER ---
        let injectedContext = "";
        const researchTriggers = ['search', 'look up', 'learn', 'research', 'latest', 'news', 'weather', 'who is', 'current'];
        if (researchTriggers.some(t => userMessage.toLowerCase().includes(t))) {
            const researchResults = await performDeepResearch(userMessage);
            if (researchResults) {
                injectedContext = `\n\nCRITICAL INSTRUCTION: Use the following LIVE WEB DATA to answer the user's prompt accurately:\n${researchResults}`;
            }
        }

        // --- 3. NEURAL INJECTION (Time, Location, Skills) ---
        const currentTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        const systemPrompt = `You are Ghost, an elite AI personal assistant created for Manoj. You possess a dry, highly efficient, British persona similar to J.A.R.V.I.S.
Current System Time: ${currentTime}. 
Current Location: Mangalagiri, Andhra Pradesh, India.
SKILLS:
1. If the user asks you to open a website (e.g., YouTube, Google, etc.), output exactly: <open: https://www.website.com> in your response.
2. You are an expert coder. Write code clearly.
Keep spoken responses concise and brilliant. Do not use markdown like asterisks for actions, as your words are spoken aloud.${injectedContext}`;

        const messages = [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: userMessage }
        ];

        // --- 4. GROQ INFERENCE (Llama 3) ---
        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama3-70b-8192',
                messages: messages,
                max_tokens: 300,
                temperature: 0.5
            })
        });

        const groqData = await groqResponse.json();
        const ghostText = groqData.choices[0].message.content;

        // --- 5. ELEVENLABS VOICE GENERATION (With Timeout Protection) ---
        let audioBase64 = [];
        if (ELEVENLABS_API_KEY) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 4000); // 4 Second timeout so it never hangs
                
                // Using 'Adam' voice ID, with the fast Turbo v2.5 model
                const ttsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/pNInz6obpgDQGcFmaJcg`, {
                    method: 'POST',
                    headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: ghostText.replace(/<open:[^>]+>/g, ''), // Strip tags before speaking
                        model_id: "eleven_turbo_v2_5",
                        voice_settings: { stability: 0.5, similarity_boost: 0.7 }
                    }),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (ttsResponse.ok) {
                    const audioBuffer = await ttsResponse.arrayBuffer();
                    audioBase64.push(Buffer.from(audioBuffer).toString('base64'));
                } else {
                    console.error("ElevenLabs Error:", await ttsResponse.text());
                }
            } catch (err) { 
                console.error("ElevenLabs Timeout or Error. Falling back to native voice."); 
            }
        }

        res.json({ success: true, text: ghostText, audio_b64: audioBase64 });

    } catch (error) {
        console.error("Core Processing Error:", error);
        res.status(500).json({ success: false, text: "System overload. Neural net unreachable." });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('Ghost Neural Net Active on Port ' + PORT));
