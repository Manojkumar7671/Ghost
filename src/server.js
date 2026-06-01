const express = require('express');
const cors = require('cors');
const path = require('path');
const Groq = require('groq-sdk');
const multer = require('multer');
const FormData = require('form-data');
const axios = require('axios');
const googleTTS = require('google-tts-api');
const puppeteer = require('puppeteer');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Scraper Tool
app.post('/scrape', async (req, res) => {
    try {
        const { url } = req.body;
        const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const text = await page.evaluate(() => document.body.innerText);
        await browser.close();
        res.json({ content: text.substring(0, 3000) }); // Digest 3000 chars
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Chat Tool Handler
app.post('/chat', async (req, res) => {
    const { message } = req.body;
    // ... [existing chat logic]
    // If the LLM output contains ###SCRAPE_SITE### {"url": "..."} ###SCRAPE_SITE###, 
    // the frontend will trigger the /scrape route.
    res.json({ reply: "Processing..." }); 
});

// ... [keep other routes identical]
app.listen(process.env.PORT || 3000);
