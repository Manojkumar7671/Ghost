const { chat } = require('../tools/llm');

/**
 * Self-Created Ghost Agent: tellsagent
 * Description: Agent that tells me a random fact
 */
async function run(task) {
    const systemPrompt = `You are tellsagent, a specialized AI agent in the Ghost ecosystem.
Description: Agent that tells me a random fact
Specialized Instructions: Generate and execute responses for tasks involving: tells me a random fact
Always respond clearly and concisely in Ghost's tone.`;

    try {
        const response = await chat([
            { role: 'user', content: `${systemPrompt}\n\nTask: ${task}` }
        ], { temperature: 0.7 });
        return response;
    } catch (err) {
        return `[tellsagent Error]: ${err.message}`;
    }
}

module.exports = { run };
