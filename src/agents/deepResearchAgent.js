const { chat } = require('../tools/llm');
const webAgent = require('./webAgent');
const knowledgeService = require('../services/knowledgeService');

async function run(topic, userContext) {
    if (!userContext.isAdmin) {
        return "Deep research is restricted to the owner.";
    }

    console.log(`[Deep Research] Starting exhaustive research for topic: "${topic}"`);

    // 1. Fetch search results (we'll do two passes to get more results)
    const queries = [
        topic,
        `${topic} in-depth explanation mechanisms`,
        `${topic} history controversies current state`
    ];

    let allResults = [];
    for (const q of queries) {
        const sr = await webAgent.searchWeb(q);
        if (sr.results && sr.results.length > 0) {
            allResults = allResults.concat(sr.results);
        }
    }

    // Deduplicate by URL
    const uniqueUrls = new Set();
    const uniqueResults = [];
    for (const r of allResults) {
        if (!uniqueUrls.has(r.url)) {
            uniqueUrls.add(r.url);
            uniqueResults.push(r);
        }
    }

    console.log(`[Deep Research] Found ${uniqueResults.length} unique sources.`);

    let extractedCount = 0;
    const summaries = [];

    // 2. Scrape full content and extract knowledge candidates
    // To respect rate limits and time, we'll process top 10 sources
    const topResults = uniqueResults.slice(0, 10);
    
    for (const r of topResults) {
        try {
            console.log(`[Deep Research] Scraping: ${r.url}`);
            const scrapeRes = await webAgent.scrapeAndSummarize(r.url);
            
            if (!scrapeRes.error) {
                const summaryLower = (scrapeRes.summary || '').toLowerCase();
                const isError = summaryLower.includes('400 bad request') || 
                                summaryLower.includes('unable to process') ||
                                summaryLower.includes('invalid url') ||
                                summaryLower.includes('unable to access') ||
                                summaryLower.includes('link failure') ||
                                summaryLower.includes('error page') ||
                                summaryLower.includes('captcha') ||
                                summaryLower.includes('bot detection') ||
                                summaryLower.includes('access denied') ||
                                summaryLower.includes('failed to scrape page content') ||
                                summaryLower.includes('unable to extract meaningful text') ||
                                summaryLower.includes('tls certificate') ||
                                summaryLower.includes('cloudfront 403 error') ||
                                summaryLower.includes('404 error') ||
                                summaryLower.includes('could not be loaded') ||
                                summaryLower.includes('could not be retrieved') ||
                                summaryLower.trim().length < 50;

                if (isError) {
                    console.log(`[Deep Research] Skipping failed/blocked source: ${r.url} (Reason: Matched error filter)`);
                    continue;
                }

                // Log source
                const sid = await knowledgeService.logSource({ 
                    taskId: userContext.requestId || null, 
                    url: r.url, 
                    title: r.title, 
                    content: scrapeRes.summary || r.snippet, 
                    extractionMethod: 'deep_research' 
                });
                
                if (sid) {
                    console.log(`[Debug] Scrape summary for ${r.url}: ${scrapeRes.summary.substring(0, 200)}...`);
                    // Extract candidates (passing isMastered = true)
                    await knowledgeService.extractKnowledgeCandidates(topic, scrapeRes.summary, sid, true);
                    extractedCount++;
                    summaries.push(`Source: ${r.title}\n${scrapeRes.summary}`);
                }
            }
        } catch (e) {
            console.error(`[Deep Research] Failed to scrape ${r.url}:`, e.message);
        }
    }

    console.log(`[Deep Research] Successfully processed and extracted knowledge from ${extractedCount} sources.`);

    // Hard guard: No synthesis if no sources were successfully processed
    if (extractedCount === 0 || summaries.length === 0) {
        return `**Deep research failed.** I was unable to successfully process any real sources for the topic "${topic}". The scraper was blocked or encountered errors for every candidate URL. No permanent mastery synthesis was generated to avoid hallucination.`;
    }

    // 3. Synthesize the findings
    const synthesisPrompt = `You are an expert researcher. Synthesize a comprehensive, exhaustive, above-PhD-level report on the topic: "${topic}".
Use the following summaries extracted from multiple sources to ground your report.

Requirements:
- Cover core concepts, mechanisms, edge cases, competing theories/debates, historical context, and current state of the art.
- STRICT GROUNDING RULE: Every named entity, product, hardware chip name, consortium, organization, and benchmark cited in your synthesis MUST explicitly appear in the provided Sources text below. Do NOT invent, extrapolate, or hallucinate fictitious project/chip names (such as ungrounded 3D prototypes or consortia).
- Synthesize the information elegantly, do not just list the sources.
- This is a permanent mastery document.

Sources:
${summaries.join('\n\n')}

Write the comprehensive report now:`;

    const report = await chat([{ role: 'user', content: synthesisPrompt }], { maxTokens: 4000 });

    const sourcesAggregated = summaries.join('\n\n');
    const groundingResult = validateAndFilterGrounding(report, sourcesAggregated);
    if (!groundingResult.isValid) {
        console.warn(`[Deep Research Grounding] Detected and stripped ${groundingResult.ungroundedEntities.length} ungrounded entities:`, groundingResult.ungroundedEntities);
    }
    const finalReport = groundingResult.filteredSynthesis;

    return `[DEEP RESEARCH COMPLETE]
Topic: ${topic}
Sources processed: ${extractedCount}
Knowledge Candidates Extracted & Sent to Review Pipeline: Yes

--- SYNTHESIS REPORT ---
${finalReport}
`;
}

/**
 * Programmatic grounding validator and stripper for Deep Research synthesis.
 * Scans synthesis text for technical entities, chip names, consortia, and acronyms.
 * If an entity is not mentioned anywhere in the source texts, it is detected as ungrounded and stripped/rejected.
 */
function validateAndFilterGrounding(synthesisText, sourcesText) {
    if (!synthesisText || !sourcesText) {
        return { isValid: false, ungroundedEntities: [], filteredSynthesis: synthesisText };
    }

    const sourcesLower = sourcesText.toLowerCase();

    // Match technical chip/hardware names (e.g. Synapse-3D, QuantumMem-X, H100),
    // organizations/consortia (e.g. NOA Consortium, XYZ Alliance),
    // and acronyms of 3+ capital letters (e.g. NOA, TPU, BERT)
    const entityRegexes = [
        /\b[A-Z][a-zA-Z0-9]+-[A-Z0-9]+(?:\b|[a-zA-Z0-9]+)/g, // Hyphenated technical entities: Synapse-3D, QuantumMem-X
        /\b[A-Z]{2,}(?:\s+[A-Z][a-z]+)*\s+(?:Consortium|Alliance|Foundation|Group|Labs?|Institute|Corporation|Inc|Corp|Project)\b/g, // Consortia/Orgs: NOA Consortium
        /\b[A-Z]{3,}\b/g // Acronyms: NOA, ASIC
    ];

    const commonKnownAcronyms = new Set([
        'THE', 'AND', 'FOR', 'NOT', 'ARE', 'BUT', 'ALL', 'CAN', 'WHY', 'HOW',
        'NLP', 'MLP', 'RNN', 'CNN', 'LSTM', 'GPU', 'CPU', 'TPU', 'API', 'URL', 'URI', 'JSON', 'HTML', 'HTTP', 'HTTPS'
    ]);

    const lines = synthesisText.split('\n');
    const ungroundedEntities = new Set();

    // 1. Identify all ungrounded entities across non-heading lines
    for (const line of lines) {
        if (line.trim().startsWith('#')) continue;
        for (const regex of entityRegexes) {
            const matches = line.match(regex) || [];
            for (const ent of matches) {
                if (commonKnownAcronyms.has(ent.toUpperCase())) continue;
                const entLower = ent.toLowerCase();
                const isGrounded = sourcesLower.includes(entLower);
                if (!isGrounded) {
                    ungroundedEntities.add(ent);
                }
            }
        }
    }

    // 2. Sort ungrounded entities by length descending
    const ungroundedList = Array.from(ungroundedEntities).sort((a, b) => b.length - a.length);

    // 3. Filter lines using non-colliding placeholder markers
    const filteredLines = lines.map(line => {
        if (line.trim().startsWith('#')) return line;
        let cleanLine = line;
        ungroundedList.forEach((ent, idx) => {
            cleanLine = cleanLine.replace(new RegExp(`\\b${ent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), `___UG_ENT_${idx}___`);
        });
        ungroundedList.forEach((ent, idx) => {
            cleanLine = cleanLine.replace(new RegExp(`___UG_ENT_${idx}___`, 'g'), `[UNGROUNDED ENTITY REMOVED: ${ent}]`);
        });
        return cleanLine;
    });

    return {
        isValid: ungroundedList.length === 0,
        ungroundedEntities: ungroundedList,
        filteredSynthesis: filteredLines.join('\n')
    };
}

module.exports = { run, validateAndFilterGrounding };
