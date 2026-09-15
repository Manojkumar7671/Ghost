const pool = require('../db/pool.js');
const crypto = require('crypto');
const { chat } = require('../tools/llm.js');

/**
 * Log a source when research is performed.
 */
async function logSource({ taskId, url, title, content, extractionMethod = 'web_search' }) {
    if (!pool) return null;
    try {
        const hash = crypto.createHash('sha256').update(content || '').digest('hex');
        const res = await pool.query(
            `INSERT INTO sources (task_id, url, title, content_hash, extraction_method) 
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [taskId || null, url, title || '', hash, extractionMethod]
        );
        return res.rows[0].id;
    } catch (e) {
        console.error('[Knowledge] Error logging source:', e.message);
        return null;
    }
}

/**
 * Extract factual claims from raw text and insert them as 'candidate' items.
 */
async function extractKnowledgeCandidates(topic, rawText, sourceId) {
    if (!pool || !rawText || rawText.trim() === '') return;
    
    // Quick prompt to extract facts
    const prompt = `You are a strict data extraction system. Extract 1 to 3 distinct factual claims from the text about the topic.
Format your response as a valid JSON array of objects.
Each object must have:
- "claim": The specific factual claim (string)
- "claim_type": "fact", "statistic", "definition", or "summary" (string)
- "confidence": A number from 0.0 to 1.0 representing how explicitly the text states this.

Topic: ${topic}
Text:
${rawText.substring(0, 3000)}`;

    try {
        const response = await chat([
            { role: 'user', content: prompt }
        ], { maxTokens: 800 });

        let cleanJson = response.trim();
        if (cleanJson.startsWith('```json')) {
            cleanJson = cleanJson.replace(/^```json/, '').replace(/```$/, '').trim();
        } else if (cleanJson.startsWith('```')) {
            cleanJson = cleanJson.replace(/^```/, '').replace(/```$/, '').trim();
        }
        
        const items = JSON.parse(cleanJson);
        for (const item of items) {
            await pool.query(
                `INSERT INTO knowledge_items (topic, claim, claim_type, confidence, provenance, review_state)
                 VALUES ($1, $2, $3, $4, $5, 'candidate')`,
                [topic, item.claim, item.claim_type, item.confidence, JSON.stringify([sourceId])]
            );
        }
        console.log(`[Knowledge] Extracted ${items.length} candidate claims for topic: ${topic}`);
    } catch (e) {
        console.error('[Knowledge] Extraction failed:', e.message);
    }
}

/**
 * Pre-search retrieval: check for approved knowledge matching the query.
 * Threshold logic: 
 * 1. Full-Text Search on approved items.
 * 2. If FTS finds matches, use LLM fast-pass to verify if the claims fully answer the question.
 */
async function retrieveApprovedKnowledge(query) {
    if (!pool) return null;
    try {
        // Step 1: FTS Match
        const res = await pool.query(
            `SELECT id, topic, claim, confidence 
             FROM knowledge_items 
             WHERE review_state = 'approved'
             AND to_tsvector('english', topic || ' ' || claim) @@ plainto_tsquery('english', $1)
             ORDER BY ts_rank(to_tsvector('english', topic || ' ' || claim), plainto_tsquery('english', $1)) DESC
             LIMIT 5`,
            [query]
        );

        if (res.rows.length === 0) return null;

        // Step 2: LLM Verification (High Confidence Threshold)
        const combinedClaims = res.rows.map((r, i) => `[${i+1}] Topic: ${r.topic} | Claim: ${r.claim}`).join('\n');
        const verificationPrompt = `Does the following approved knowledge strictly and fully answer the user's question?
User Question: "${query}"
Knowledge:
${combinedClaims}

If the knowledge strictly answers the question, respond with exactly "YES" followed by a newline and then a brief summary of the answer based ONLY on the knowledge. 
If it does not fully answer the question, respond with exactly "NO".`;

        const evalResponse = await chat([{ role: 'user', content: verificationPrompt }], { maxTokens: 300 });
        const evalClean = evalResponse.trim();
        
        if (evalClean.startsWith('YES')) {
            const answer = evalClean.replace(/^YES\s*/, '').trim();
            console.log('[Knowledge] High-confidence memory match found. Bypassing live search.');
            return `[Ghost Approved Memory]\n${answer}`;
        }
        
        console.log('[Knowledge] Memories found via FTS, but rejected by LLM threshold. Proceeding to live search.');
        return null;
    } catch (e) {
        console.error('[Knowledge] Retrieval error:', e.message);
        return null;
    }
}

module.exports = { logSource, extractKnowledgeCandidates, retrieveApprovedKnowledge };
