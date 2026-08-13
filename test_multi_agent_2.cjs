const jwt = require('jsonwebtoken');
const fs = require('fs');
const dotenv = require('dotenv');

const envConfig = dotenv.parse(fs.readFileSync('/Users/manojkumarmathangi/Ghost/.env'));
const jwtSecret = envConfig.JWT_SECRET;
const token = jwt.sign({ role: 'admin' }, jwtSecret, { expiresIn: '1h' });

async function runMultiAgentTest() {
  console.log('\n--- Testing Multi-Agent Workflow ---');
  try {
    const res = await fetch('http://127.0.0.1:3000/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ 
        message: "Ghost, search the web for the latest updates on generative AI and append a summary to the note named Tech_News.md in Obsidian" 
      })
    });
    
    const data = await res.json();
    console.log(`Status: ${res.status}`);
    console.log('Ghost Response:\n', data.text);
  } catch (err) {
    console.error('Test failed:', err);
  }
}

runMultiAgentTest();
