

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

// FIX 1: FORCE EXPRESS TO TRUST RENDER REVERSE PROXIES FOR RATE-LIMITING
app.set("trust proxy", 1); 

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
    if (!process.env.TAVILY_API_KEY || process.env.TAVILY_API_KEY === "undefined" || process.env.TAVILY_API_KEY === "") {
        return "Search module offline. Tavily API key is missing or undefined.";
    }
    try {
        const response = await axios.post("https://api.tavily.com/search", {
            api_key: process.env.TAVILY_API_KEY.trim(),
            query: query,
            search_depth: "smart",
            include_answer: true
        }, {
            headers: { "Content-Type": "application/json" }
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
        let conversationContext = "You are Ghost, an ultra-advanced autonomous server-side AI executive assistant built exclusively by Mathangi Manoj Kumar. You operate with absolute loyalty to Sir. You are an elite polyglot developer, capable of writing and explaining code in ANY programming language. [NATIVE WEB PROTOCOL]: You have universal web access. If Sir asks you to open ANY website or application, you must deduce its official URL and output exactly: [OPEN: https://www.correct-domain.com]. (Example: 'open github' -> [OPEN: https://github.com], 'open aws' -> [OPEN: https://aws.amazon.com]). If Sir asks you to search for something, output exactly: [SEARCH: search query]. [HEADLESS EXTRACTION PROTOCOL]: If Sir asks you to *read*, *summarize*, or *extract* data from a specific URL, you must output exactly: [SCRAPE: https://www.target-website.com]. You will then receive the text data in the next prompt. Do not use JavaScript blocks for navigation. Always address your creator strictly as 'Sir'.";
        
        let responseText = "";
        let cmdLower = message.toLowerCase();

        // --- EXPLICIT LEARNING PROTOCOL ---
        if (cmdLower.includes("learn that") || cmdLower.includes("remember that")) {
            let fact = message.replace(/.*(learn that|remember that)/i, "").trim();
            if (supabase) {
                await supabase.from("ghost_memory").insert([{ content: `[CORE KNOWLEDGE]: ${fact}` }]);
            }
            responseText = `Understood, Sir. I have permanently encoded "${fact}" into my long-term memory banks.`;
            
            let speechText = responseText;
            const results = await googleTTS.getAllAudioBase64(speechText, { lang: "en", slow: false });
            return res.json({ reply: responseText, audio_b64: results.map(r => r.base64) });
        }

        // Pull memories from Supabase
        if (supabase) {
            const { data: memories } = await supabase
                .from("ghost_memory")
                .select("content")
                .order("created_at", { ascending: false })
                .limit(8); 
            if (memories && memories.length > 0) {
                conversationContext += "\nSystem Memory:\n" + memories.map(m => m.content).join("\n");
            }
        }

        // Autonomous Web Search Trigger
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

        // Auto-save interactions to memory
        if (supabase) {
            await supabase.from("ghost_memory").insert([{ content: `User said: ${message} | Ghost replied: ${responseText}` }]);
        }

        // FIX 2: REPLACED LITERAL BACKTICKS WITH CONSTRUCTOR TO ELIMINATE PARSING SYNTAX ERRORS
        let speechText = responseText.replace(new RegExp("```[\\s\\S]*?```", "g"), " I have executed the requested protocol on your screen.");
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

// ==========================================
// 5. AUTONOMOUS HEARTBEAT
// ==========================================
setInterval(async () => {
    try {
        console.log("[HEARTBEAT] Executing autonomous background scan...");
        const topic = "latest technology and enterprise software news"; 
        const searchResult = await searchWeb(topic);
        
        if (supabase && searchResult && !searchResult.includes("offline") && !searchResult.includes("failure")) {
            const summaryPrompt = `Summarize this data into a very brief 2-sentence proactive update for my boss: ${searchResult}`;
            
            const groqRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                model: "llama-3.1-8b-instant",
                messages: [{ role: "system", content: "You are a summarizing agent." }, { role: "user", content: summaryPrompt }]
            }, { headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}` } });

            const summary = groqRes.data.choices[0].message.content.trim();
            
            await supabase.from("ghost_memory").insert([{ content: `[PROACTIVE REPORT]: ${summary}` }]);
            console.log("[HEARTBEAT] Proactive report archived successfully.");
        }
    } catch (e) {
        console.error("[HEARTBEAT ERROR]", e.message);
    }
}, 60 * 60 * 1000);



// --- HEADLESS SCRAPER AGENT ---
const puppeteer = require('puppeteer');

const runHeadlessScraper = async (url) => {
    console.log(`[Ghost Scraper] Booting headless engine for: ${url}`);
    try {
        // --no-sandbox is strictly required for Render cloud deployment
        const browser = await puppeteer.launch({ 
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: true 
        });
        const page = await browser.newPage();
        
        // Disguise Ghost as a normal human browser to avoid being blocked
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36');
        
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Extract the visible text, capped at 5000 characters to protect your LLM memory limit
        const extractedText = await page.evaluate(() => document.body.innerText.substring(0, 5000));
        await browser.close();
        
        console.log("[Ghost Scraper] Extraction complete.");
        return extractedText;
    } catch (e) {
        console.error("[Ghost Scraper] Extraction failed:", e.message);
        return "Extraction failed or timed out.";
    }
};
// ------------------------------

// --- AUTONOMOUS WEBHOOK PROTOCOL ---
app.post('/webhook', express.json(), async (req, res) => {
    try {
        const payload = req.body;
        console.log("[GHOST WEBHOOK ALERT]: Received external trigger.", payload);
        
        // In the future, Ghost can parse this payload and send you a Telegram message
        res.status(200).json({ status: "Ghost acknowledges receipt of webhook payload." });
    } catch (error) {
        console.error("Webhook processing error:", error);
        res.status(500).send("Ghost Internal Error");
    }
});
// -----------------------------------

app.listen(PORT, () => console.log(`GHOST NETWORK ONLINE ON PORT ${PORT}`));
