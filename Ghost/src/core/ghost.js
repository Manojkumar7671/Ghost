require('dotenv').config();
const axios = require('axios');
const { GHOST_SYSTEM_PROMPT } = require('../config/personality');

const PROVIDERS = {
  groq: {
    baseURL: 'https://api.groq.com/openai/v1',
    apiKey: process.env.GROQ_API_KEY,
    model: 'llama-3.3-70b-versatile',
  },
  nvidia: {
    baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKey: process.env.NVIDIA_API_KEY,
    model: 'meta/llama-3.1-70b-instruct',
  },
  together: {
    baseURL: 'https://api.together.xyz/v1',
    apiKey: process.env.TOGETHER_API_KEY,
    model: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
  },
};

let ghostMemory = {
  conversations: [],
  agents: {},
  operatorProfile: {},
  missionLog: [],
};

class Ghost {
  constructor() {
    this.name = 'GHOST';
    this.status = 'ONLINE';
    this.activeProvider = 'groq';
    this.conversationHistory = [];
    this.agents = {};
  }

  async queryLLM(messages, provider = null) {
    const providers = ['groq', 'nvidia', 'together'];
    const chosen = provider || this.activeProvider;

    for (const p of [chosen, ...providers.filter(x => x !== chosen)]) {
      try {
        const result = await this._callProvider(p, messages);
        this.activeProvider = p;
        return result;
      } catch (err) {
        console.log(`[GHOST] Provider ${p} failed: ${err.message}. Switching...`);
        continue;
      }
    }
    return await this._callGemini(messages);
  }

  async _callProvider(provider, messages) {
    const config = PROVIDERS[provider];
    if (!config.apiKey) throw new Error('No API key');

    const response = await axios.post(
      `${config.baseURL}/chat/completions`,
      { model: config.model, messages, temperature: 0.7, max_tokens: 2048 },
      { headers: { 'Authorization': `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' } }
    );
    return response.data.choices[0].message.content;
  }

  async _callGemini(messages) {
    const apiKey = PROVIDERS.gemini.apiKey;
    if (!apiKey) throw new Error('No Gemini key');

    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

    const systemInstruction = messages
      .filter(m => m.role === 'system')
      .map(m => m.content)
      .join('\n');

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      { contents, systemInstruction: { parts: [{ text: systemInstruction }] } }
    );
    return response.data.candidates[0].content.parts[0].text;
  }

  async chat(userMessage, channel = 'terminal') {
    const messages = [
      { role: 'system', content: GHOST_SYSTEM_PROMPT },
      { role: 'system', content: `Channel: ${channel}. Time: ${new Date().toISOString()}` },
      ...this.conversationHistory.slice(-20),
      { role: 'user', content: userMessage },
    ];

    const response = await this.queryLLM(messages);

    this.conversationHistory.push(
      { role: 'user', content: userMessage },
      { role: 'assistant', content: response }
    );

    ghostMemory.missionLog.push({
      timestamp: new Date().toISOString(),
      channel,
      input: userMessage,
      output: response,
    });

    return response;
  }

  async spawnAgent(name, specialty, mission) {
    const agentId = `AGENT-${name.toUpperCase()}-${Date.now()}`;
    const agent = {
      id: agentId, name, specialty, mission,
      prompt: `You are ${name}, a sub-agent of GHOST. Specialty: ${specialty}. Mission: ${mission}. Be precise. Complete the mission.`,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      conversationHistory: [],
    };
    this.agents[agentId] = agent;
    ghostMemory.agents[agentId] = agent;
    return { id: agentId, name, specialty, status: 'SPAWNED', message: `👁️ Agent ${name} deployed.` };
  }

  async chatWithAgent(agentId, message) {
    const agent = this.agents[agentId];
    if (!agent) return 'Agent not found.';
    const messages = [
      { role: 'system', content: agent.prompt },
      ...agent.conversationHistory.slice(-10),
      { role: 'user', content: message },
    ];
    const response = await this.queryLLM(messages);
    agent.conversationHistory.push(
      { role: 'user', content: message },
      { role: 'assistant', content: response }
    );
    return response;
  }

  listAgents() {
    return Object.values(this.agents).map(a => ({ id: a.id, name: a.name, specialty: a.specialty, status: a.status }));
  }

  getMemory() { return ghostMemory; }

  updateOperatorProfile(data) {
    ghostMemory.operatorProfile = { ...ghostMemory.operatorProfile, ...data };
  }
}

module.exports = new Ghost();
