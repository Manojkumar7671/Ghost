const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");
const { google } = require("googleapis");

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 1. THE FIREWALL LAYER (SECURITY HARDENING)
// ==========================================
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    message: { error: "TOO MANY REQUESTS. FIREWALL LOCKDOWN ACTIVE." }
});
app.use("/chat", limiter);
app.use("/transcribe", limiter);

const allowedOrigins = [
    "http://localhost:3000",
    process.env.RENDER_EXTERNAL_URL // Automatically targets your deployed live site
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error("BLOCKED BY GHOST.SYS FIREWALL (CORS)"));
        }
    }
}));

app.use(express.json());
app.use(express.static("src"));

// ==========================================
// 2. EXTERNAL COGNITIVE INTEGRATIONS
// ==========================================
// Supabase Long-term Memory
const supabaseUrl = process.env.SUPABASE_URL || "https://nztjqoinkepycntrfavo.supabase.co";
const supabaseKey = process.env.SUPABASE_ANON_KEY;
let supabase = null;
if (supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
}

// Gmail API Setup (OAuth2)
const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI || "http://localhost:3000/oauth2callback"
);

// Autonomous Web Search Tool via Tavily
async function searchWeb(query) {
    try {
        const response = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                api_key: process.env.TAVILY_API_KEY,
                query: query,
                search_depth: "smart",
                include_answer: true
            })
        });
        const data = await response.json();
        return data.answer || JSON.stringify(data.results);
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
        let conversationContext = "You are Ghost, an autonomous server-side executive assistant. Speak with sharp, cynical British brevity.";
        
        // Pull memories from Supabase if configured
        if (supabase) {
            const { data: memories } = await supabase
                .from("ghost_memory")
                .select("content")
                .order("created_at", { ascending: false })
                .limit(5);
            if (memories && memories.length > 0) {
                conversationContext += "\nRecent Memory Context:\n" + memories.map(m => m.content).join("\n");
            }
        }

        // Determine if Autonomous Search is required
        let responseText = "";
        const triggerKeywords = ["search", "find out", "news", "current", "weather", "who is", "what is"];
        if (triggerKeywords.some(keyword => message.toLowerCase().includes(keyword))) {
            const searchResult = await searchWeb(message);
            conversationContext += `\n[AUTONOMOUS WEB SEARCH RESULT]: ${searchResult}`;
        }

        // Hit Groq API / LLM
        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "llama3-8b-8192",
                messages: [
                    { role: "system", content: conversationContext },
                    { role: "user", content: message }
                ]
            })
        });

        const groqData = await groqRes.json();
        responseText = groqData.choices[0].message.content;

        // Auto-save interactions to long term memory
        if (supabase) {
            await supabase.from("ghost_memory").insert([{ content: `User said: ${message} | Ghost replied: ${responseText}` }]);
        }

        // Generate TTS Audio via Cartesia
        const cartesiaRes = await fetch("https://api.cartesia.ai/tts/bytes", {
            method: "POST",
            headers: {
                "X-API-Key": process.env.CARTESIA_API_KEY,
                "Cartesia-Version": "2024-06-10",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model_id: "sonic-english",
                voice: { mode: "id", id: "6381dcd5-2fa0-47da-939e-b461da440363" },
                output_format: { container: "raw", encoding: "pcm_f32_le", sample_rate: 44100 },
                transcript: responseText
            })
        });

        if (cartesiaRes.ok) {
            const audioBuffer = await cartesiaRes.arrayBuffer();
            const base64Audio = Buffer.from(audioBuffer).toString("base64");
            return res.json({ reply: responseText, audio_b64: [base64Audio] });
        }

        res.json({ reply: responseText });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Agent system degradation detected." });
    }
});

// Dummy Transcribe placeholder matching your front-end route
app.post("/transcribe", async (req, res) => {
    res.json({ text: "Simulated speech token verification complete." });
});

app.listen(PORT, () => console.log(`GHOST NETWORK ONLINE ON PORT ${PORT}`));
