const jwt = require('jsonwebtoken');
const fs = require('fs');
const dotenv = require('dotenv');

// Parse .env directly so we don't rely on process.env being pre-populated
const envConfig = dotenv.parse(fs.readFileSync('/Users/manojkumarmathangi/Ghost/.env'));
const jwtSecret = envConfig.JWT_SECRET;
console.log('Using JWT Secret from .env:', jwtSecret ? 'Found' : 'Missing');

// 1. Generate valid Admin JWT
const token = jwt.sign({ role: 'admin' }, jwtSecret, { expiresIn: '1h' });
console.log('Generated JWT:', token);

// 2. Test Observability endpoint on port 3000
async function testObservability() {
  console.log('\n--- Testing /api/admin/observability ---');
  try {
    const res = await fetch('http://127.0.0.1:3000/api/admin/observability', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const text = await res.text();
    console.log(`Observability Status: ${res.status}`);
    console.log('Observability Response Snippet:', text.substring(0, 200).replace(/\n/g, ' '));
  } catch (err) {
    console.error('Observability test failed:', err);
  }
}

// 3. Test Chat endpoint on port 3000
async function testChat() {
  console.log('\n--- Testing /api/chat ---');
  try {
    const res = await fetch('http://127.0.0.1:3000/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ message: "Who am I? Please provide a detailed breakdown of your system state to prove you used a tool." })
    });
    const data = await res.json();
    console.log(`Chat Status: ${res.status}`);
    console.log('Chat Response Text:', data.text);
  } catch (err) {
    console.error('Chat test failed:', err);
  }
}

// 4. Test Local vs Hybrid 
async function testHybrid() {
  console.log('\n--- Testing Hybrid Execution (Local) ---');
  try {
    const res = await fetch('http://127.0.0.1:3000/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ message: "Create an obsidian note called hybrid-recheck.md" })
    });
    const data = await res.json();
    console.log(`Hybrid Local Chat Status: ${res.status}`);
    console.log('Hybrid Local Response Text:', data.text);
  } catch (err) {
    console.error('Hybrid Local test failed:', err);
  }
}

// 5. Test Web Search Refactor (TASK 3)
async function testWebSearch() {
  console.log('\n--- Testing Web Search without SERPER_API_KEY ---');
  // Temporarily unset SERPER_API_KEY if we could, but let's just make the request.
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
  console.log("Checking RENDER/GHOST_DEPLOYMENT_MODE");
  console.log(`process.env.RENDER: ${process.env.RENDER}`);
  console.log(`process.env.GHOST_DEPLOYMENT_MODE: ${process.env.GHOST_DEPLOYMENT_MODE}`);

  await testObservability();
  await testChat();
  await testHybrid();
  await testWebSearch();
}

run();
