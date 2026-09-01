import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import {
    listPersonalTasks,
    appendPersonalTaskEvent,
    isPotentialSecret,
    SECRET_REJECTION_MESSAGE
} from './personalCore.js';

/**
 * services/patchDraftReviewWorker.js — Ghost Patch Draft/Review V1 Service
 *
 * Core Contract & Invariants:
 * - NON-WRITING PROPOSAL & REVIEW LAYER ONLY:
 *   * NO file modifications, creation, deletion, or renaming.
 *   * NO temporary file creation or atomic-write preparation.
 *   * NO command, shell, compiler, or test execution.
 *   * NO background queues, schedulers, daemons, polling loops, or worker threads.
 *   * NO apply action or execution authority.
 *   * 'reviewed' status means OWNER HAS REVIEWED AND SEALED THE PROPOSAL, NOT that any edit may be applied.
 * - PROTECTED-CONTENT & TARGET-PATH REDACTION LIFECYCLE:
 *   * Draft records NEVER retain target path, filename, line references, or source hints.
 *   * Target path is bound ONLY in a server-controlled transient manifest mapping during the active draft lifecycle.
 *   * Opaque repositoryId and exactManifestId hold zero path/filename material.
 *   * Terminal transitions (reviewed, cancelled, expired, stale, rejected) discard the transient manifest binding immediately.
 *   * Missing manifest bindings fail closed with MANIFEST_BINDING_UNAVAILABLE.
 *   * Server-side draft records NEVER retain beforeContent, afterContent, or unifiedDiff after proposal response.
 *   * Immutable Task Ledger events NEVER contain target path, filenames, or source hints.
 *
 * Exact Literal Safety Banner:
 * "PATCH PROPOSAL ONLY — NO REPOSITORY FILES CHANGED — REVIEW SEALS THIS PROPOSAL BUT DOES NOT APPLY IT."
 */

export const SAFETY_BANNER = "PATCH PROPOSAL ONLY — NO REPOSITORY FILES CHANGED — REVIEW SEALS THIS PROPOSAL BUT DOES NOT APPLY IT.";
export const SEAL_SCHEMA_VERSION = "ghost.patch.seal.v1";
export const CANONICALIZATION_VERSION = "rfc8785.v1";
export const HASH_ALGORITHM = "SHA-256";
export const POLICY_VERSION = "edit_worker_policy_v1.0";
export const CONTENT_STORAGE_CONTRACT_VERSION = "ghost.content.storage.v1";
export const MANIFEST_VERSION = "ghost.manifest.v1";
export const REPOSITORY_ID = "ghost-local-root";

export const ALLOWED_DRAFT_STATES = ['draft', 'reviewed', 'cancelled', 'expired', 'stale', 'rejected'];

export const MIN_EXPIRY_MINUTES = 5;
export const MAX_EXPIRY_MINUTES = 60;
export const DEFAULT_EXPIRY_MINUTES = 30;

export const MAX_FILE_BYTES = 65536; // 64 KiB
export const MAX_DIFF_BYTES = 16384; // 16 KiB
export const MAX_PATH_CHARS = 200;

// Service-level protected path denylist (overrides every manifest)
const PROTECTED_PATH_PATTERNS = [
    /^\./,                              // Root dotfiles (.env, .git, etc.)
    /\/\./,                             // Nested dotfiles
    /\.env(\..+)?$/i,                   // All .env variants
    /credentials/i,                     // Credentials files
    /id_rsa/i,                          // SSH keys
    /\.(pem|key|pkcs12|p12|crt|cer)$/i, // Certificates and private keys
    /secrets?/i,                        // Secrets files or folders
    /\.git(\/|$)/i,                     // Git metadata
    /\.pm2(\/|$)/i,                     // PM2 metadata
    /\.github(\/|$)/i,                  // GitHub actions/workflows
    /\.husky(\/|$)/i,                   // Git hooks
    /node_modules(\/|$)/i,              // Dependencies
    /package\.json$/i,                  // Package manifest
    /package-lock\.json$/i,             // Package lockfile
    /yarn\.lock$/i,                     // Yarn lockfile
    /pnpm-lock\.yaml$/i,                // PNPM lockfile
    /server\.js$/i,                     // Runtime entrypoint
    /main\.cjs$/i,                      // Core entrypoint
    /ecosystem\.config\.(c?js)$/i,      // Process manager config
    /index\.js$/i,                      // Index entrypoint
    /\.DS_Store$/i,                     // macOS metadata
    /Thumbs\.db$/i,                     // Windows metadata
    /\.vscode(\/|$)/i,                  // VSCode config
    /\.idea(\/|$)/i,                    // JetBrains config
    /\.swp$/i,                          // Vim swap files
    /~$/,                               // Editor backup files
    /dist(\/|$)/i,                      // Build artifacts
    /build(\/|$)/i,                     // Build artifacts
    /outputs(\/|$)/i,                   // Output downloads
    /logs(\/|$)/i,                      // Log directories
    /coverage(\/|$)/i,                  // Test coverage
    /\0/,                               // Null byte
    /\.\.[\/\\]/,                       // Directory traversal
    /^[\/\\]/,                          // Leading slash (absolute path)
    /^[a-zA-Z]:/                        // Windows drive letter
];

const DISALLOWED_EXTENSIONS = [
    '.exe', '.so', '.dylib', '.dll', '.bin', '.dmg', '.iso', '.app', '.pkg',
    '.zip', '.tar', '.gz', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf',
    '.mp3', '.wav', '.pyc'
];

// In-memory isolated draft metadata store: ownerId -> Map<draftId, DraftMetadataRecord>
// Holds ONLY opaque identifiers and cryptographic metadata; NEVER stores paths or content.
const inMemoryDraftStore = new Map();

// Server-controlled transient manifest mapping: `${repositoryId}:${exactManifestId}` -> { canonicalTargetPath }
// Purely in-memory, fail-closed, discarded upon terminal transitions (reviewed, cancelled, expired, stale, rejected).
const transientManifestStore = new Map();

function getManifestKey(repositoryId, exactManifestId) {
    return `${repositoryId}:${exactManifestId}`;
}

/**
 * Reset in-memory draft store and transient manifest store for unit testing isolation.
 */
export function resetPatchDraftStoreForTesting() {
    inMemoryDraftStore.clear();
    transientManifestStore.clear();
}

/**
 * Reset only transient manifest mappings to simulate restart/loss of transient bindings.
 */
export function resetTransientManifestsForTesting() {
    transientManifestStore.clear();
}

/**
 * Generates an opaque record ID for patch drafts and manifests.
 * Opaque IDs contain only timestamp and random hex, with zero path/filename data.
 */
function generateRecordId(prefix = 'pdrf') {
    const timestamp = Date.now().toString(36);
    const randomHex = crypto.randomBytes(4).toString('hex');
    return `${prefix}_${timestamp}_${randomHex}`;
}

/**
 * Normalize line endings to standard Unix \n and validate UTF-8 encoding.
 */
export function normalizeContent(content) {
    if (typeof content !== 'string') return '';
    return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Computes standard SHA-256 hex digest of a UTF-8 string.
 */
export function computeSha256(content) {
    return crypto.createHash('sha256').update(content || '', 'utf8').digest('hex');
}

/**
 * Deterministic JSON stringify adhering to RFC 8785 Canonicalization Scheme (JCS).
 * Recursively sorts all object keys lexicographically and outputs compact JSON.
 */
export function canonicalJsonStringify(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return '[' + value.map(canonicalJsonStringify).join(',') + ']';
    }
    const sortedKeys = Object.keys(value).sort();
    const keyValues = sortedKeys.map(key => {
        return JSON.stringify(key) + ':' + canonicalJsonStringify(value[key]);
    });
    return '{' + keyValues.join(',') + '}';
}

/**
 * Fail-Closed Secret Screening Engine.
 * Scans both original target file content and proposed after-content.
 * Emits only a non-secret reason code and detector category upon detection.
 */
export function scanForSecrets(text) {
    if (!text || typeof text !== 'string') return { hasSecret: false };

    // 1. Private Key Material
    if (/-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----/i.test(text)) {
        return { hasSecret: true, detectorCategory: 'private_key_material' };
    }

    // 2. Recognized Provider Token Prefixes
    if (/\bsk-[a-zA-Z0-9]{20,}\b/.test(text)) {
        return { hasSecret: true, detectorCategory: 'provider_token_openai' };
    }
    if (/\bsk-ant-[a-zA-Z0-9_-]{20,}\b/.test(text)) {
        return { hasSecret: true, detectorCategory: 'provider_token_anthropic' };
    }
    if (/\bgh[pors]_[a-zA-Z0-9]{36,}\b/.test(text)) {
        return { hasSecret: true, detectorCategory: 'provider_token_github' };
    }
    if (/\bxox[baprs]-[0-9]{10,}-[a-zA-Z0-9]+\b/.test(text)) {
        return { hasSecret: true, detectorCategory: 'provider_token_slack' };
    }
    if (/\bsk_live_[a-zA-Z0-9]{24,}\b/.test(text)) {
        return { hasSecret: true, detectorCategory: 'provider_token_stripe' };
    }
    if (/(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])/.test(text)) {
        return { hasSecret: true, detectorCategory: 'cloud_access_key_aws' };
    }

    // 3. Sensitive Key-Value Assignments (excluding narrow RFC placeholders)
    const sensitiveAssignmentMatch = /(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)\s*[:=]\s*["']([^"']{8,})["']/i.exec(text);
    if (sensitiveAssignmentMatch) {
        const val = sensitiveAssignmentMatch[1].toLowerCase();
        const isPlaceholder = /^(your_api_key_here|<insert_key_here>|placeholder|example_password|xxxx+)/.test(val);
        if (!isPlaceholder) {
            return { hasSecret: true, detectorCategory: 'sensitive_assignment' };
        }
    }

    // 4. Credential-bearing URIs / Connection Strings
    if (/(?:postgres|postgresql|mysql|mongodb|mongodb\+srv|redis):\/\/[^:\s]+:[^@\s]+@[^\s]+/i.test(text)) {
        return { hasSecret: true, detectorCategory: 'credential_connection_string' };
    }

    // 5. Structured High-Entropy Tokens (e.g. JWT)
    if (/\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/.test(text)) {
        return { hasSecret: true, detectorCategory: 'structured_high_entropy_token' };
    }

    return { hasSecret: false };
}

/**
 * Pure JavaScript Unified Diff Generator.
 * Compares beforeContent and afterContent line-by-line and produces a standard unified diff.
 */
export function generateUnifiedDiff(filePath, beforeContent, afterContent) {
    const beforeLines = beforeContent ? beforeContent.split('\n') : [];
    const afterLines = afterContent ? afterContent.split('\n') : [];

    const header = `--- a/${filePath}\n+++ b/${filePath}\n`;
    if (beforeLines.length === 0 && afterLines.length === 0) {
        return header + '@@ -0,0 +0,0 @@\n';
    }

    // Standard LCS-based diff calculation
    const n = beforeLines.length;
    const m = afterLines.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));

    for (let i = 0; i < n; i++) {
        for (let j = 0; j < m; j++) {
            if (beforeLines[i] === afterLines[j]) {
                dp[i + 1][j + 1] = dp[i][j] + 1;
            } else {
                dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
    }

    // Backtrack to build hunks
    const diffEntries = [];
    let i = n;
    let j = m;

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && beforeLines[i - 1] === afterLines[j - 1]) {
            diffEntries.push({ type: ' ', line: beforeLines[i - 1] });
            i--;
            j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            diffEntries.push({ type: '+', line: afterLines[j - 1] });
            j--;
        } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
            diffEntries.push({ type: '-', line: beforeLines[i - 1] });
            i--;
        }
    }

    diffEntries.reverse();

    // Format single unified hunk
    const hunkBody = diffEntries.map(e => `${e.type}${e.line}`).join('\n');
    const hunkHeader = `@@ -1,${n} +1,${m} @@\n`;
    return header + hunkHeader + hunkBody + '\n';
}

/**
 * Validates canonical relative target path against protected denylist.
 */
export function validateTargetPath(targetPath) {
    if (typeof targetPath !== 'string' || !targetPath.trim()) {
        return { valid: false, error: 'Target path is required.' };
    }
    const cleanPath = path.normalize(targetPath.trim()).replace(/^(\.\.[\/\\])+/, '');
    if (cleanPath.length > MAX_PATH_CHARS) {
        return { valid: false, error: `Target path exceeds maximum character limit.` };
    }

    for (const pattern of PROTECTED_PATH_PATTERNS) {
        if (pattern.test(cleanPath)) {
            return { valid: false, error: `Target path is protected and disallowed.` };
        }
    }

    const ext = path.extname(cleanPath).toLowerCase();
    if (DISALLOWED_EXTENSIONS.includes(ext)) {
        return { valid: false, error: `Target file extension is not permitted.` };
    }

    return { valid: true, canonicalTargetPath: cleanPath };
}

/**
 * Propose a new single-file patch draft (Non-Writing).
 * Binds target path strictly in transientManifestStore; draft record holds only opaque identifiers.
 */
export async function proposePatchDraft(ownerId, taskId, { targetPath, proposedAfterContent, expiryMinutes = DEFAULT_EXPIRY_MINUTES } = {}, { dbPool = null, repoRoot = process.cwd() } = {}) {
    if (!ownerId || !taskId) {
        return { success: false, error: 'Owner ID and Task ID are required.' };
    }

    // Verify task exists in Personal Core
    const tasks = await listPersonalTasks(ownerId, dbPool);
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
        return { success: false, error: 'Task not found or unauthorized.' };
    }
    if (task.status === 'cancelled') {
        return { success: false, error: 'Cannot draft proposal for a cancelled task.' };
    }

    // Validate path
    const pathCheck = validateTargetPath(targetPath);
    if (!pathCheck.valid) {
        return { success: false, error: pathCheck.error, reasonCode: 'PROTECTED_PATH_REJECTED' };
    }
    const canonicalTargetPath = pathCheck.canonicalTargetPath;

    // Check expiry bounds
    const expMinutes = Number.isInteger(expiryMinutes) ? Math.min(Math.max(expiryMinutes, MIN_EXPIRY_MINUTES), MAX_EXPIRY_MINUTES) : DEFAULT_EXPIRY_MINUTES;

    // Resolve physical file on disk
    const absolutePath = path.resolve(repoRoot, canonicalTargetPath);
    if (!absolutePath.startsWith(path.resolve(repoRoot) + path.sep)) {
        return { success: false, error: 'Path traversal out of repository root is forbidden.', reasonCode: 'PATH_TRAVERSAL_REJECTED' };
    }

    if (!fs.existsSync(absolutePath)) {
        return { success: false, error: 'Target file does not exist on disk.', reasonCode: 'TARGET_NOT_FOUND' };
    }

    const stat = fs.lstatSync(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
        return { success: false, error: 'Target is not a regular file.', reasonCode: 'NON_REGULAR_FILE_REJECTED' };
    }

    if (stat.size > MAX_FILE_BYTES) {
        return { success: false, error: `Target file exceeds maximum size limit.`, reasonCode: 'SIZE_LIMIT_EXCEEDED' };
    }

    // Read physical beforeContent directly from server disk
    const rawBefore = fs.readFileSync(absolutePath, 'utf8');
    const beforeContent = normalizeContent(rawBefore);
    const afterContent = normalizeContent(typeof proposedAfterContent === 'string' ? proposedAfterContent : '');

    if (Buffer.byteLength(afterContent, 'utf8') > MAX_FILE_BYTES) {
        return { success: false, error: `Proposed content exceeds maximum size limit.`, reasonCode: 'SIZE_LIMIT_EXCEEDED' };
    }

    // Secret Screening (Fail-Closed)
    const beforeSecret = scanForSecrets(beforeContent);
    if (beforeSecret.hasSecret) {
        return {
            success: false,
            error: 'Secret detected in target file content. Proposal rejected fail-closed.',
            reasonCode: 'SECRET_DETECTED',
            detectorCategory: beforeSecret.detectorCategory
        };
    }
    const afterSecret = scanForSecrets(afterContent);
    if (afterSecret.hasSecret) {
        return {
            success: false,
            error: 'Secret detected in proposed content. Proposal rejected fail-closed.',
            reasonCode: 'SECRET_DETECTED',
            detectorCategory: afterSecret.detectorCategory
        };
    }

    // Server-derived hashes & diff
    const beforeContentSha256 = computeSha256(beforeContent);
    const afterContentSha256 = computeSha256(afterContent);
    const unifiedDiff = generateUnifiedDiff(canonicalTargetPath, beforeContent, afterContent);

    if (Buffer.byteLength(unifiedDiff, 'utf8') > MAX_DIFF_BYTES) {
        return { success: false, error: `Unified diff exceeds maximum limit.`, reasonCode: 'DIFF_SIZE_EXCEEDED' };
    }
    const unifiedDiffSha256 = computeSha256(unifiedDiff);

    const now = new Date();
    const expiresAtDate = new Date(now.getTime() + expMinutes * 60 * 1000);
    const draftId = generateRecordId('pdrf');
    const exactManifestId = generateRecordId('pman');

    // Bind canonical path ONLY in server-controlled transient manifest store
    transientManifestStore.set(getManifestKey(REPOSITORY_ID, exactManifestId), {
        canonicalTargetPath
    });

    // Metadata record ONLY — holds opaque identifiers; NEVER stores canonicalTargetPath or raw content
    const draftRecord = {
        draftId,
        ownerId: String(ownerId),
        taskId: String(taskId),
        repositoryId: REPOSITORY_ID,
        exactManifestId,
        exactManifestVersion: MANIFEST_VERSION,
        beforeContentSha256,
        afterContentSha256,
        unifiedDiffSha256,
        policyVersion: POLICY_VERSION,
        contentStorageContractVersion: CONTENT_STORAGE_CONTRACT_VERSION,
        sealSchemaVersion: SEAL_SCHEMA_VERSION,
        canonicalizationVersion: CANONICALIZATION_VERSION,
        hashAlgorithm: HASH_ALGORITHM,
        createdAt: now.toISOString(),
        reviewedAt: null,
        expiresAt: expiresAtDate.toISOString(),
        status: 'draft',
        sealedHash: null,
        safetyBanner: SAFETY_BANNER
    };

    // Store strictly non-content, non-path metadata in owner map
    if (!inMemoryDraftStore.has(String(ownerId))) {
        inMemoryDraftStore.set(String(ownerId), new Map());
    }
    inMemoryDraftStore.get(String(ownerId)).set(draftId, draftRecord);

    // Record immutable audit event in Task Ledger (REDACTED: NO targetPath or source hints)
    await appendPersonalTaskEvent(ownerId, taskId, 'approval_contract_drafted', {
        draftId,
        action: 'patch_draft_proposed',
        beforeContentSha256,
        afterContentSha256,
        unifiedDiffSha256,
        policyVersion: POLICY_VERSION,
        expiresAt: draftRecord.expiresAt
    }, dbPool);

    return {
        success: true,
        draft: sanitizeDraftForPublicView(draftRecord),
        // One-time volatile review material returned to client in response only
        volatileReviewMaterial: {
            unifiedDiff,
            afterContent
        }
    };
}

/**
 * Fetches an existing draft metadata by ID for the owner.
 * Evaluates lazy expiry and disk-freshness checks on access.
 */
export async function getPatchDraftById(ownerId, draftId, { repoRoot = process.cwd(), dbPool = null } = {}) {
    if (!ownerId || !draftId) {
        return { success: false, error: 'Owner ID and Draft ID are required.' };
    }

    const ownerDrafts = inMemoryDraftStore.get(String(ownerId));
    if (!ownerDrafts || !ownerDrafts.has(draftId)) {
        return { success: false, error: 'Patch draft not found or unauthorized.' };
    }

    const draft = ownerDrafts.get(draftId);

    // Evaluate lazy expiry
    if (draft.status === 'draft' || draft.status === 'reviewed') {
        if (Date.now() > Date.parse(draft.expiresAt)) {
            draft.status = 'expired';
            // Terminal transition: clear transient manifest binding
            transientManifestStore.delete(getManifestKey(draft.repositoryId, draft.exactManifestId));
            await appendPersonalTaskEvent(ownerId, draft.taskId, 'approval_contract_expired', {
                draftId: draft.draftId,
                action: 'patch_draft_expired'
            }, dbPool);
        }
    }

    // Evaluate disk freshness if transient manifest binding is present
    if (draft.status === 'draft' || draft.status === 'reviewed') {
        const manifestKey = getManifestKey(draft.repositoryId, draft.exactManifestId);
        const transientManifest = transientManifestStore.get(manifestKey);
        if (transientManifest && transientManifest.canonicalTargetPath) {
            const absolutePath = path.resolve(repoRoot, transientManifest.canonicalTargetPath);
            if (fs.existsSync(absolutePath)) {
                const currentBytes = fs.readFileSync(absolutePath, 'utf8');
                const currentSha = computeSha256(normalizeContent(currentBytes));
                if (currentSha !== draft.beforeContentSha256) {
                    draft.status = 'stale';
                    transientManifestStore.delete(manifestKey);
                }
            }
        }
    }

    return {
        success: true,
        draft: sanitizeDraftForPublicView(draft)
    };
}

/**
 * Fetches active or latest patch draft metadata for a specific task.
 */
export async function getPatchDraftForTask(ownerId, taskId, options = {}) {
    if (!ownerId || !taskId) {
        return { success: false, error: 'Owner ID and Task ID are required.' };
    }
    const ownerDrafts = inMemoryDraftStore.get(String(ownerId));
    if (!ownerDrafts) {
        return { success: true, draft: null };
    }

    let matchingDrafts = [];
    for (const [id, d] of ownerDrafts.entries()) {
        if (d.taskId === taskId) {
            matchingDrafts.push(d);
        }
    }

    if (matchingDrafts.length === 0) {
        return { success: true, draft: null };
    }

    // Sort newest first
    matchingDrafts.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const latest = matchingDrafts[0];

    // Trigger lazy freshness/expiry via getPatchDraftById
    return await getPatchDraftById(ownerId, latest.draftId, options);
}

/**
 * Reviews and cryptographically seals a patch draft (Non-Writing).
 * Resolves target path ONLY from server-controlled transient manifest binding.
 * Discards transient binding upon terminal completion (reviewed, stale, or rejected).
 */
export async function reviewPatchDraft(ownerId, draftId, { proposedAfterContent } = {}, { repoRoot = process.cwd(), dbPool = null } = {}) {
    if (!ownerId || !draftId) {
        return { success: false, error: 'Owner ID and Draft ID are required.' };
    }

    // Non-terminal authorization check: wrong owner does not mutate draft or delete transient binding
    const ownerDrafts = inMemoryDraftStore.get(String(ownerId));
    if (!ownerDrafts || !ownerDrafts.has(draftId)) {
        return { success: false, error: 'Patch draft not found or unauthorized.' };
    }

    const draft = ownerDrafts.get(draftId);

    // Replay idempotency: if already reviewed, return existing reviewed record
    if (draft.status === 'reviewed' && draft.sealedHash) {
        return {
            success: true,
            draft: sanitizeDraftForPublicView(draft),
            idempotent: true
        };
    }

    if (draft.status !== 'draft') {
        return { success: false, error: `Cannot review draft in '${draft.status}' state.` };
    }

    const manifestKey = getManifestKey(draft.repositoryId, draft.exactManifestId);

    // Check expiry
    if (Date.now() > Date.parse(draft.expiresAt)) {
        draft.status = 'expired';
        transientManifestStore.delete(manifestKey);
        await appendPersonalTaskEvent(ownerId, draft.taskId, 'approval_contract_expired', {
            draftId: draft.draftId,
            action: 'patch_draft_expired'
        }, dbPool);
        return { success: false, error: 'Patch draft has expired and cannot be reviewed.' };
    }

    // Resolve target path strictly through transient manifest mapping
    const transientManifest = transientManifestStore.get(manifestKey);
    if (!transientManifest || !transientManifest.canonicalTargetPath) {
        return {
            success: false,
            error: 'Manifest binding unavailable.',
            reasonCode: 'MANIFEST_BINDING_UNAVAILABLE'
        };
    }
    const canonicalTargetPath = transientManifest.canonicalTargetPath;

    // Untrusted proposedAfterContent verification
    if (typeof proposedAfterContent !== 'string') {
        return { success: false, error: 'Volatile review material (proposedAfterContent) is required for review confirmation.' };
    }

    const normalizedAfter = normalizeContent(proposedAfterContent);
    const afterSecret = scanForSecrets(normalizedAfter);
    if (afterSecret.hasSecret) {
        // Terminal rejection: discard transient binding before event or response
        draft.status = 'rejected';
        transientManifestStore.delete(manifestKey);
        await appendPersonalTaskEvent(ownerId, draft.taskId, 'approval_contract_cancelled', {
            draftId: draft.draftId,
            action: 'patch_draft_rejected',
            reasonCode: 'SECRET_DETECTED'
        }, dbPool);
        return {
            success: false,
            error: 'Secret detected in review content.',
            reasonCode: 'SECRET_DETECTED',
            detectorCategory: afterSecret.detectorCategory
        };
    }

    const computedAfterSha = computeSha256(normalizedAfter);
    if (computedAfterSha !== draft.afterContentSha256) {
        // Terminal rejection: discard transient binding before event or response
        draft.status = 'rejected';
        transientManifestStore.delete(manifestKey);
        await appendPersonalTaskEvent(ownerId, draft.taskId, 'approval_contract_cancelled', {
            draftId: draft.draftId,
            action: 'patch_draft_rejected',
            reasonCode: 'CONTENT_HASH_MISMATCH'
        }, dbPool);
        return {
            success: false,
            error: 'Submitted proposed content does not match draft afterContent hash.',
            reasonCode: 'CONTENT_HASH_MISMATCH'
        };
    }

    // Re-read physical source file from disk using transient canonical target path
    const absolutePath = path.resolve(repoRoot, canonicalTargetPath);
    if (!fs.existsSync(absolutePath)) {
        draft.status = 'stale';
        transientManifestStore.delete(manifestKey);
        return { success: false, error: 'Target file no longer exists on disk.' };
    }
    const currentRawBefore = fs.readFileSync(absolutePath, 'utf8');
    const normalizedBefore = normalizeContent(currentRawBefore);

    const beforeSecret = scanForSecrets(normalizedBefore);
    if (beforeSecret.hasSecret) {
        // Terminal rejection: discard transient binding before event or response
        draft.status = 'rejected';
        transientManifestStore.delete(manifestKey);
        await appendPersonalTaskEvent(ownerId, draft.taskId, 'approval_contract_cancelled', {
            draftId: draft.draftId,
            action: 'patch_draft_rejected',
            reasonCode: 'SECRET_DETECTED'
        }, dbPool);
        return {
            success: false,
            error: 'Secret detected in target file content.',
            reasonCode: 'SECRET_DETECTED',
            detectorCategory: beforeSecret.detectorCategory
        };
    }

    const computedBeforeSha = computeSha256(normalizedBefore);
    if (computedBeforeSha !== draft.beforeContentSha256) {
        draft.status = 'stale';
        transientManifestStore.delete(manifestKey);
        return { success: false, error: 'Target file has changed on disk since draft was created (stale source).' };
    }

    // Recompute server-derived unified diff and diff hash
    const computedDiff = generateUnifiedDiff(canonicalTargetPath, normalizedBefore, normalizedAfter);
    const computedDiffSha = computeSha256(computedDiff);
    if (computedDiffSha !== draft.unifiedDiffSha256) {
        // Terminal rejection: discard transient binding before event or response
        draft.status = 'rejected';
        transientManifestStore.delete(manifestKey);
        await appendPersonalTaskEvent(ownerId, draft.taskId, 'approval_contract_cancelled', {
            draftId: draft.draftId,
            action: 'patch_draft_rejected',
            reasonCode: 'DIFF_HASH_MISMATCH'
        }, dbPool);
        return {
            success: false,
            error: 'Server-derived diff hash mismatch during review recomputation.',
            reasonCode: 'DIFF_HASH_MISMATCH'
        };
    }

    const reviewedAt = new Date().toISOString();

    // Construct Canonical Seal Payload (Opaque manifest & repo references; zero path/filename strings)
    const sealPayload = {
        afterContentSha256: draft.afterContentSha256,
        beforeContentSha256: draft.beforeContentSha256,
        contentStorageContractVersion: draft.contentStorageContractVersion,
        createdAt: draft.createdAt,
        draftId: draft.draftId,
        exactManifestId: draft.exactManifestId,
        exactManifestVersion: draft.exactManifestVersion,
        expiresAt: draft.expiresAt,
        hashAlgorithm: draft.hashAlgorithm,
        ownerId: draft.ownerId,
        policyVersion: draft.policyVersion,
        repositoryId: draft.repositoryId,
        reviewedAt,
        sealSchemaVersion: draft.sealSchemaVersion,
        taskId: draft.taskId,
        unifiedDiffSha256: draft.unifiedDiffSha256
    };

    const canonicalSerialization = canonicalJsonStringify(sealPayload);
    const sealedHash = computeSha256(canonicalSerialization);

    draft.status = 'reviewed';
    draft.reviewedAt = reviewedAt;
    draft.sealedHash = sealedHash;

    // Terminal transition: discard transient manifest mapping
    transientManifestStore.delete(manifestKey);

    // Record immutable review event in Task Ledger (REDACTED: NO targetPath or source hints)
    await appendPersonalTaskEvent(ownerId, draft.taskId, 'approval_contract_reviewed', {
        draftId: draft.draftId,
        action: 'patch_draft_reviewed',
        sealedHash,
        reviewedAt
    }, dbPool);

    return {
        success: true,
        draft: sanitizeDraftForPublicView(draft)
    };
}

/**
 * Cancels a patch draft permanently.
 * Clears transient manifest mapping immediately.
 */
export async function cancelPatchDraft(ownerId, draftId, { dbPool = null } = {}) {
    if (!ownerId || !draftId) {
        return { success: false, error: 'Owner ID and Draft ID are required.' };
    }

    const ownerDrafts = inMemoryDraftStore.get(String(ownerId));
    if (!ownerDrafts || !ownerDrafts.has(draftId)) {
        return { success: false, error: 'Patch draft not found or unauthorized.' };
    }

    const draft = ownerDrafts.get(draftId);

    // Clear transient manifest mapping on cancellation
    transientManifestStore.delete(getManifestKey(draft.repositoryId, draft.exactManifestId));

    if (draft.status === 'cancelled') {
        return { success: true, draft: sanitizeDraftForPublicView(draft), idempotent: true };
    }

    draft.status = 'cancelled';

    // Record immutable cancellation event in Task Ledger (REDACTED)
    await appendPersonalTaskEvent(ownerId, draft.taskId, 'approval_contract_cancelled', {
        draftId: draft.draftId,
        action: 'patch_draft_cancelled'
    }, dbPool);

    return {
        success: true,
        draft: sanitizeDraftForPublicView(draft)
    };
}

/**
 * Sanitizes a draft metadata object for owner inspection.
 * Contains only verification hashes, timestamps, versions, status, and opaque IDs.
 * Strictly NEVER returns target path, filename, line references, or raw content.
 */
function sanitizeDraftForPublicView(draft) {
    if (!draft) return null;
    return {
        draftId: draft.draftId,
        ownerId: draft.ownerId,
        taskId: draft.taskId,
        repositoryId: draft.repositoryId,
        exactManifestId: draft.exactManifestId,
        exactManifestVersion: draft.exactManifestVersion,
        beforeContentSha256: draft.beforeContentSha256,
        afterContentSha256: draft.afterContentSha256,
        unifiedDiffSha256: draft.unifiedDiffSha256,
        policyVersion: draft.policyVersion,
        contentStorageContractVersion: draft.contentStorageContractVersion,
        sealSchemaVersion: draft.sealSchemaVersion,
        canonicalizationVersion: draft.canonicalizationVersion,
        hashAlgorithm: draft.hashAlgorithm,
        createdAt: draft.createdAt,
        reviewedAt: draft.reviewedAt,
        expiresAt: draft.expiresAt,
        status: draft.status,
        sealedHash: draft.sealedHash,
        safetyBanner: draft.safetyBanner
    };
}
