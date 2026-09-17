const { chat } = require('../tools/llm.js');

async function resolveContextualReference(currentMessage, history = []) {
    
    if (!history || history.length === 0 || currentMessage.length > 500) {
        return currentMessage;
    }

    const vagueWords = ['it', 'that', 'this', 'he', 'she', 'they', 'them', 'those', 'these', 'the bug', 'the error', 'the issue'];
    const lowerMsg = currentMessage.toLowerCase();
    const hasVague = vagueWords.some(w => new RegExp(`\\b${w}\\b`).test(lowerMsg));
    
    if (!hasVague) {
        return currentMessage;
    }

    const historyText = history.slice(-6).map(h => `${h.role}: ${h.content}`).join('\n');

    const prompt = `You are an AI context resolver.
Your task is to rewrite the user's CURRENT message by replacing ambiguous pronouns or vague references (like "it", "that", "this", "the bug", "he") with their explicit referents from the CONVERSATION HISTORY.

CONVERSATION HISTORY:
${historyText}

CURRENT MESSAGE: "${currentMessage}"

Rules:
1. If the CURRENT MESSAGE contains vague references, replace them with the specific noun/topic from the history.
2. Example: History talks about "React Hooks". Current message: "tell me more about that". Rewritten: "tell me more about React Hooks".
3. If the message is already clear, or if the history doesn't clarify it, return the CURRENT MESSAGE exactly as is.
4. Output ONLY the rewritten message, with no quotes, preamble, or explanations.`;

    try {
        const response = await chat([{ role: 'user', content: prompt }], { maxTokens: 500, temperature: 0 });
        const resolved = response.trim().replace(/^"|"$/g, '');
        
        if (resolved && resolved.length > 0 && resolved.toLowerCase() !== currentMessage.toLowerCase()) {
            console.log(`[ContextResolver] Resolved "${currentMessage}" -> "${resolved}"`);
            return resolved;
        }
    } catch (e) {
        
        console.error('[ContextResolver] Error:', e.message);
    }
    
    return currentMessage;
}

module.exports = { resolveContextualReference };
