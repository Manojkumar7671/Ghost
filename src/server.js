const express = require("express");
const cors = require("cors");
const Groq = require("groq-sdk");
const OrchestratorAgent = require("./agents/orchestrator");

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const orchestrator = new OrchestratorAgent();

app.get("/", (req, res) => {
  res.json({ status: "Ghost is alive", version: "2.0" });
});

app.post("/chat", async (req, res) => {
  const { message, history = [] } = req.body;
  if (!message) return res.status(400).json({ error: "No message" });
  try {
    const messages = [
      { role: "system", content: "You are Ghost, a powerful AI assistant. Be direct, fast, and effective." },
      ...history,
      { role: "user", content: message },
    ];
    const r = await groq.chat.completions.create({ model: "llama-3.3-70b-versatile", messages });
    res.json({ reply: r.choices[0].message.content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/agent", async (req, res) => {
  const { task } = req.body;
  if (!task) return res.status(400).json({ error: "No task" });
  try {
    const result = await orchestrator.run(task);
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Ghost v2 running on port " + PORT));
