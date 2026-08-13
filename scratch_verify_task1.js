import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

const secret = process.env.JWT_SECRET || 'test_secret';
const token = jwt.sign({ isAdmin: true, username: 'Master Manoj', role: 'admin' }, secret);

async function run() {
  console.log("=== ENV CHECK ===");
  console.log(`RENDER: ${process.env.RENDER || 'undefined'}`);
  console.log(`GHOST_DEPLOYMENT_MODE: ${process.env.GHOST_DEPLOYMENT_MODE || 'undefined'}`);
  
  console.log("\n=== /api/admin/observability ===");
  try {
    const obs = await fetch('http://127.0.0.1:3000/api/admin/observability', {
      headers: { 'Cookie': `ghost_session=${token}` }
    });
    console.log(`Status: ${obs.status}`);
    console.log(await obs.text());
  } catch (e) { console.log(e.message); }
  
  console.log("\n=== /api/chat ===");
  try {
    const chat = await fetch('http://127.0.0.1:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': `ghost_session=${token}` },
      body: JSON.stringify({ message: "Hello Ghost. Can you greet me and tell me my name exactly as instructed by your system prompt?" })
    });
    const chatRes = await chat.json();
    console.log(chatRes.response || chatRes);
  } catch(e) { console.log(e.message); }
}
run();
