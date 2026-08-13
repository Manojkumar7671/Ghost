require('dotenv').config();
const { AiderAgent } = require('../src/agents/aiderAgent');
const { saveApprovedRepo } = require('../services/repoApproval');
(async () => {
    // 1. Pre-approve repo so it doesn't block
    saveApprovedRepo('octocat/Hello-World');
    
    console.log("Starting AiderAgent test...");
    
    // 2. Initialize Agent
    const mockRequest = {
        requestId: 'test-req-' + Date.now(),
        repoName: 'octocat/Hello-World',
        issueTitle: 'Add a generic greeting comment',
        issueBody: 'Please add a generic greeting comment to README.md to test the Aider agent execution.',
    };
    const agent = new AiderAgent({ requestId: mockRequest.requestId });
    
    // 3. Run
    const result = await agent.run(mockRequest.issueBody, mockRequest.issueTitle, 'octocat', 'Hello-World');
    
    console.log("Agent return value (immediate):", result);
    console.log("Waiting for background task to complete...");
    
    // The agent is running in background, we need to let the process stay alive or await it
    // Because _executeAiderTask is async but not awaited in run(), we will just wait 60 seconds
    await new Promise(r => setTimeout(r, 45000));
    
    console.log("Check chatHistory output manually (or it printed to console if hooked).");
})();
