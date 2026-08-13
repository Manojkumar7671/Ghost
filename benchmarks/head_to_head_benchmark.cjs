const fs = require('fs');
const path = require('path');
const { chat } = require('../src/tools/llm.js');

const prompts = [
    // Coding
    "Write a python script that implements a concurrent web crawler using asyncio and aiohttp.",
    "Explain how React's virtual DOM works internally, and why it's considered faster than direct DOM manipulation.",
    "Write a bash script that finds all files larger than 50MB in a directory, sorts them by size, and archives them.",
    "Given a binary tree, write a function in Go to find the maximum path sum between any two nodes.",
    "How do you fix a memory leak in a Node.js Express application? Give concrete debugging steps.",
    
    // Reasoning / Logic
    "I have a 3-liter jug and a 5-liter jug. How can I measure exactly 4 liters of water? Explain step-by-step.",
    "If a train leaves New York at 60mph and another leaves Chicago at 80mph, heading towards each other, which one is closer to New York when they meet?",
    "A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost?",
    "You have 9 identical-looking balls, but one is slightly heavier. You have a balance scale. How can you find the heavier ball in exactly two weighings?",
    "If all blips are blops, and some blops are bloops, are any blips bloops? Explain the logic.",

    // Writing / Factual Recall
    "Write a short, professional email to a client apologizing for a software outage and explaining the mitigation steps.",
    "Summarize the plot of the movie 'Inception' in exactly three sentences.",
    "Explain quantum entanglement to a 10-year-old.",
    "What are the primary differences between SQL and NoSQL databases, and when should you choose one over the other?",
    "Write a creative haiku about a software bug that refuses to be squashed."
];

async function runHeadToHead() {
    console.log(`Starting Head-to-Head Benchmark on ${prompts.length} prompts...`);
    const results = [];
    
    let i = 0;
    for (const prompt of prompts) {
        i++;
        console.log(`\n[${i}/${prompts.length}] Querying Ghost LLM...`);
        console.log(`Prompt: "${prompt.slice(0, 50)}..."`);
        
        try {
            const start = Date.now();
            const response = await chat([{ role: 'user', content: prompt }]);
            const duration = Date.now() - start;
            
            results.push({
                prompt,
                response,
                durationMs: duration
            });
            console.log(`  -> Received response in ${duration}ms`);
        } catch (e) {
            console.log(`  -> Error: ${e.message}`);
            results.push({
                prompt,
                error: e.message
            });
        }
    }

    fs.writeFileSync(path.join(__dirname, 'headtohead_prompts.json'), JSON.stringify(results, null, 2));
    console.log(`\nHead-to-Head Benchmark Complete. Results saved to headtohead_prompts.json.`);
}

runHeadToHead().catch(console.error);
