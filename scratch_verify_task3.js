import webAgent from './src/agents/webAgent.js';

async function run() {
  console.log("=== WEB SEARCH TEST (NO SERPER) ===");
  const res = await webAgent.searchWeb("Apple stock price");
  console.log(res);
}
run();
