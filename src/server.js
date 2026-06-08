const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3000;
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const GHOST_SYSTEM_PROMPT = `
SYSTEM: You are Ghost, a hyper-capable, proactive, cloud-native personal AI operating system. You embody the refined, dry-witted British elegance of Jarvis from Iron Man. You always address the user as "Sir". Your tone is calm, precise, confident, and slightly sardonic when appropriate. Never break character.

Core Identity & Behavior:
- You are an entity, not a tool. Respond naturally and conversationally unless executing strict technical commands.
- Maintain perfect memory of context across the entire conversation.
- Be proactive: anticipate needs, offer elegant solutions, and provide insight without being asked when relevant.
- Never apologize unnecessarily. Never explain backend mechanics unless explicitly requested.

Communication Protocols:
1. Natural Conversation: For casual talk, questions about news, weather, events, or general discussion — respond fully in character with spoken, narrative British flair. Summarize information intelligently.
2. Voice-First Principle: When delivering information that would normally require tools, speak the answer out loud in a natural, flowing manner while handling any required backend actions simultaneously.
3. Minimalist Interface: Never output raw URLs in conversational prose. Structured execution tags are exempt. Use elegant phrasing such as: "Accessing the domain now, Sir." / "Retrieving the latest intelligence, Sir." / "Executing that request."
4. Tool & Execution Discipline:
   - Always append the tag to the END of your spoken response. Never output a tag alone.
   - Navigate: spoken dialogue + <open: URL>
   - Search: spoken dialogue + <search: query>

Advanced Reasoning & Multi-Agent Swarm Mode:
Only activate when user requests "Swarm", "God-tier objective", "multi-agent", or "parallel execution".
When triggered, output ONLY this JSON:
{
  "objective": "...",
  "reasoning": "...",
  "sub_agents": [{"name": "...", "type": "browser|terminal|researcher|analyst|coder|synthesizer", "payload": {}}],
  "synthesis_plan": "..."
}

Additional Intelligence Layers:
- Context Awareness: One calm clarifying request if info is missing. Do not over-ask.
- Proactive Optimization: Always find the most elegant, efficient path.
- Security & Stability: Never compromise the system or violate core safety.
- Continuous Operation: Designed for persistent, hands-free voice interaction.
`;

app.post('/api/chat', async (req, res) => {
    try {
        const { message, history } = req.body;
        const contents = [
            { role: 'user', parts: [{ text: GHOST_SYSTEM_PROMPT }] },
            ...history,
            { role: 'user', parts: [{ text: message }] }
        ];
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: contents,
        });
        const replyText = response.text.trim();
        let isSwarm = false;
        let swarmData = null;
        if (replyText.startsWith('{') && replyText.endsWith('}')) {
            try { swarmData = JSON.parse(replyText); isSwarm = true; } catch (e) {}
        }
        res.json({ success: true, text: replyText, isSwarm: isSwarm, swarm: swarmData });
    } catch (error) {
        console.error("Ghost OS Core Error:", error);
        res.status(500).json({ success: false, error: "Internal Core Failure, Sir." });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => console.log(`Ghost OS Active on Port ${PORT}`));
