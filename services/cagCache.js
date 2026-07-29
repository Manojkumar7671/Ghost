import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const STABLE_DOCS = [
  { name: 'ARCHITECTURE.md', path: path.join(process.cwd(), 'ARCHITECTURE.md') },
  { name: 'STATUS.md', path: path.join(process.cwd(), 'STATUS.md') },
  { name: 'PERSONALITY', path: path.join(process.cwd(), 'src/config/personality.js') },
  { name: 'PACKAGE.JSON', path: path.join(process.cwd(), 'package.json') }
];

const cacheMap = new Map();

/**
 * Compute SHA256 checksum for content invalidation check
 */
export function getChecksum(text) {
  if (!text) return '';
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
}

/**
 * Classify whether a request targets static/stable docs (CAG) vs dynamic memories (RAG)
 */
export function classifyKnowledgeSource(query) {
  if (!query || typeof query !== 'string') return 'RAG';
  const q = query.toLowerCase();
  const staticKeywords = [
    'architecture', 'status', 'system spec', 'personality', 'component matrix',
    'security gate', 'daemon', 'package', 'llm router', 'topology'
  ];
  if (staticKeywords.some(kw => q.includes(kw))) {
    return 'CAG';
  }
  return 'RAG';
}

/**
 * Preload or retrieve cached static system context with automatic mtime/checksum invalidation
 */
export function getCAGContext(filterName = null) {
  const chunks = [];
  let cacheHits = 0;
  let cacheMisses = 0;

  for (const doc of STABLE_DOCS) {
    if (filterName && !doc.name.toLowerCase().includes(filterName.toLowerCase())) {
      continue;
    }
    try {
      if (!fs.existsSync(doc.path)) continue;
      const stat = fs.statSync(doc.path);
      const mtimeMs = stat.mtimeMs;
      const cached = cacheMap.get(doc.name);

      if (cached && cached.mtimeMs === mtimeMs) {
        cacheHits++;
        chunks.push(`--- [CAG CACHED: ${doc.name} | hash: ${cached.hash}] ---\n${cached.content.slice(0, 1500)}`);
      } else {
        cacheMisses++;
        const content = fs.readFileSync(doc.path, 'utf-8');
        const hash = getChecksum(content);
        cacheMap.set(doc.name, { content, mtimeMs, hash });
        chunks.push(`--- [CAG REFRESHED: ${doc.name} | hash: ${hash}] ---\n${content.slice(0, 1500)}`);
      }
    } catch (err) {
      console.warn(`[CAG Cache] Failed to load ${doc.name}:`, err.message);
    }
  }

  console.log(`[CAG Path] Served static context (Hits: ${cacheHits}, Refreshed/Misses: ${cacheMisses})`);
  return chunks.join('\n\n');
}

/**
 * Get internal cache stats for diagnostics
 */
export function getCacheStats() {
  const entries = [];
  for (const [name, val] of cacheMap.entries()) {
    entries.push({ name, hash: val.hash, mtimeMs: val.mtimeMs, sizeBytes: val.content.length });
  }
  return entries;
}

export default {
  getCAGContext,
  classifyKnowledgeSource,
  getChecksum,
  getCacheStats,
  cacheMap
};
