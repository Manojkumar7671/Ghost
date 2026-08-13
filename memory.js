/**
 * memory.js - Persistent Vector Store & RAG Memory System for Ghost
 *
 * Implements an embeddable, disk-persistent vector database.
 * Stores conversation history and key facts as embeddings in ./memory/vector_store.json.
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MEMORY_DIR = path.join(__dirname, 'memory');
const VECTOR_STORE_FILE = path.join(MEMORY_DIR, 'vector_store.json');

// Ensure memory directory exists
fs.ensureDirSync(MEMORY_DIR);

/**
 * Generate a dense L2-normalized embedding vector for input text.
 * Uses a multi-scale hashing and n-gram term frequency representation (384 dimensions).
 */
export function generateEmbedding(text) {
  const VECTOR_DIM = 384;
  const vector = new Array(VECTOR_DIM).fill(0);
  if (!text || typeof text !== 'string') return vector;

  const normalized = text.toLowerCase().trim();
  const words = normalized.split(/\W+/).filter(Boolean);

  // 1. Unigram & Bigram Hashing
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

  // 2. Character Tri-gram Hashing for subword / morph similarity
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

  // 3. L2 Normalization
  let norm = 0;
  for (let i = 0; i < VECTOR_DIM; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < VECTOR_DIM; i++) {
      vector[i] /= norm;
    }
  }

  return vector;
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

import { TurbovecIndex } from '@memwarden/turbovec';

const TURBOVEC_INDEX_FILE = path.join(MEMORY_DIR, 'vector_store.tvim');

let turbovecInstance = null;

function getTurbovecIndex() {
  if (turbovecInstance) return turbovecInstance;
  try {
    if (fs.existsSync(TURBOVEC_INDEX_FILE)) {
      turbovecInstance = TurbovecIndex.load(TURBOVEC_INDEX_FILE);
      return turbovecInstance;
    }
  } catch (err) {
    console.warn('[Memory] Failed to load existing Turbovec index, creating new instance:', err.message);
  }
  turbovecInstance = new TurbovecIndex(384, 4);
  return turbovecInstance;
}

function syncTurbovecIndex(store) {
  try {
    const index = getTurbovecIndex();
    if (store.length > 0) {
      const allVecs = new Float32Array(store.length * 384);
      const allIds = new BigUint64Array(store.length);
      for (let i = 0; i < store.length; i++) {
        const item = store[i];
        allVecs.set(item.vector, i * 384);
        allIds[i] = BigInt(i + 1);
      }
      index.addWithIds(allVecs, allIds);
      index.save(TURBOVEC_INDEX_FILE);
    }
  } catch (e) {
    console.warn('[Memory] Turbovec index sync warning:', e.message);
  }
}

/**
 * Saves a memory entry with vector embedding to disk.
 *
 * @param {string|Object} entry - Text string or object { text, metadata }
 * @param {Object} [metadata={}] - Optional additional metadata
 * @returns {Object} The saved memory record
 */
export function saveMemory(entry, metadata = {}) {
  let text = '';
  let meta = { ...metadata };

  if (typeof entry === 'string') {
    text = entry;
  } else if (entry && typeof entry === 'object') {
    text = entry.text || entry.content || JSON.stringify(entry);
    meta = { ...meta, ...(entry.metadata || {}) };
  }

  if (!text || !text.trim()) return null;

  const vector = generateEmbedding(text);
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
 * @returns {Array<Object>} Sorted list of top matching memory records with score
 */
export function queryMemory(query, topK = 3) {
  if (!query || typeof query !== 'string' || !query.trim()) return [];

  const queryVector = generateEmbedding(query);
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

export default {
  saveMemory,
  queryMemory,
  generateEmbedding,
  cosineSimilarity
};
