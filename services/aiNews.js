/**
 * services/aiNews.js — Ghost Cited AI News V1 Service
 *
 * Requirements:
 * - Single fixed Google News RSS search URL for AI news:
 *   https://news.google.com/rss/search?q=artificial%20intelligence&hl=en-US&gl=US&ceid=US:en
 * - Pure Node.js built-ins only (no external dependencies).
 * - Maximum 8-second hard timeout via AbortController.
 * - Single fetch request (no retries, no pagination, no scraping of linked articles).
 * - Bounded response body (512KB max), max 5 items returned.
 * - Robust, safe XML tag stripping and entity decoding.
 * - Strictly HTTPS link validation.
 * - Zero persistence (no DB, no cache, no memories/tasks).
 */

export const AI_NEWS_RSS_URL = 'https://news.google.com/rss/search?q=artificial%20intelligence&hl=en-US&gl=US&ceid=US:en';
export const SOURCE_LABEL = 'Google News RSS (Artificial Intelligence)';
export const MAX_ITEMS = 5;
export const MAX_RESPONSE_BYTES = 524288; // 512 KB
export const FETCH_TIMEOUT_MS = 8000; // 8 seconds max

export const AI_NEWS_SCOPE_LABEL = "Scope: Global AI news — Google News RSS.";
export const AI_NEWS_DISCLOSURE = "AI news fetched just now from Google News RSS. Here are up to five cited headlines; I did not open or summarize the linked articles.";
export const AI_NEWS_FAILURE_MESSAGE = "I could not fetch AI news from the configured source right now. No live headlines were returned.";

/**
 * Decodes XML entities safely and strips XML/HTML tags.
 */
export function sanitizeXmlText(text, maxLen = 300) {
    if (!text || typeof text !== 'string') return '';
    let cleaned = text
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') // Extract CDATA contents
        .replace(/<[^>]+>/g, '')                      // Strip all HTML/XML tags
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/[\x00-\x1F\x7F]/g, ' ')             // Strip control characters
        .trim();
    return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

/**
 * Validates that a link is a valid HTTPS Google News or article URL.
 */
export function validateNewsUrl(rawUrl) {
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

        // 1. Extract title
        const titleMatch = itemBlock.match(/<title>([\s\S]*?)<\/title>/i);
        const rawTitle = titleMatch ? titleMatch[1] : '';
        const title = sanitizeXmlText(rawTitle, 300);

        // 2. Extract link
        const linkMatch = itemBlock.match(/<link>([\s\S]*?)<\/link>/i);
        const rawLink = linkMatch ? linkMatch[1] : '';
        const link = validateNewsUrl(sanitizeXmlText(rawLink, 500));

        // 3. Extract publication date
        const pubDateMatch = itemBlock.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
        const rawPubDate = pubDateMatch ? pubDateMatch[1] : '';
        const pubDate = sanitizeXmlText(rawPubDate, 100);

        // 4. Extract source name (e.g. <source url="...">Reuters</source>)
        const sourceMatch = itemBlock.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
        let sourceName = sourceMatch ? sanitizeXmlText(sourceMatch[1], 100) : '';

        // If sourceName is missing, try parsing from title (Google News titles are often "Headline - Source Name")
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
 * Fetches AI News from the fixed Google News RSS endpoint.
 *
 * @param {Object} options - { fetchFn, timeoutMs }
 * @returns {Promise<Object>} { success, fetchedAt, sourceLabel, items, error }
 */
export async function fetchAiNews(options = {}) {
    const fetchExecutor = options.fetchFn || fetch;
    const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0 && options.timeoutMs <= FETCH_TIMEOUT_MS
        ? options.timeoutMs
        : FETCH_TIMEOUT_MS;

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetchExecutor(AI_NEWS_RSS_URL, {
            method: 'GET',
            headers: {
                'User-Agent': 'GhostAI/1.0 (News Reader; +http://localhost:3000)',
                'Accept': 'application/rss+xml, application/xml, text/xml'
            },
            signal: controller.signal
        });

        clearTimeout(timeoutHandle);

        if (!res.ok) {
            return {
                success: false,
                error: `Upstream source returned HTTP status ${res.status}`,
                items: []
            };
        }

        const rawXml = await res.text();
        if (!rawXml || Buffer.byteLength(rawXml, 'utf8') > MAX_RESPONSE_BYTES) {
            return {
                success: false,
                error: 'Response body empty or exceeded maximum byte limit.',
                items: []
            };
        }

        const items = parseGoogleNewsRss(rawXml);
        if (items.length === 0) {
            return {
                success: false,
                error: 'No valid AI news items found in upstream RSS feed.',
                items: []
            };
        }

        return {
            success: true,
            fetchedAt: new Date().toISOString(),
            sourceLabel: SOURCE_LABEL,
            items: items.slice(0, MAX_ITEMS)
        };
    } catch (err) {
        clearTimeout(timeoutHandle);
        const isAbort = err.name === 'AbortError' || err.message?.includes('aborted');
        return {
            success: false,
            error: isAbort ? `Request timed out after ${timeoutMs}ms.` : `Fetch failed: ${err.message}`,
            items: []
        };
    }
}

/**
 * Formats structured AI news items into a truthful markdown response.
 */
export function formatAiNewsMarkdown(newsResult) {
    if (!newsResult || !newsResult.success || !Array.isArray(newsResult.items) || newsResult.items.length === 0) {
        return AI_NEWS_FAILURE_MESSAGE;
    }

    const lines = [
        AI_NEWS_SCOPE_LABEL,
        '',
        AI_NEWS_DISCLOSURE,
        ''
    ];

    newsResult.items.forEach((item, idx) => {
        lines.push(`${idx + 1}. **${item.title}**`);
        lines.push(`   *Source:* ${item.source} · *Date:* ${item.pubDate}`);
        lines.push(`   [Source link](${item.link})`);
        lines.push('');
    });

    return lines.join('\n').trim();
}

export default {
    AI_NEWS_RSS_URL,
    SOURCE_LABEL,
    MAX_ITEMS,
    MAX_RESPONSE_BYTES,
    FETCH_TIMEOUT_MS,
    AI_NEWS_SCOPE_LABEL,
    AI_NEWS_DISCLOSURE,
    AI_NEWS_FAILURE_MESSAGE,
    sanitizeXmlText,
    validateNewsUrl,
    parseGoogleNewsRss,
    fetchAiNews,
    formatAiNewsMarkdown
};
