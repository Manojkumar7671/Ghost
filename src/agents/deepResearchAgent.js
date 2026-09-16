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
- Synthesize the information elegantly, do not just list the sources.
- This is a permanent mastery document.

Sources:
${summaries.join('\n\n')}

Write the comprehensive report now:`;

    const report = await chat([{ role: 'user', content: synthesisPrompt }], { maxTokens: 4000 });

    return `[DEEP RESEARCH COMPLETE]
Topic: ${topic}
Sources processed: ${extractedCount}
Knowledge Candidates Extracted & Sent to Review Pipeline: Yes

--- SYNTHESIS REPORT ---
${report}
`;
}

module.exports = { run };
