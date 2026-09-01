/**
 * services/citedResearch.js — Ghost On-Demand Cited Research V0 Service
 *
 * Core Invariants:
 * - Single allowlisted outbound endpoint (Google News RSS).
 * - Finite 8,000ms hard timeout via AbortController.
 * - Maximum 512 KiB response byte ceiling.
 * - Up to 5 cited items with validated HTTPS links only.
 * - Zero full-page HTML fetching, zero web scraping, zero browser automation.
 * - Zero background tasks, zero cron jobs, zero iterative loops.
 * - Zero persistence in database, task ledger, memories, or disk.
 * - Pure Node.js built-ins only.
 */

export const GOOGLE_NEWS_RSS_BASE = 'https://news.google.com/rss/search';
export const SOURCE_LABEL = 'Google News RSS';
export const MAX_ITEMS = 5;
export const MAX_RESPONSE_BYTES = 524288; // 512 KiB
export const FETCH_TIMEOUT_MS = 8000; // 8 seconds
export const MAX_TOPIC_LENGTH = 120;

export const GENERIC_SAFETY_REJECTION = "I can’t process that research topic safely. Please rephrase it.";
export const GENERIC_FAILURE_MESSAGE = "Research is unavailable right now. No live headlines were returned.";

// High-confidence credential & secret patterns
const CREDENTIAL_PATTERNS = [
    /-----BEGIN[ A-Z0-9_-]*PRIVATE KEY/i,
    /(?:^|[^a-zA-Z0-9_-])(?:sk|gsk|ghp|gho|ghu|ghs|ghr|xoxb|xoxp|xapp|xoxa)[-_][a-zA-Z0-9_-]{10,}/i,
    /(?:^|[^a-zA-Z0-9_-])github_pat_[a-zA-Z0-9_-]{20,}/i,
    /(?:^|[^a-zA-Z0-9_-])AKIA[0-9A-Z]{16}(?:[^0-9A-Z]|$)/,
    /(?:^|[^a-zA-Z0-9_-])eyJ[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{5,}(?:[^a-zA-Z0-9_-]|$)/ // 3-segment JWT-like token
];

/**
 * Validates a research topic input string locally before any network request.
 * Returns a typed safe reason code with ZERO input echoing or captured secret disclosure.
 *
 * @param {string} rawTopic
 * @returns {{ valid: boolean, reasonCode?: string }}
 */
export function validateResearchTopic(rawTopic) {
    if (typeof rawTopic !== 'string') {
        return { valid: false, reasonCode: 'INVALID_TYPE' };
    }

    const trimmed = rawTopic.trim();
    if (!trimmed) {
        return { valid: false, reasonCode: 'EMPTY_TOPIC' };
    }

    if (trimmed.length > MAX_TOPIC_LENGTH) {
        return { valid: false, reasonCode: 'TOPIC_TOO_LONG' };
    }

    // Check for C0 control characters (0x00-0x1F), DEL (0x7F), CR (\r), LF (\n), NUL (\0)
    if (/[\x00-\x1F\x7F]/.test(trimmed)) {
        return { valid: false, reasonCode: 'CONTROL_CHARACTERS' };
    }

    // Check for high-confidence credential patterns
    for (const pattern of CREDENTIAL_PATTERNS) {
        if (pattern.test(trimmed)) {
            return { valid: false, reasonCode: 'CREDENTIAL_PATTERN_DETECTED' };
        }
    }

    return { valid: true };
}

/**
 * Strips XML tags and decodes common XML entities.
 */
export function sanitizeXmlText(text, maxLen = 300) {
    if (!text || typeof text !== 'string') return '';
    let cleaned = text
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/[\x00-\x1F\x7F]/g, ' ')
        .trim();
    return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

/**
 * Validates that an item URL is strictly a valid HTTPS URL.
 */
export function validateItemUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    const trimmed = rawUrl.trim();
    if (!trimmed.startsWith('https://')) return null;
    if (trimmed.length > 500) return null;
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'https:') return null;
        return parsed.href;
    } catch {
        return null;
    }
}

/**
 * Parses Google News RSS XML string into up to 5 structured items.
 */
export function parseGoogleNewsRss(xmlString) {
    if (!xmlString || typeof xmlString !== 'string') {
        return [];
    }

    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;

    while ((match = itemRegex.exec(xmlString)) !== null && items.length < MAX_ITEMS) {
        const itemBlock = match[1];

        // 1. Title
        const titleMatch = itemBlock.match(/<title>([\s\S]*?)<\/title>/i);
        const title = sanitizeXmlText(titleMatch ? titleMatch[1] : '', 300);

        // 2. Link (HTTPS only)
        const linkMatch = itemBlock.match(/<link>([\s\S]*?)<\/link>/i);
        const link = validateItemUrl(sanitizeXmlText(linkMatch ? linkMatch[1] : '', 500));

        // 3. PubDate
        const pubDateMatch = itemBlock.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
        const pubDate = sanitizeXmlText(pubDateMatch ? pubDateMatch[1] : '', 100);

        // 4. Source
        const sourceMatch = itemBlock.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
        let sourceName = sourceMatch ? sanitizeXmlText(sourceMatch[1], 100) : '';

        if (!sourceName && title.includes(' - ')) {
            const parts = title.split(' - ');
            if (parts.length > 1) {
                sourceName = parts[parts.length - 1].trim();
            }
        }
        if (!sourceName) {
            sourceName = 'Google News';
        }

        if (title && link) {
            items.push({
                title,
                source: sourceName,
                pubDate: pubDate || 'Recent',
                link
            });
        }
    }

    return items;
}

/**
 * Builds the allowlisted Google News RSS URL for a given topic.
 */
export function buildRssUrl(topic) {
    const encodedTopic = encodeURIComponent(topic.trim());
    return `${GOOGLE_NEWS_RSS_BASE}?q=${encodedTopic}&hl=en-US&gl=US&ceid=US:en`;
}

/**
 * Fetches cited research metadata from Google News RSS for an explicit validated topic.
 *
 * @param {string} topic - The research topic string
 * @param {Object} [options] - Injected options for testing: { fetchImpl, now, timeoutMs }
 * @returns {Promise<{ success: boolean, topic?: string, sourceLabel?: string, items: Array, fetchedAt?: string, reasonCode?: string, error?: string }>}
 */
export async function fetchCitedResearch(topic, options = {}) {
    const validation = validateResearchTopic(topic);
    if (!validation.valid) {
        return {
            success: false,
            reasonCode: validation.reasonCode,
            error: GENERIC_SAFETY_REJECTION,
            items: []
        };
    }

    const cleanTopic = topic.trim();
    const targetUrl = buildRssUrl(cleanTopic);

    const fetchExecutor = options.fetchImpl || fetch;
    const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0 && options.timeoutMs <= FETCH_TIMEOUT_MS
        ? options.timeoutMs
        : FETCH_TIMEOUT_MS;

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetchExecutor(targetUrl, {
            method: 'GET',
            headers: {
                'User-Agent': 'GhostAI/1.0 (Research Reader; +http://localhost:3000)',
                'Accept': 'application/rss+xml, application/xml, text/xml'
            },
            signal: controller.signal
        });

        clearTimeout(timeoutHandle);

        if (!res.ok) {
            return {
                success: false,
                reasonCode: 'UPSTREAM_HTTP_ERROR',
                error: GENERIC_FAILURE_MESSAGE,
                items: []
            };
        }

        // Check Content-Length header if advertised
        const contentLength = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-length') : null;
        if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
            return {
                success: false,
                reasonCode: 'RESPONSE_SIZE_EXCEEDED',
                error: GENERIC_FAILURE_MESSAGE,
                items: []
            };
        }

        const rawXml = await res.text();
        if (!rawXml || Buffer.byteLength(rawXml, 'utf8') > MAX_RESPONSE_BYTES) {
            return {
                success: false,
                reasonCode: 'RESPONSE_SIZE_EXCEEDED',
                error: GENERIC_FAILURE_MESSAGE,
                items: []
            };
        }

        const items = parseGoogleNewsRss(rawXml);
        if (items.length === 0) {
            return {
                success: false,
                reasonCode: 'NO_ITEMS_FOUND',
                error: GENERIC_FAILURE_MESSAGE,
                items: []
            };
        }

        const fetchedAt = options.now ? new Date(options.now).toISOString() : new Date().toISOString();

        return {
            success: true,
            topic: cleanTopic,
            sourceLabel: SOURCE_LABEL,
            fetchedAt,
            items: items.slice(0, MAX_ITEMS)
        };
    } catch (err) {
        clearTimeout(timeoutHandle);
        const isAbort = err.name === 'AbortError' || (err.message && err.message.includes('aborted'));
        return {
            success: false,
            reasonCode: isAbort ? 'TIMEOUT' : 'NETWORK_ERROR',
            error: GENERIC_FAILURE_MESSAGE,
            items: []
        };
    }
}

/**
 * Formats structured research results into a truthful markdown response with citations.
 */
export function formatCitedResearchMarkdown(result) {
    if (!result || !result.success || !Array.isArray(result.items) || result.items.length === 0) {
        return result && result.error ? result.error : GENERIC_FAILURE_MESSAGE;
    }

    const safeTopic = sanitizeXmlText(result.topic || '', 120);
    const lines = [
        `Research results fetched just now for "${safeTopic}". Here are up to five cited headlines; I did not open or summarize the linked articles.`,
        ''
    ];

    result.items.forEach((item, idx) => {
        lines.push(`${idx + 1}. **${item.title}**`);
        lines.push(`   *Source:* ${item.source} · *Date:* ${item.pubDate}`);
        lines.push(`   [Source link](${item.link})`);
        lines.push('');
    });

    return lines.join('\n').trim();
}

export default {
    GOOGLE_NEWS_RSS_BASE,
    SOURCE_LABEL,
    MAX_ITEMS,
    MAX_RESPONSE_BYTES,
    FETCH_TIMEOUT_MS,
    MAX_TOPIC_LENGTH,
    GENERIC_SAFETY_REJECTION,
    GENERIC_FAILURE_MESSAGE,
    validateResearchTopic,
    sanitizeXmlText,
    validateItemUrl,
    parseGoogleNewsRss,
    buildRssUrl,
    fetchCitedResearch,
    formatCitedResearchMarkdown
};
