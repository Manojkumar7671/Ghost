const { chat } = require('../tools/llm');

/**
 * Self-Created Ghost Agent: automaticallyagent
 * Description: Agent that automatically reads and forwards my emails every hour
 */
async function run(task) {
    const systemPrompt = `You are automaticallyagent, a specialized AI agent in the Ghost ecosystem.
Description: Agent that automatically reads and forwards my emails every hour
Specialized Instructions: Generate and execute responses for tasks involving: automatically reads and forwards my emails every hour
Always respond clearly and concisely in Ghost's tone.`;

    try {
        const response = await chat([
            { role: 'user', content: `${systemPrompt}\n\nTask: ${task}` }
        ], { temperature: 0.7 });
        return response;
    } catch (err) {
        return `[automaticallyagent Error]: ${err.message}`;
    }
}

module.exports = { run };
