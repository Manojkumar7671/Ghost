const jwt = require('jsonwebtoken');
const fs = require('fs');
const dotenv = require('dotenv');

// Parse .env directly
const envConfig = dotenv.parse(fs.readFileSync('/Users/manojkumarmathangi/Ghost/.env'));
const jwtSecret = envConfig.JWT_SECRET;
const token = jwt.sign({ role: 'admin' }, jwtSecret, { expiresIn: '1h' });

// 1. Test Delegate task
async function testDelegate() {
  console.log('\n--- Testing Delegate Execution (Render) ---');
  try {
    const res = await fetch('http://127.0.0.1:3000/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ message: "Check the weather in Tokyo. (This should delegate to Render)" })
    });
    const data = await res.json();
    console.log(`Delegate Chat Status: ${res.status}`);
    console.log('Delegate Response Text:', data.text);
  } catch (err) {
    console.error('Delegate test failed:', err);
  }
}

// 2. Test Web Search
async function testWebSearch() {
  console.log('\n--- Testing Web Search without SERPER_API_KEY ---');
  try {
    const res = await fetch('http://127.0.0.1:3000/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ message: "Search the web for the latest news about Antigravity AI." })
    });
    const data = await res.json();
    console.log(`Web Search Chat Status: ${res.status}`);
    console.log('Web Search Response Text:', data.text);
  } catch (err) {
    console.error('Web Search test failed:', err);
  }
}

async function run() {
  await testDelegate();
  await testWebSearch();
}

run();
