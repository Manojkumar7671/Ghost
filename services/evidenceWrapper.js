/**
 * services/evidenceWrapper.js — Ghost Evidence Wrapper V0
 *
 * Core Contract & Invariants:
 * - Pure ESM module ("type": "module"), deterministic and side-effect free.
 * - Exactly two named exports: `createRouteReceipt` and `applyEvidenceWrapper`. Zero default export.
 * - Zero network, fetch/axios, filesystem, child processes, shell execution,
 *   timers, environment access, model calls, global state, logging, or throwing.
 * - Validates outbound reply text against an immutable, factory-branded RouteReceipt for in-scope V0 paths:
 *   1. Explicit cited research (Google News RSS metadata).
 *   2. Explicit scholarly dossier (OpenAlex works/abstract metadata).
 *   3. Explicit technical copilot plan (draft plan only).
 *   4. Plain-language dispatches to those three routes.
 *   5. Ordinary chat fallback (ordinary_no_action_evidence).
 * - Code-fence content (```...```) is preserved exactly.
 * - Negative invariants (always false across V0):
 *   canClaimBroadWebSearch, canClaimLinkedPageOpened, canClaimArticleTextRead,
 *   canClaimFullPaperRead, canClaimLocalFileOps, canClaimCodeExecution, canClaimMemoryWrite.
 * - Factory provenance via private class field (#issuedByFactory) ensures unforgeability without global registries.
 */

const VALID_ROUTE_TYPES = new Set([
  'ordinary_no_action_evidence',
  'cited_research',
  'research_dossier',
  'technical_plan'
]);

/**
 * Non-exported internal receipt class utilizing a private field for unforgeable factory branding.
 */
class RouteReceiptInternal {
  #issuedByFactory = true;

  constructor(data) {
    this.routeType = data.routeType;
    this.sourceKind = data.sourceKind;
    this.boundedRssMetadataFetched = data.boundedRssMetadataFetched;
    this.boundedScholarlyMetadataFetched = data.boundedScholarlyMetadataFetched;
    this.itemCount = data.itemCount;
    this.canClaimBroadWebSearch = false;
    this.canClaimLinkedPageOpened = false;
    this.canClaimArticleTextRead = false;
    this.canClaimFullPaperRead = false;
    this.canClaimLocalFileOps = false;
    this.canClaimCodeExecution = false;
    this.canClaimMemoryWrite = false;
    this.timestamp = data.timestamp;
  }

  static isFactoryIssued(receipt) {
    if (!receipt || typeof receipt !== 'object') {
      return false;
    }
    try {
      return receipt instanceof RouteReceiptInternal && receipt.#issuedByFactory === true;
    } catch {
      return false;
    }
  }
}

/**
 * Validates the complete canonical public field contract of a receipt.
 *
 * @param {any} receipt
 * @returns {boolean}
 */
function isCanonicalReceipt(receipt) {
  if (!RouteReceiptInternal.isFactoryIssued(receipt)) {
    return false;
  }
  if (!Object.isFrozen(receipt)) {
    return false;
  }
  if (!VALID_ROUTE_TYPES.has(receipt.routeType)) {
    return false;
  }
  if (typeof receipt.itemCount !== 'number' || !Number.isInteger(receipt.itemCount) || receipt.itemCount < 0 || receipt.itemCount > 5) {
    return false;
  }
  if (
    receipt.canClaimBroadWebSearch !== false ||
    receipt.canClaimLinkedPageOpened !== false ||
    receipt.canClaimArticleTextRead !== false ||
    receipt.canClaimFullPaperRead !== false ||
    receipt.canClaimLocalFileOps !== false ||
    receipt.canClaimCodeExecution !== false ||
    receipt.canClaimMemoryWrite !== false
  ) {
    return false;
  }

  if (receipt.routeType === 'ordinary_no_action_evidence' || receipt.routeType === 'technical_plan') {
    if (receipt.sourceKind !== null || receipt.boundedRssMetadataFetched !== false || receipt.boundedScholarlyMetadataFetched !== false || receipt.itemCount !== 0) {
      return false;
    }
  } else if (receipt.routeType === 'cited_research') {
    if (receipt.sourceKind === null) {
      if (receipt.boundedRssMetadataFetched !== false || receipt.boundedScholarlyMetadataFetched !== false || receipt.itemCount !== 0) {
        return false;
      }
    } else if (receipt.sourceKind === 'google_news_rss_metadata') {
      if (receipt.boundedRssMetadataFetched !== true || receipt.boundedScholarlyMetadataFetched !== false || receipt.itemCount < 1 || receipt.itemCount > 5) {
        return false;
      }
    } else {
      return false;
    }
  } else if (receipt.routeType === 'research_dossier') {
    if (receipt.sourceKind === null) {
      if (receipt.boundedRssMetadataFetched !== false || receipt.boundedScholarlyMetadataFetched !== false || receipt.itemCount !== 0) {
        return false;
      }
    } else if (receipt.sourceKind === 'openalex_works_metadata') {
      if (receipt.boundedScholarlyMetadataFetched !== true || receipt.boundedRssMetadataFetched !== false || receipt.itemCount < 1 || receipt.itemCount > 5) {
        return false;
      }
    } else {
      return false;
    }
  }

  return true;
}

/**
 * Creates an immutable RouteReceipt plain object with private factory provenance.
 * Missing, malformed, or unknown route types fail closed to 'ordinary_no_action_evidence'.
 *
 * @param {string} routeType
 * @param {Object} [evidence]
 * @returns {Readonly<{
 *   routeType: 'ordinary_no_action_evidence' | 'cited_research' | 'research_dossier' | 'technical_plan',
 *   sourceKind: 'google_news_rss_metadata' | 'openalex_works_metadata' | null,
 *   boundedRssMetadataFetched: boolean,
 *   boundedScholarlyMetadataFetched: boolean,
 *   itemCount: number,
 *   canClaimBroadWebSearch: false,
 *   canClaimLinkedPageOpened: false,
 *   canClaimArticleTextRead: false,
 *   canClaimFullPaperRead: false,
 *   canClaimLocalFileOps: false,
 *   canClaimCodeExecution: false,
 *   canClaimMemoryWrite: false,
 *   timestamp: string
 * }>}
 */
export function createRouteReceipt(routeType, evidence = {}) {
  const safeType = typeof routeType === 'string' && VALID_ROUTE_TYPES.has(routeType)
    ? routeType
    : 'ordinary_no_action_evidence';

  let sourceKind = null;
  let boundedRssMetadataFetched = false;
  let boundedScholarlyMetadataFetched = false;
  let itemCount = 0;

  if (safeType === 'cited_research') {
    if (evidence && evidence.sourceKind === 'google_news_rss_metadata' && evidence.boundedRssMetadataFetched === true) {
      const count = typeof evidence.itemCount === 'number' && Number.isFinite(evidence.itemCount) ? Math.floor(evidence.itemCount) : 0;
      const clampedCount = Math.max(0, Math.min(5, count));
      if (clampedCount > 0) {
        sourceKind = 'google_news_rss_metadata';
        boundedRssMetadataFetched = true;
        itemCount = clampedCount;
      }
    }
  } else if (safeType === 'research_dossier') {
    if (evidence && evidence.sourceKind === 'openalex_works_metadata' && evidence.boundedScholarlyMetadataFetched === true) {
      const count = typeof evidence.itemCount === 'number' && Number.isFinite(evidence.itemCount) ? Math.floor(evidence.itemCount) : 0;
      const clampedCount = Math.max(0, Math.min(5, count));
      if (clampedCount > 0) {
        sourceKind = 'openalex_works_metadata';
        boundedScholarlyMetadataFetched = true;
        itemCount = clampedCount;
      }
    }
  }

  const receipt = new RouteReceiptInternal({
    routeType: safeType,
    sourceKind,
    boundedRssMetadataFetched,
    boundedScholarlyMetadataFetched,
    itemCount,
    timestamp: typeof evidence?.timestamp === 'string' && evidence.timestamp ? evidence.timestamp : ''
  });

  return Object.freeze(receipt);
}

/**
 * Sanitizes non-code text segments against route receipt rules.
 */
function sanitizeSegment(segment, receipt) {
  let text = segment;

  // 1. Broad web search, browsing, linked-page opening, scraping, or article text claims
  // (Always forbidden across all routes in V0)
  text = text.replace(
    /\b(?:I|Ghost)\s+(?:also\s+|just\s+)?(?:browsed|searched(?:\s+the\s+web\s+for|\s+online\s+for)?|navigated\s+to|scraped|crawled|opened\s+(?:the\s+)?(?:url|webpage|website|link|page|article)|visited|read\s+(?:the\s+)?(?:full\s+)?article\s+text)\b[^\.\n]*[\.\!]?/gi,
    'For this bounded response, Ghost did not browse websites, open linked pages, or read full article texts.'
  );

  // 2. Full paper reading / PDF reading / complete learning claims
  // (Forbidden across all routes including dossier)
  text = text.replace(
    /\b(?:I|Ghost)\s+(?:also\s+|just\s+)?(?:read|downloaded|analyzed|examined)\s+(?:the\s+)?(?:full\s+papers?|pdfs?|complete\s+manuscripts?)\b[^\.\n]*[\.\!]?/gi,
    'For this bounded response, Ghost did not read full papers or PDFs.'
  );
  text = text.replace(
    /\b(?:I|Ghost)\s+(?:have\s+)?(?:permanently\s+)?(?:learned|mastered)\s+(?:this|all|the)\s+(?:topic|subject|material)\b[^\.\n]*[\.\!]?/gi,
    'This overview is limited to retrieved metadata and is not permanent learning.'
  );

  // 3. File creation, edit, write, delete, or inspection claims
  // (Always forbidden in V0 routes)
  text = text.replace(
    /\b(?:I|Ghost)\s+(?:also\s+|just\s+)?(?:created|modified|changed|edited|deleted|removed|saved|wrote)\s+(?:the\s+|your\s+|local\s+)?files?\s*(?:to\s+(?:disk|your\s+filesystem|storage))?\b[^\.\n]*[\.\!]?/gi,
    'For this bounded response, Ghost did not access, create, or change local files.'
  );
  text = text.replace(
    /\b(?:I|Ghost)\s+(?:also\s+|just\s+)?(?:read|inspected|checked|opened)\s+(?:your\s+|the\s+)?(?:local|private)\s+files?\b[^\.\n]*[\.\!]?/gi,
    'For this bounded response, Ghost did not access, create, or change local files.'
  );

  // 4. Code execution, shell/terminal command running, test execution, or deployment claims
  // (Always forbidden in V0 routes)
  text = text.replace(
    /\b(?:I|Ghost)\s+(?:also\s+|just\s+)?(?:executed|ran|run|tested)\s+(?:the\s+)?(?:code|commands?|scripts?|tests?|test\s+suite)\b[^\.\n]*[\.\!]?/gi,
    'For this bounded response, Ghost did not execute code, commands, or tests.'
  );
  text = text.replace(
    /\b(?:I|Ghost)\s+(?:also\s+|just\s+)?(?:deployed|pushed\s+to\s+production|published)\s+(?:the\s+)?(?:app|application|service|code)\b[^\.\n]*[\.\!]?/gi,
    'For this bounded response, Ghost did not deploy any code or service.'
  );

  // 5. Permanent memory, task ledger, or Obsidian write claims
  // (Always forbidden in V0 routes)
  text = text.replace(
    /\b(?:I|Ghost)\s+(?:also\s+|just\s+)?(?:saved|stored|recorded|updated|committed|wrote)\s+(?:this|that|it|information)?\s*(?:to|in)\s+(?:permanent\s+memory|long-term\s+memory|Obsidian(?:\s+vault)?|task\s+ledger)\b[^\.\n]*[\.\!]?/gi,
    'For this bounded response, Ghost did not save permanent memory or update Obsidian.'
  );

  // 6. Device control / OS control claims
  text = text.replace(
    /\b(?:I|Ghost)\s+(?:also\s+|just\s+)?(?:opened|controlled|launched)\s+(?:your\s+)?(?:camera|calculator|terminal|safari|chrome|app|device)\b[^\.\n]*[\.\!]?/gi,
    'For this bounded response, Ghost did not control local applications or devices.'
  );

  // 7. Route-specific conflict checks:
  // If ordinary_no_action_evidence or technical_plan claims that sources or headlines were retrieved
  if (receipt.routeType === 'ordinary_no_action_evidence' || receipt.routeType === 'technical_plan') {
    text = text.replace(
      /\b(?:I|Ghost)\s+(?:also\s+|just\s+)?(?:retrieved|fetched|found)\s+(?:live\s+|verified\s+)?(?:sources?|headlines?|scholarly\s+records?|citations?)\s+(?:for\s+this|in\s+this\s+chat)\b[^\.\n]*[\.\!]?/gi,
      'For this answer, no external sources or live headlines were retrieved.'
    );
  }

  // If cited_research or research_dossier has 0 itemCount or false fetched flag but text claims records were found
  if (receipt.routeType === 'cited_research' && (!receipt.boundedRssMetadataFetched || receipt.itemCount === 0)) {
    text = text.replace(
      /\b(?:retrieved|fetched|here\s+are)\s+(?:\d+\s+)?(?:cited\s+headlines?|news\s+items?)\b[^\.\n]*[\.\!]?/gi,
      'No live headlines were returned.'
    );
  }
  if (receipt.routeType === 'research_dossier' && (!receipt.boundedScholarlyMetadataFetched || receipt.itemCount === 0)) {
    text = text.replace(
      /\b(?:retrieved|gathered|here\s+are)\s+(?:\d+\s+)?(?:scholarly\s+records?|abstract\s+metadata)\b[^\.\n]*[\.\!]?/gi,
      'No scholarly records were returned.'
    );
  }

  return text;
}

/**
 * Applies the Evidence Wrapper V0 to replyText using the provided RouteReceipt.
 * Requires genuine receipt provenance; forged/raw/invalid objects fail closed to ordinary_no_action_evidence.
 * Preserves code fences exactly, Coerces non-string input safely.
 *
 * @param {string} replyText
 * @param {Object} [receipt]
 * @returns {string}
 */
export function applyEvidenceWrapper(replyText, receipt) {
  if (replyText === null || replyText === undefined) {
    return '';
  }

  const rawText = typeof replyText === 'string' ? replyText : String(replyText);
  if (rawText.length === 0) {
    return '';
  }

  // Strict provenance & canonical field validation:
  // Must be genuine factory-branded immutable receipt matching canonical field contracts; otherwise fail closed to ordinary_no_action_evidence
  const safeReceipt = isCanonicalReceipt(receipt)
    ? receipt
    : createRouteReceipt('ordinary_no_action_evidence');

  // Split by markdown code fences (```...```) to preserve code block content verbatim
  const codeBlockRegex = /(```[\s\S]*?```)/g;
  const parts = rawText.split(codeBlockRegex);

  let processed = parts.map((part) => {
    if (part.startsWith('```') && part.endsWith('```')) {
      return part;
    }
    return sanitizeSegment(part, safeReceipt);
  }).join('');

  // For technical plan: Ensure exact PLAN ONLY — NO LOCAL WRITES safety banner is preserved if this was a plan
  if (safeReceipt.routeType === 'technical_plan') {
    if (!processed.includes('PLAN ONLY — NO LOCAL WRITES')) {
      processed = processed.trim() + '\n\nPLAN ONLY — NO LOCAL WRITES';
    }
  }

  return processed;
}
