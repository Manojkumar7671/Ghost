import { think } from './src/brain.js';
import memoryTools from './src/tools/memory.js';
const { clearHistory } = memoryTools;
import fs from 'fs-extra';

async function run() {
  // Clear memory
  fs.removeSync('./memory/vector_store.json');
  fs.removeSync('./memory/vector_store.tvim');
  clearHistory('testuser');

  const turns = [
    "Hello! I am a new user.",
    "My secret codename is 'Operation Midnight Whisper'. Please remember this.",
    "Can you write a python script to print hello world?",
    "What is the capital of France?",
    "What is 2 + 2?",
    "Tell me a joke about a programmer.",
    "Can you explain what an API is?",
    "How do I install pandas in Python?",
    "What is the difference between let and const in JS?",
    "Give me a recipe for chocolate chip cookies.",
    "How far is the moon from the Earth?",
    "Translate 'hello' to Spanish.",
    "What is the square root of 144?",
    "Can you write a for loop in Java?",
    "What is my secret codename?"
  ];

  for (let i = 0; i < turns.length; i++) {
    console.log(`\n=== Turn ${i+1} ===`);
    console.log(`User: ${turns[i]}`);
    const res = await think(turns[i], { isAdmin: false, sessionUser: 'testuser' });
    console.log(`Ghost: ${res.reply}`);
  }
}
run().catch(console.error);
