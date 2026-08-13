const obsidianAgent = require('./src/agents/obsidianAgent.js');
const dotenv = require('dotenv');
dotenv.config();

async function testObsidian() {
    console.log('--- Testing Obsidian Fallback ---');
    try {
        const result = await obsidianAgent.createNote('TestNote.md', 'Hello this is a test note from Ghost!');
        console.log('Result:', result);
        
        const readResult = await obsidianAgent.readNote('TestNote.md');
        console.log('Read Result:', readResult);
    } catch (e) {
        console.error('Error:', e);
    }
}

testObsidian();
