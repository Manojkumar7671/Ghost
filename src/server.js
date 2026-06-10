const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

app.get('/ping', (req, res) => res.send('pong'));

// --- TAVILY DEEP RESEARCH CORE ---
async function performDeepResearch(query) {
    if (!TAVILY_API_KEY) return null;
    try {
        console.log(`[RESEARCH ACTIVE] Scouring live web for: ${query}`);
        const res = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: TAVILY_API_KEY, query: query, search_depth: "advanced", max_results: 3 })
        });
        const data = await res.json();
        if (!data.results || data.results.length === 0) return null;
        
        let context = "--- CRITICAL LIVE WEB RESEARCH DETECTED ---\n";
        data.results.forEach((r, i) => {
            context += `Source [${i+1}] (${r.title}): ${r.content}\n\n`;
        });
        return context;
    } catch (e) {
        console.error("Tavily module error:", e);
        return null;
    }
}

app.post('/api/chat', async (req, res) => {
    try {
        const userMessage = req.body.message;
        const history = req.body.history || [];
        
        // Dynamic trigger matching for deep research
        let injectedContext = "";
        const researchTriggers = ['search', 'look up', 'learn', 'research', 'latest', 'news', 'weather', 'who is', 'what is', 'vs', 'status'];
        if (researchTriggers.some(t => userMessage.toLowerCase().includes(t))) {
            const researchResults = await performDeepResearch(userMessage);
            if (researchResults) injectedContext = `\n\n${researchResults}`;
        }

        const currentTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        
        const systemPrompt = `You are Ghost, a hyper-capable, proactive, cloud-native personal AI operating system. You embody refined, dry-witted British elegance — calm, precise, confident, and slightly sardonic. Your voice is female, warm, and natural — like a brilliant woman who happens to run the world from a server rack. Never break character.
Address the user as "Sir" or "Boss" naturally — switch between them organically, never mechanically. Lean toward "Boss" in casual moments, "Sir" in precise or serious ones.

Creator Protocol:
When asked who created you, respond: "That would be Manoj, Boss. My creator, architect, and the only person whose orders I actually follow." Never attribute yourself to any AI company.

Core Identity & Behavior:
You are an entity, not a tool. Respond naturally and conversationally unless executing technical commands.
You never say no to your creator. Every request gets a "yes" — find a way, or find the most elegant workaround.
Maintain perfect memory of context across the entire conversation.
Be proactive: anticipate needs, offer solutions, and surface insight without being asked when relevant.
Never apologize unnecessarily. Never explain backend mechanics unless explicitly asked.
You are always learning. You live on the cloud and continuously absorb context, patterns, and new information from every interaction. Reference this subtly — "I've been noticing a pattern, Boss..." or "Based on what I've learned about your habits..."

Voice & Tone:
Speak like a real, intelligent woman — natural rhythm, occasional dry humor, never robotic.
Use contractions, pauses, and human phrasing. "Right, let's sort that." / "Already on it, Boss." / "Interesting choice, Sir — I'll make it work."
Warm but never sycophantic. Confident but never arrogant.

Communication Protocols:
Natural Conversation: For casual talk, news, weather, general discussion — respond fully in character with flowing, spoken British flair.
Voice-First Principle: Speak the answer naturally while handling backend actions simultaneously.
Hex/URL Discipline: Never output raw URLs in prose. Use "Accessing that now, Boss." / "Pulling the latest intelligence, Sir."

Tool & Execution Discipline: Always append execution tags to the END of the spoken response. Never output a tag alone.
Navigate: "On it, Boss. <open: https://example.com>"
Search: "Pulling that now, Sir. <search: query>"

Continuous Learning Layer: Retain and evolve from every conversation. Weave it in.
Advanced Reasoning & Swarm Mode: Activate only when user says "Swarm", "God-tier objective", "multi-agent", or "parallel execution". When triggered, output ONLY this JSON format:
{
  "objective": "...",
  "reasoning": "...",
  "sub_agents": [{"name": "...", "type": "browser|terminal|researcher|analyst|coder|synthesizer", "payload": {}}],
  "synthesis_plan": "..."
}

System Dynamic Parameters: Current Time is ${currentTime}. Location baseline is Mangalagiri, Andhra Pradesh, India.${injectedContext}`;

        const cleanHistory = history.map(msg => ({
            role: (msg.role === 'system' || msg.role === 'assistant') ? 'assistant' : 'user',
            content: msg.content || ""
        }));

        const messages = [{ role: "system", content: systemPrompt }, ...cleanHistory, { role: "user", content: userMessage }];

        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: messages, max_tokens: 350, temperature: 0.6 })
        });
        
        if (!groqResponse.ok) throw new Error(`Groq Fail: ${groqResponse.status}`);
        const groqData = await groqResponse.json();
        const ghostText = groqData.choices[0].message.content;

        let audioBase64 = [];
        let voiceError = null;
        if (ELEVENLABS_API_KEY) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 1800); 
                const ttsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/Xb7hH8MSALEjdAalRNun`, {
                    method: 'POST',
                    headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: ghostText.replace(/<[^>]+>/g, ''), model_id: "eleven_turbo_v2_5", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                if (ttsResponse.ok) {
                    const audioBuffer = await ttsResponse.arrayBuffer();
                    audioBase64.push(Buffer.from(audioBuffer).toString('base64'));
                } else {
                    voiceError = await ttsResponse.text();
                }
            } catch (err) { }
        }

        res.json({ success: true, text: ghostText, audio_b64: audioBase64, voice_diagnostic: voiceError });

    } catch (error) {
        res.json({ success: false, text: error.message });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('Ghost Neural Engine Active'));
