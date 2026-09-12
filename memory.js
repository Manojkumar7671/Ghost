/**
 * memory.js - Persistent Vector Store & Semantic RAG Memory System for Ghost
 *
 * Uses local, ONNX-based sentence transformers (Xenova/all-MiniLM-L6-v2 via @huggingface/transformers)
 * to produce real 384-dimensional dense semantic embeddings.
 * Supports fast vector search with @memwarden/turbovec and disk persistence in ./memory/vector_store.json.
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { pipeline } from '@huggingface/transformers';
import { TurbovecIndex } from '@memwarden/turbovec';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MEMORY_DIR = path.join(__dirname, 'memory');
const VECTOR_STORE_FILE = path.join(MEMORY_DIR, 'vector_store.json');
const TURBOVEC_INDEX_FILE = path.join(MEMORY_DIR, 'vector_store.tvim');
const EMBEDDING_MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const VECTOR_DIM = 384;

// Ensure memory directory exists
fs.ensureDirSync(MEMORY_DIR);

let embedderPromise = null;

/**
 * Lazy singleton for the local transformer feature-extraction pipeline.
 */
async function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = pipeline('feature-extraction', EMBEDDING_MODEL_NAME, {
      dtype: 'fp32'
    });
  }
  return embedderPromise;
}

/**
 * Fallback n-gram hash vector generator (used only if model fails to load).
 */
function generateHashEmbedding(text) {
  const vector = new Array(VECTOR_DIM).fill(0);
  if (!text || typeof text !== 'string') return vector;

  const normalized = text.toLowerCase().trim();
  const words = normalized.split(/\W+/).filter(Boolean);

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    let hash = 0;
    for (let c = 0; c < word.length; c++) {
      hash = ((hash << 5) - hash) + word.charCodeAt(c);
      hash |= 0;
    }
    const index = Math.abs(hash) % VECTOR_DIM;
    vector[index] += 1.0;

    if (i < words.length - 1) {
      const bigram = word + '_' + words[i + 1];
      let biHash = 0;
      for (let c = 0; c < bigram.length; c++) {
        biHash = ((biHash << 5) - biHash) + bigram.charCodeAt(c);
        biHash |= 0;
      }
      const biIdx = Math.abs(biHash) % VECTOR_DIM;
      vector[biIdx] += 0.75;
    }
  }

  for (let i = 0; i < normalized.length - 2; i++) {
    const trigram = normalized.substring(i, i + 3);
    let triHash = 0;
    for (let c = 0; c < trigram.length; c++) {
      triHash = ((triHash << 5) - triHash) + trigram.charCodeAt(c);
      triHash |= 0;
    }
    const triIdx = Math.abs(triHash) % VECTOR_DIM;
    vector[triIdx] += 0.25;
  }

  let norm = 0;
  for (let i = 0; i < VECTOR_DIM; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < VECTOR_DIM; i++) vector[i] /= norm;
  }
  return vector;
}

/**
 * Generate a real dense L2-normalized 384-dimensional embedding vector for input text
 * using the local sentence transformer model.
 *
 * @param {string} text - Input text to embed
 * @returns {Promise<Array<number>>} 384-dimensional dense vector
 */
export async function generateEmbedding(text) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    return new Array(VECTOR_DIM).fill(0);
  }

  try {
    const embedder = await getEmbedder();
    const output = await embedder(text.trim(), { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  } catch (err) {
    console.warn(`[Memory] Transformer embedding failed, using hash fallback: ${err.message}`);
    return generateHashEmbedding(text);
  }
}

/**
 * Computes Cosine Similarity between two L2-normalized vectors.
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
  }
  return dot;
}

/**
 * Load vector store entries from disk.
 */
function loadVectorStore() {
  try {
    if (fs.existsSync(VECTOR_STORE_FILE)) {
      return fs.readJsonSync(VECTOR_STORE_FILE);
    }
  } catch (err) {
    console.error('[Memory] Error loading vector store:', err.message);
  }
  return [];
}

/**
 * Save vector store entries to disk.
 */
function saveVectorStore(entries) {
  try {
    fs.writeJsonSync(VECTOR_STORE_FILE, entries, { spaces: 2 });
  } catch (err) {
    console.error('[Memory] Error saving vector store:', err.message);
  }
}

let turbovecInstance = null;

function getTurbovecIndex() {
  if (!fs.existsSync(TURBOVEC_INDEX_FILE)) {
    turbovecInstance = null;
  }
  if (turbovecInstance) return turbovecInstance;
  try {
    if (fs.existsSync(TURBOVEC_INDEX_FILE)) {
      turbovecInstance = TurbovecIndex.load(TURBOVEC_INDEX_FILE);
      return turbovecInstance;
    }
  } catch (err) {
    console.warn('[Memory] Failed to load existing Turbovec index, creating new instance:', err.message);
  }
  turbovecInstance = new TurbovecIndex(VECTOR_DIM, 4);
  return turbovecInstance;
}

function syncTurbovecIndex(store) {
  try {
    if (!fs.existsSync(TURBOVEC_INDEX_FILE)) {
      turbovecInstance = null;
    }
    let index = getTurbovecIndex();
    if (index && index.len === store.length - 1) {
      const item = store[store.length - 1];
      const vec = new Float32Array(item.vector);
      const id = new BigUint64Array([BigInt(store.length)]);
      index.addWithIds(vec, id);
      index.save(TURBOVEC_INDEX_FILE);
      return;
    }

    // Otherwise, rebuild the whole index
    index = new TurbovecIndex(VECTOR_DIM, 4);
    if (store.length > 0) {
      const allVecs = new Float32Array(store.length * VECTOR_DIM);
      const allIds = new BigUint64Array(store.length);
      for (let i = 0; i < store.length; i++) {
        const item = store[i];
        allVecs.set(item.vector, i * VECTOR_DIM);
        allIds[i] = BigInt(i + 1);
      }
      index.addWithIds(allVecs, allIds);
      index.save(TURBOVEC_INDEX_FILE);
      turbovecInstance = index;
    }
  } catch (err) {
    console.warn('[Memory] Failed to sync Turbovec index:', err.message);
  }
}

/**
 * Saves a memory entry with vector embedding to disk.
 *
 * @param {string|Object} entry - Text string or object { text, metadata }
 * @param {Object} [metadata={}] - Optional additional metadata
 * @returns {Promise<Object>} The saved memory record
 */
export async function saveMemory(entry, metadata = {}) {
  let text = '';
  let meta = { ...metadata };

  if (typeof entry === 'string') {
    text = entry;
  } else if (entry && typeof entry === 'object') {
    text = entry.text || entry.content || JSON.stringify(entry);
    meta = { ...meta, ...(entry.metadata || {}) };
  }

  if (!text || !text.trim()) return null;

  const vector = await generateEmbedding(text);
  meta.embeddingModel = EMBEDDING_MODEL_NAME;

  const record = {
    id: uuidv4(),
    text: text.trim(),
    vector,
    metadata: meta,
    createdAt: new Date().toISOString()
  };

  const store = loadVectorStore();
  store.push(record);
  saveVectorStore(store);
  syncTurbovecIndex(store);

  console.log(`[Memory] Saved memory entry (id: ${record.id.slice(0, 8)})`);
  return record;
}

/**
 * Queries past memories relevant to a given query string using vector similarity.
 *
 * @param {string} query - Query text to search against stored memories
 * @param {number} [topK=3] - Maximum number of relevant memories to return
 * @returns {Promise<Array<Object>>} Sorted list of top matching memory records with score
 */
export async function queryMemory(query, topK = 3) {
  if (!query || typeof query !== 'string' || !query.trim()) return [];

  const queryVector = await generateEmbedding(query);
  const store = loadVectorStore();

  if (store.length === 0) return [];

  try {
    const index = getTurbovecIndex();
    if (index && index.len > 0) {
      const hits = index.search(new Float32Array(queryVector), topK);
      const results = [];
      for (let i = 0; i < hits.ids.length; i++) {
        const docIdx = Number(hits.ids[i]) - 1;
        if (store[docIdx]) {
          results.push({
            id: store[docIdx].id,
            text: store[docIdx].text,
            metadata: store[docIdx].metadata,
            createdAt: store[docIdx].createdAt,
            score: hits.scores[i]
          });
        }
      }
      if (results.length > 0) return results;
    }
  } catch (err) {
    console.warn('[Memory] Turbovec query fallback to cosine Similarity:', err.message);
  }

  const scored = store.map(item => ({
    id: item.id,
    text: item.text,
    metadata: item.metadata,
    createdAt: item.createdAt,
    score: cosineSimilarity(queryVector, item.vector)
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).filter(item => item.score > 0.05);
}

/**
 * Re-indexes all memories in vector_store.json to use the current embedding model.
 * Migrates old n-gram hash vectors to real transformer embeddings.
 *
 * @returns {Promise<{ migrated: number, total: number }>}
 */
export async function reindexVectorStore() {
  const store = loadVectorStore();
  if (store.length === 0) return { migrated: 0, total: 0 };

  console.log(`[Memory] Starting re-indexing of ${store.length} memory entries...`);
  let migrated = 0;

  for (let i = 0; i < store.length; i++) {
    const item = store[i];
    if (item.metadata?.embeddingModel !== EMBEDDING_MODEL_NAME || !item.vector || item.vector.length !== VECTOR_DIM) {
      item.vector = await generateEmbedding(item.text);
      item.metadata = { ...(item.metadata || {}), embeddingModel: EMBEDDING_MODEL_NAME };
      migrated++;
    }
  }

  if (migrated > 0) {
    saveVectorStore(store);
    syncTurbovecIndex(store);
    console.log(`[Memory] Re-indexing complete: ${migrated} entries updated to ${EMBEDDING_MODEL_NAME}.`);
  } else {
    console.log(`[Memory] All entries already up-to-date with ${EMBEDDING_MODEL_NAME}.`);
  }

  return { migrated, total: store.length };
}

export default {
  saveMemory,
  queryMemory,
  generateEmbedding,
  cosineSimilarity,
  reindexVectorStore
};
