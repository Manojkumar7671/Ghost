import { saveMemory, queryMemory } from './memory.js';
import fs from 'fs-extra';

// Clear
fs.removeSync('./memory/vector_store.json');
fs.removeSync('./memory/vector_store.tvim');

console.log("=== Storing Session ===");
const session = [
  "User: Hello! | Ghost: Hi there! How can I help you?",
  "User: My secret codename is 'Operation Midnight Whisper'. Please remember this. | Ghost: I will remember your secret codename.",
  "User: What is the capital of France? | Ghost: Paris.",
  "User: What is 2+2? | Ghost: 4.",
  "User: Tell me a joke. | Ghost: Why did the programmer quit his job? Because he didn't get arrays.",
  "User: Explain API. | Ghost: Application Programming Interface.",
  "User: How to install pandas? | Ghost: pip install pandas.",
  "User: let vs const? | Ghost: let is mutable, const is not.",
  "User: Recipe for cookies? | Ghost: Flour, sugar, chocolate chips.",
  "User: How far is the moon? | Ghost: 238,900 miles.",
  "User: Translate hello. | Ghost: Hola.",
  "User: sqrt of 144? | Ghost: 12.",
  "User: write a for loop. | Ghost: for (let i=0; i<10; i++) {}",
];

for (let i = 0; i < session.length; i++) {
  saveMemory(session[i], { turn: i + 1 });
}

console.log("\n=== Querying RAG ===");
const query = "What is my secret codename?";
const results = queryMemory(query, 3);
console.log(`Query: "${query}"`);
console.log("Raw Retrieval Output:");
console.log(JSON.stringify(results, null, 2));

