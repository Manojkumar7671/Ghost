import { performance } from 'perf_hooks';
import { generateEmbedding, saveMemory, queryMemory } from './memory.js';
import { TurbovecIndex } from '@memwarden/turbovec';

console.log('===========================================================');
console.log('TRACK 3: TURBOVEC RAG SWAP BENCHMARK (100 DOCUMENTS)');
console.log('===========================================================');

const documents = Array.from({ length: 100 }, (_, i) => ({
    text: `Document #${i + 1}: Ghost AI platform subsystem memory entry covering autonomous task planning, vector embeddings, and telemetry item ${i * 17}.`,
    metadata: { docId: i + 1, category: i % 2 === 0 ? 'system' : 'user' }
}));

const queryText = 'autonomous task planning and vector embeddings';

// --- 1. JSON Vector Store Benchmark (BEFORE) ---
console.log('\n--- 1. Testing JSON Vector Store (Before Swap) ---');
const startJsonInsert = performance.now();
for (const doc of documents) {
    saveMemory(doc.text, doc.metadata);
}
const endJsonInsert = performance.now();
console.log(` -> 100 Docs Inserted in ${(endJsonInsert - startJsonInsert).toFixed(2)} ms`);

const startJsonQuery = performance.now();
const jsonResults = queryMemory(queryText, 3);
const endJsonQuery = performance.now();
const jsonDuration = (endJsonQuery - startJsonQuery).toFixed(3);
console.log(` -> Query Retrieval Time: ${jsonDuration} ms`);
console.log(` -> Top Match Score: ${jsonResults[0]?.score?.toFixed(4)} | Text: "${jsonResults[0]?.text?.slice(0, 60)}..."`);

// --- 2. Turbovec Rust SIMD Vector Index Benchmark (AFTER) ---
console.log('\n--- 2. Testing Turbovec Rust Index (After Swap) ---');
const turbovecIndex = new TurbovecIndex(384, 4);

const startTurboInsert = performance.now();
const allVectors = new Float32Array(documents.length * 384);
const allIds = new BigUint64Array(documents.length);

for (let i = 0; i < documents.length; i++) {
    const vec = generateEmbedding(documents[i].text);
    allVectors.set(vec, i * 384);
    allIds[i] = BigInt(i + 1);
}
turbovecIndex.addWithIds(allVectors, allIds);
const endTurboInsert = performance.now();
console.log(` -> 100 Docs Inserted (Batch SIMD) in ${(endTurboInsert - startTurboInsert).toFixed(2)} ms`);

const queryVec = new Float32Array(generateEmbedding(queryText));
const startTurboQuery = performance.now();
const hits = turbovecIndex.search(queryVec, 3);
const endTurboQuery = performance.now();
const turboDuration = (endTurboQuery - startTurboQuery).toFixed(3);
console.log(` -> Query Retrieval Time: ${turboDuration} ms`);
console.log(` -> Turbovec Index Length: ${turbovecIndex.len} entries`);
console.log(` -> Top Match ID: ${hits.ids[0]} | Top Score: ${hits.scores[0]?.toFixed(4)}`);

console.log('\n===========================================================');
console.log('TURBOVEC BENCHMARK TIMING SUMMARY');
console.log('===========================================================');
console.table([
    { Engine: 'JSON Vector Store (Before)', QueryTimeMs: `${jsonDuration} ms`, Status: 'Functional' },
    { Engine: 'Turbovec Rust Index (After)', QueryTimeMs: `${turboDuration} ms`, Status: 'SIMD Accelerated' }
]);
