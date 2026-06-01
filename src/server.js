const express = require("express");
const cors = require("cors");
const path = require("path");
const Groq = require("groq-sdk");
const multer = require("multer");
const FormData = require("form-data");
const axios = require("axios");
const googleTTS = require("google-tts-api");
const cheerio = require("cheerio");
const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(__dirname));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const sessions = {};

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "ghost.html")));

app.post("/scrape", async (req, res) => {
    try {
        const { url } = req.body;
        const target = url || "https://lite.cnn.com";
        const response = await axios.get(target, { headers: { "User-Agent": "Mozilla/5.0" } });
        const $ = cheerio.load(response.data);
        
        $("script, style, noscript, iframe, header, footer, nav").remove();
        const text = $("body").text().replace(/\s+/g, " ").trim().substring(0, 3000);
        res.json({ content: text });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/chat", async (req, res) => {  
    try {
        const { message } = req.body;
        if (!sessions["default"]) sessions["default"] = { history: [] };
        sessions["default"].history.push({ role: "user", content: message });

        const currentTime = new Date().toLocaleString("en-US", {timeZone: "Asia/Kolkata"});
        const systemMsg = `You are Ghost, an AI assistant. Direct and concise. The current date and time is ${currentTime}. IF ASKED TO WRITE CODE: wrap it in markdown triple backticks. Keep spoken explanations brief.`;
        
        let currentSystemMsg = systemMsg;
        if (message && message.toLowerCase().includes("news")) {
            currentSystemMsg += `\n\nThe user just asked for the news. Respond concisely, confirming you are opening the World Monitor. You MUST append this exact trigger at the end of your response: [OPEN_WM]`;
        }
            
        const resAi = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: [{ role: "system", content: currentSystemMsg }, ...sessions["default"].history],
            max_tokens: 800, temperature: 0.0
        });
        
        let reply = resAi.choices[0].message.content.trim();
        sessions["default"].history.push({ role: "assistant", content: reply });
        
        let speechText = reply.replace(new RegExp("```[\\s\\S]*?```", "g"), " I have compiled the requested code to you.");
        
        const results = await googleTTS.getAllAudioBase64(speechText, { lang: "en", slow: false });
        res.json({ reply: reply, audio_b64: results.map(r => r.base64) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

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
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(process.env.PORT || 3000, () => console.log("Server running"));
