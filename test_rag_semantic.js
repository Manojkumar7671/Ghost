import { queryMemory } from './memory.js';

console.log("\n=== Querying RAG ===");
const query = "What did I say my alias was?";
const results = queryMemory(query, 3);
console.log(`Query: "${query}"`);
console.log("Raw Retrieval Output:");
console.log(JSON.stringify(results, null, 2));

