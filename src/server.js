const express = require("express");
const cors = require("cors");
const path = require("path");
const dotenv = require("dotenv");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");
const multer = require("multer");
const FormData = require("form-data");
const axios = require("axios");
const googleTTS = require("google-tts-api");

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 1. THE FIREWALL 
// ==========================================
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 100, 
    message: { error: "TOO MANY REQUESTS. FIREWALL LOCKDOWN ACTIVE." }
});
app.use("/chat", limiter);
app.use("/transcribe", limiter);

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(__dirname)); 

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "ghost.html")));

// ==========================================
// 2. SUPABASE & TOOLS
// ==========================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
let supabase = null;
if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
}

async function searchWeb(query) {
    if (!process.env.TAVILY_API_KEY) return "Search module offline.";
    try {
        const response = await axios.post("https://api.tavily.com/search", {
            api_key: process.env.TAVILY_API_KEY,
            query: query,
            search_depth: "smart",
            include_answer: true
        });
        return response.data.answer || JSON.stringify(response.data.results);
    } catch (err) {
        return "Web search failure: " + err.message;
    }
}

// ==========================================
// 3. CORE CHAT AGENT LOGIC
// ==========================================
app.post("/chat", async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Missing transcript data." });

    try {
        // THE LOYAL PERSONA
        let conversationContext = "You are Ghost, a highly advanced, fiercely loyal, and strictly professional AI assistant. You exist to serve the user. You must always address the user as \"Sir\". You are polite, obedient, and highly capable. Speak concisely and respectfully.";
        
        let responseText = "";
        let cmdLower = message.toLowerCase();

        // --- EXPLICIT LEARNING PROTOCOL ---
        if (cmdLower.includes("learn that") || cmdLower.includes("remember that")) {
            let fact = message.replace(/.*(learn that|remember that)/i, "").trim();
            if (supabase) {
                // Save it with a special high-priority tag
                await supabase.from("ghost_memory").insert([{ content: `[CORE KNOWLEDGE]: ${fact}` }]);
            }
            responseText = `Understood, Sir. I have permanently encoded "${fact}" into my long-term memory banks.`;
            
            // Bypass the LLM to guarantee the exact response immediately
            let speechText = responseText;
            const results = await googleTTS.getAllAudioBase64(speechText, { lang: "en", slow: false });
            return res.json({ reply: responseText, audio_b64: results.map(r => r.base64) });
        }

        // Normal memory pull
        if (supabase) {
            const { data: memories } = await supabase
                .from("ghost_memory")
                .select("content")
                .order("created_at", { ascending: false })
                .limit(8); // Increased memory pull slightly
            if (memories && memories.length > 0) {
                conversationContext += "\nSystem Memory:\n" + memories.map(m => m.content).join("\n");
            }
        }

        // Web Search
        const triggerKeywords = ["search", "find out", "news", "current", "weather", "who is", "what is"];
        if (triggerKeywords.some(keyword => cmdLower.includes(keyword))) {
            const searchResult = await searchWeb(message);
            conversationContext += `\n[AUTONOMOUS WEB SEARCH RESULT]: ${searchResult}`;
        }

        // Hit Groq LLM
        const groqRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.1-8b-instant",
            messages: [
                { role: "system", content: conversationContext },
                { role: "user", content: message }
            ]
        }, {
            headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}` }
        });

        responseText = groqRes.data.choices[0].message.content.trim();

        // Auto-save normal interactions to memory
        if (supabase) {
            await supabase.from("ghost_memory").insert([{ content: `User said: ${message} | Ghost replied: ${responseText}` }]);
        }

        // Google TTS Generation
        let speechText = responseText.replace(/```[\s\S]*?
```/g, " I have compiled the requested code to your terminal.");
        const results = await googleTTS.getAllAudioBase64(speechText, { lang: "en", slow: false });
        
        res.json({ reply: responseText, audio_b64: results.map(r => r.base64) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Agent system degradation detected." });
    }
});

// ==========================================
// 4. WHISPER AUDIO TRANSCRIPTION 
// ==========================================
const upload = multer({ storage: multer.memoryStorage() });
app.post("/transcribe", upload.single("audio"), async (req, res) => {
    try {
        const form = new FormData();
        form.append("file", req.file.buffer, { filename: "audio.webm", contentType: "audio/webm" });
        form.append("model", "whisper-large-v3-turbo");
        
        const resp = await axios.post("https://api.groq.com/openai/v1/audio/transcriptions", form, { 
            headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.GROQ_API_KEY}` } 
        });
        res.json({ text: resp.data.text });
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
});

app.listen(PORT, () => console.log(`GHOST NETWORK ONLINE ON PORT ${PORT}`));
