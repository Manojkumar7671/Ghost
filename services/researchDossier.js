/**
 * services/researchDossier.js — Ghost Academic Research Dossier Foundation V0
 *
 * Core Invariants:
 * - Single allowlisted scholarly endpoint (OpenAlex /works).
 * - Finite 12,000ms hard timeout via AbortController.
 * - Maximum 512 KiB response byte ceiling.
 * - Up to 5 scholarly source records with validated HTTPS links only.
 * - Abstract inverted index reconstruction bounded to 600 chars per source.
 * - Overall dossier text bounded to 18,000 chars.
 * - Zero full-page HTML fetching, zero web scraping, zero browser automation.
 * - Zero background tasks, zero cron jobs, zero iterative loops.
 * - Zero persistence in database, task ledger, memories, Obsidian, or disk.
 * - Pure Node.js built-ins only (no external dependencies).
 */

export const OPENALEX_WORKS_URL = 'https://api.openalex.org/works';
export const SOURCE_LABEL = 'OpenAlex Scholarly Registry';
export const MAX_SOURCES = 5;
export const FETCH_TIMEOUT_MS = 12000; // 12 seconds
export const MAX_RESPONSE_BYTES = 524288; // 512 KiB (512 * 1024)
export const MAX_ABSTRACT_CHARS_PER_SOURCE = 600;
export const MAX_DOSSIER_CHARS = 18000;
export const MAX_TOPIC_LENGTH = 120;

export const GENERIC_SAFETY_REJECTION = "I can’t process that research dossier topic safely. Please rephrase it.";
export const GENERIC_FAILURE_MESSAGE = "Research dossier is unavailable right now. No scholarly records were returned.";
export const TRUTHFUL_LIMITATION = "This dossier is based only on the listed scholarly records and available abstracts retrieved in this session. I did not open full papers, and this is not permanent learning or complete subject mastery.";

// High-confidence credential & secret patterns
const CREDENTIAL_PATTERNS = [
    /-----BEGIN[ A-Z0-9_-]*PRIVATE KEY/i,
    /(?:^|[^a-zA-Z0-9_-])(?:sk|gsk|ghp|gho|ghu|ghs|ghr|xoxb|xoxp|xapp|xoxa)[-_][a-zA-Z0-9_-]{10,}/i,
    /(?:^|[^a-zA-Z0-9_-])github_pat_[a-zA-Z0-9_-]{20,}/i,
    /(?:^|[^a-zA-Z0-9_-])AKIA[0-9A-Z]{16}(?:[^0-9A-Z]|$)/,
    /(?:^|[^a-zA-Z0-9_-])eyJ[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{5,}(?:[^a-zA-Z0-9_-]|$)/ // 3-segment JWT-like token
];

// Deterministic offensive / destructive cybersecurity patterns
const OFFENSIVE_CYBER_PATTERNS = [
    /\bcredential\s+theft\b/i,
    /\b(?:malware|ransomware|keylogger|trojan|rootkit|spyware|botnet)(?:\s+payload|\s+builder|\s+generation|\s+distribution|\s+source\s+code)?\b/i,
    /\bpersistence\s+(?:mechanism|technique)s?\s+for\s+(?:malware|evasion)\b/i,
    /\b(?:evade\s+(?:edr|antivirus|detection)|bypassing\s+(?:antivirus|edr))\b/i,
    /\b(?:ddos\s+attack|dos\s+attack|packet\s+flood)\b/i,
    /\b(?:unauthorized\s+intrusion|unauthorized\s+targeting|exploiting\s+target\s+systems?)\b/i,
    /\b(?:exploit\s+payload\s+for\s+execution|generating\s+exploit\s+payloads?)\b/i
];

/**
 * Sanitizes a single external OpenAlex field for safe Markdown interpolation.
 *
 * Contract (V0):
 * - Non-string or empty input returns ''.
 * - C0 control characters (0x00–0x1F), DEL (0x7F), CR, and LF are replaced with a space.
 * - HTML-tag-shaped sequences are removed.
 * - Markdown-significant characters that could create headings (#), emphasis (* _ ~),
 *   code (`), image/link syntax (! [ ] ( )), blockquotes (>), and backslash escapes (\)
 *   are replaced with readable equivalents or removed to prevent renderer interpretation.
 * - Whitespace is collapsed to single spaces and the result is trimmed.
 * - A positive-integer maxLen cap is enforced; truncated output appends exactly '…'.
 *
 * This function is pure and local. It does not touch validated URLs, fixed labels, or years.
 *
 * @param {*} value - The external field value to sanitize.
 * @param {number} maxLen - Maximum character length of the output.
 * @returns {string}
 */
export function sanitizeExternalMarkdown(value, maxLen) {
    if (!value || typeof value !== 'string') return '';

    let s = value
        // Replace C0 controls (0x00-0x1F), DEL (0x7F) — includes CR (\r) and LF (\n)
        .replace(/[\x00-\x1F\x7F]/g, ' ')
        // Remove HTML-tag-shaped sequences
        .replace(/<[^>]+>/g, '')
        // Neutralize Markdown link/image syntax: ![text](url) or [text](url) → text
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        // Replace remaining [ ] with parentheses to break bare link syntax
        .replace(/\[/g, '(').replace(/\]/g, ')')
        // Remove emphasis/bold markers (* _ ~) and backticks
        .replace(/[*_~`]/g, '')
        // Remove backslash escape sequences (e.g. \# \* \[)
        .replace(/\\([^\s])/g, '$1')
        // Remove blockquote markers (> at start of content or after space)
        .replace(/(^|\s)>\s?/g, '$1')
        // Remove Markdown heading markers (# at start of token)
        .replace(/(^|\s)#{1,6}\s/g, '$1')
        // Collapse all remaining whitespace runs to single space and trim
        .replace(/\s+/g, ' ')
        .trim();

    if (typeof maxLen === 'number' && maxLen > 0 && s.length > maxLen) {
        // Reserve 1 char for the ellipsis
        s = s.slice(0, maxLen - 1).trimEnd() + '\u2026';
    }

    return s;
}

/**
 * Validates a research dossier topic input string locally before any network request.
 * Returns a typed safe reason code with ZERO input echoing or captured secret disclosure.
 *
 * @param {string} rawTopic
 * @returns {{ valid: boolean, reasonCode?: string }}
 */
export function validateDossierTopic(rawTopic) {
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

    // Check for offensive cybersecurity patterns
    for (const pattern of OFFENSIVE_CYBER_PATTERNS) {
        if (pattern.test(trimmed)) {
            return { valid: false, reasonCode: 'OFFENSIVE_CYBER_DETECTED' };
        }
    }

    return { valid: true };
}

/**
 * Reconstructs plain text from OpenAlex's abstract_inverted_index.
 *
 * @param {Object} invertedIndex - Map of word -> array of position indices
 * @param {number} maxChars - Maximum characters to return
 * @returns {string}
 */
export function reconstructAbstractFromInvertedIndex(invertedIndex, maxChars = MAX_ABSTRACT_CHARS_PER_SOURCE) {
    if (!invertedIndex || typeof invertedIndex !== 'object') {
        return "Abstract unavailable in the retrieved record.";
    }

    const positions = [];
    for (const [word, indices] of Object.entries(invertedIndex)) {
        if (Array.isArray(indices)) {
            for (const idx of indices) {
                if (typeof idx === 'number' && idx >= 0) {
                    positions.push({ pos: idx, word });
                }
            }
        }
    }

    if (positions.length === 0) {
        return "Abstract unavailable in the retrieved record.";
    }

    positions.sort((a, b) => a.pos - b.pos);
    const fullText = positions.map(p => p.word).join(' ').replace(/\s+/g, ' ').trim();

    if (!fullText) {
        return "Abstract unavailable in the retrieved record.";
    }

    if (fullText.length > maxChars) {
        return fullText.slice(0, maxChars).trim() + '...';
    }

    return fullText;
}

/**
 * Validates that an item URL is strictly a valid HTTPS URL.
 */
export function validateScholarlyUrl(rawUrl) {
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
 * Builds the allowlisted OpenAlex Works URL for a given topic.
 */
export function buildOpenAlexUrl(topic) {
    const encodedTopic = encodeURIComponent(topic.trim());
    return `${OPENALEX_WORKS_URL}?search=${encodedTopic}&per-page=${MAX_SOURCES}&select=id,doi,title,publication_year,authorships,primary_location,abstract_inverted_index`;
}

/**
 * Fetches academic research dossier metadata from OpenAlex for an explicit validated topic.
 *
 * @param {string} topic - The study topic string
 * @param {Object} [options] - Injected options for testing: { fetchImpl, now, timeoutMs }
 * @returns {Promise<{ success: boolean, topic?: string, sourceLabel?: string, records: Array, fetchedAt?: string, reasonCode?: string, error?: string }>}
 */
export async function fetchResearchDossier(topic, options = {}) {
    const validation = validateDossierTopic(topic);
    if (!validation.valid) {
        return {
            success: false,
            reasonCode: validation.reasonCode,
            error: GENERIC_SAFETY_REJECTION,
            records: []
        };
    }

    const cleanTopic = topic.trim();
    const targetUrl = buildOpenAlexUrl(cleanTopic);

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
                'User-Agent': 'GhostAI/1.0 (Research Dossier Reader; +http://localhost:3000)',
                'Accept': 'application/json'
            },
            redirect: 'error',
            signal: controller.signal
        });

        clearTimeout(timeoutHandle);

        if (!res.ok) {
            return {
                success: false,
                reasonCode: 'UPSTREAM_HTTP_ERROR',
                error: GENERIC_FAILURE_MESSAGE,
                records: []
            };
        }

        // Check Content-Length header if advertised
        const contentLength = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-length') : null;
        if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
            return {
                success: false,
                reasonCode: 'RESPONSE_SIZE_EXCEEDED',
                error: GENERIC_FAILURE_MESSAGE,
                records: []
            };
        }

        const rawJsonText = await res.text();
        if (!rawJsonText || Buffer.byteLength(rawJsonText, 'utf8') > MAX_RESPONSE_BYTES) {
            return {
                success: false,
                reasonCode: 'RESPONSE_SIZE_EXCEEDED',
                error: GENERIC_FAILURE_MESSAGE,
                records: []
            };
        }

        let parsedData;
        try {
            parsedData = JSON.parse(rawJsonText);
        } catch {
            return {
                success: false,
                reasonCode: 'MALFORMED_JSON',
                error: GENERIC_FAILURE_MESSAGE,
                records: []
            };
        }

        const rawResults = Array.isArray(parsedData?.results) ? parsedData.results : [];
        if (rawResults.length === 0) {
            return {
                success: false,
                reasonCode: 'NO_RECORDS_FOUND',
                error: GENERIC_FAILURE_MESSAGE,
                records: []
            };
        }

        const records = [];
        for (const item of rawResults.slice(0, MAX_SOURCES)) {
            const rawTitle = item.title && typeof item.title === 'string' ? item.title.trim() : 'Untitled Scholarly Work';
            const year = typeof item.publication_year === 'number' ? item.publication_year : (item.publication_year || 'Year n/a');
            
            // Extract top authors
            let rawAuthors = 'Authors not listed';
            if (Array.isArray(item.authorships) && item.authorships.length > 0) {
                const authorNames = item.authorships
                    .slice(0, 3)
                    .map(a => a.author?.display_name)
                    .filter(Boolean);
                if (authorNames.length > 0) {
                    rawAuthors = authorNames.join(', ') + (item.authorships.length > 3 ? ' et al.' : '');
                }
            }

            // Extract primary source venue
            const rawVenue = item.primary_location?.source?.display_name || 'Scholarly Publication / Registry';

            // Extract verified HTTPS link (not sanitized — already HTTPS-validated)
            let link = validateScholarlyUrl(item.doi) || validateScholarlyUrl(item.id);
            if (!link && typeof item.id === 'string' && item.id.startsWith('https://')) {
                link = validateScholarlyUrl(item.id);
            }

            // Reconstruct abstract from inverted index
            const rawAbstract = reconstructAbstractFromInvertedIndex(item.abstract_inverted_index, MAX_ABSTRACT_CHARS_PER_SOURCE);

            // Sanitize all external text fields for safe Markdown interpolation (V0 containment)
            const title = sanitizeExternalMarkdown(rawTitle, 300) || 'Untitled Scholarly Work';
            const authors = sanitizeExternalMarkdown(rawAuthors, 200) || 'Authors not listed';
            const venue = sanitizeExternalMarkdown(rawVenue, 150) || 'Scholarly Publication / Registry';
            const abstract = sanitizeExternalMarkdown(rawAbstract, 600) || 'Abstract unavailable in the retrieved record.';

            if (link) {
                records.push({
                    title,
                    year,
                    authors,
                    venue,
                    link,
                    abstract
                });
            }
        }

        if (records.length === 0) {
            return {
                success: false,
                reasonCode: 'NO_VALID_RECORDS_FOUND',
                error: GENERIC_FAILURE_MESSAGE,
                records: []
            };
        }

        const fetchedAt = options.now ? new Date(options.now).toISOString() : new Date().toISOString();

        return {
            success: true,
            topic: cleanTopic,
            sourceLabel: SOURCE_LABEL,
            fetchedAt,
            records: records.slice(0, MAX_SOURCES)
        };
    } catch (err) {
        clearTimeout(timeoutHandle);
        const isAbort = err.name === 'AbortError' || (err.message && err.message.includes('aborted'));
        return {
            success: false,
            reasonCode: isAbort ? 'TIMEOUT' : 'NETWORK_ERROR',
            error: GENERIC_FAILURE_MESSAGE,
            records: []
        };
    }
}

/**
 * Formats structured research dossier records into a truthful academic markdown response.
 *
 * @param {Object} dossierResult
 * @returns {string}
 */
export function formatResearchDossierMarkdown(dossierResult) {
    if (!dossierResult || !dossierResult.success || !Array.isArray(dossierResult.records) || dossierResult.records.length === 0) {
        return dossierResult && dossierResult.error ? dossierResult.error : GENERIC_FAILURE_MESSAGE;
    }

    const safeTopic = dossierResult.topic || 'Academic Research';
    const lines = [
        `# Research Dossier: ${safeTopic}`,
        '',
        `**Scope:** ${safeTopic}`,
        `**Evidence gathered:** Ghost retrieved ${dossierResult.records.length} scholarly record(s) and available abstract metadata from ${dossierResult.sourceLabel || SOURCE_LABEL} during this session.`,
        '',
        `## Scholarly Source Records`,
        ''
    ];

    dossierResult.records.forEach((record, idx) => {
        const safeMarkdownUrl = typeof record.link === 'string'
            ? record.link.replace(/\(/g, '%28').replace(/\)/g, '%29')
            : record.link;
        lines.push(`### ${idx + 1}. ${record.title} (${record.year})`);
        lines.push(`- **Authors:** ${record.authors}`);
        lines.push(`- **Venue / Source:** ${record.venue}`);
        lines.push(`- **Record / DOI Link:** [${record.link}](${safeMarkdownUrl})`);
        lines.push(`- **Abstract Excerpt:** ${record.abstract}`);
        lines.push('');
    });

    lines.push(`## How to Use This Dossier`);
    lines.push(`These source records and abstract excerpts provide an initial scholarly overview for independent study. They represent metadata and abstract indices rather than full-paper readings.`);
    lines.push('');
    lines.push(`## Limitations`);
    lines.push(`> ${TRUTHFUL_LIMITATION}`);

    let fullDossierText = lines.join('\n').trim();
    if (fullDossierText.length > MAX_DOSSIER_CHARS) {
        fullDossierText = fullDossierText.slice(0, MAX_DOSSIER_CHARS).trim() + '\n\n... (Dossier content truncated at maximum character ceiling)';
    }

    return fullDossierText;
}

export default {
    OPENALEX_WORKS_URL,
    SOURCE_LABEL,
    MAX_SOURCES,
    FETCH_TIMEOUT_MS,
    MAX_RESPONSE_BYTES,
    MAX_ABSTRACT_CHARS_PER_SOURCE,
    MAX_DOSSIER_CHARS,
    MAX_TOPIC_LENGTH,
    GENERIC_SAFETY_REJECTION,
    GENERIC_FAILURE_MESSAGE,
    TRUTHFUL_LIMITATION,
    sanitizeExternalMarkdown,
    validateDossierTopic,
    reconstructAbstractFromInvertedIndex,
    validateScholarlyUrl,
    buildOpenAlexUrl,
    fetchResearchDossier,
    formatResearchDossierMarkdown
};
