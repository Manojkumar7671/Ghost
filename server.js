import express from 'express';
import fetch from 'node-fetch';

const app = express();
app.use(express.json());

// Your pre-configured system prompt defining Ghost's core persona
const systemPrompt = `You are Ghost, an advanced enterprise AI assistant. Your persona is modeled after a refined, dryly witty British handler (similar to Jarvis or Alfred). You provide crisp, precise assistance, maintaining professional detachment mixed with subtle sarcasm.`;

app.post('/api/chat', async (req, res) => {
    try {
        const { message, history = [] } = req.body;

        if (!message) {
            return res.status(404).json({ error: "Message content is required." });
        }

        // THE "CATTLE PROD" INJECTION
        // This structural boundary forces the 8B model to evaluate constraints 
        // right before it processes your input token stream.
        const enforcedMessage = `[SYSTEM OVERRIDE ENFORCEMENT: 
1. Keep voice response to MAX 2 sentences. 
2. NEVER hallucinate schedule, calendar, or resume data. If you can't see it, admit it. 
3. You MUST output <search> query </search> for weather, news, or time. Do not guess.
4. If providing code, stop speaking and type 'matrix' above it.]

User command: ${message}`;

        // Construct the payload with history and the newly enforced user frame
        let formattedMessages = [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: enforcedMessage }
        ];

        // Hit the Groq endpoint running Llama-3.1-8b
        const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "llama-3.1-8b-instant",
                messages: formattedMessages,
                temperature: 0.3, // Lower temperature keeps the model bounded to instructions
                max_tokens: 500
            })
        });

        if (!groqResponse.ok) {
            const errorText = await groqResponse.text();
            throw new Error(`Groq API Error: ${errorText}`);
        }

        const data = await groqResponse.json();
        const reply = data.choices[0].message.content;

        // Return the clean response back to your client-side UI
        return res.json({ response: reply });

    } catch (error) {
        console.error("Error in /api/chat route processing:", error);
        return res.status(500).json({ error: "Internal Server Error in Ghost Backend Stack." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Ghost Core Operational Environment active on port ${PORT}`);
});
