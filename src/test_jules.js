require('dotenv').config();
const JulesAgent = require('./agents/julesAgent');

async function test() {
  console.log("Testing Jules Agent directly...");
  
  const julesAgent = new JulesAgent();
  
  try {
    const result = await julesAgent.run("Please write a simple fix for the typo in README.md", "", "Manojkumar7671", "TestRepo");
    console.log("Result:", result);
  } catch (e) {
    console.error("Test failed:", e);
  }
}

test();

