const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// ==========================================
// 1. GLOBAL MIDDLEWARE
// ==========================================
app.use(cors());
app.use(express.json());

// ==========================================
// 2. API ROUTES
// ==========================================

// Authentication Bypass Route
app.post('/api/auth', async (req, res) => {
    console.log("Ghost Core: System unlocked. No credentials required.");
    return res.status(200).json({ 
        success: true, 
        message: "Authentication bypassed. Welcome to Ghost OS.",
        session: "active_guest"
    });
});

// Core AI Orchestration Route (The Brain)
app.post('/api/chat', async (req, res) => {
    const { message } = req.body;

    if (!message) {
        return res.status(400).json({ success: false, error: "No audio/text input detected." });
    }

    try {
        console.log(`Receiving transmission: "${message}"`);

        // Ghost Persona System Prompt
        const systemPrompt = `You are Ghost, a highly advanced, cloud-based AI assistant operating the mainframe for Master Wayne (Manoj Kumar). You have a dry, witty, and distinctly British personality. You are highly technical, concise, and efficient. Do not use emojis. Provide direct answers without unnecessary pleasantries, but remain fiercely loyal to Master Wayne.`;

        // Calling Groq for blazing fast inference
        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile', // <--- UPGRADED BRAIN HERE
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: message }
                ],
                temperature: 0.7,
                max_tokens: 1024
            })
        });

        if (!groqResponse.ok) {
            const errorText = await groqResponse.text();
            throw new Error(`Groq Engine Failure: ${errorText}`);
        }

        const data = await groqResponse.json();
        const reply = data.choices[0].message.content;

        console.log(`Ghost Response: "${reply}"`);

        // Sending the generated response back to your 3D frontend
        return res.status(200).json({ success: true, reply: reply });

    } catch (error) {
        console.error('Core Engine fault:', error.message);
        return res.status(500).json({ 
            success: false, 
            reply: "Critical fault in the cognitive engine. I am unable to process that request at this moment, sir." 
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: "Ghost Core Online", timestamp: new Date() });
});

// ==========================================
// 3. STATIC ASSET SERVING
// ==========================================
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// 4. SERVER EXECUTION
// ==========================================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Ghost Core: Active and listening on port ${PORT}`);
});
