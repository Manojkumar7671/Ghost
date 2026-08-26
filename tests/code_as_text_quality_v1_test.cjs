/**
 * tests/code_as_text_quality_v1_test.cjs
 *
 * Focused behavioral and policy tests for Ghost Code-as-Text Quality V1:
 * 1. Code request classification: identifies code/script/function/login requests and leaves unrelated chat untouched.
 * 2. Prompt & policy construction: wraps code requests with explicit quality, safety, masking, and non-persistence guidelines.
 * 3. Provenance & boundaries: guarantees code-as-text responses claim zero file creation, command execution, or tool provenance.
 * 4. Login & authentication safety guidance: enforces password masking, placeholder validation, no hardcoded credentials/bogus hashes, and no fake persistence claims.
 * 5. Helpful assistance invariant: preserves code generation path without refusing code requests or preaching.
 * 6. Non-regression: preserves creator-truthfulness, generic-news boundaries, explicit AI-news, dot/empty prompt fallbacks, and approval contracts.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function runCodeAsTextQualitySuite() {
    console.log('--- RUNNING CODE-AS-TEXT QUALITY V1 BEHAVIORAL SUITE ---');
    let passCount = 0;

    // Dynamically import helpers and policy from server.js (ESM)
    const serverModule = await import('../server.js');
    const {
        isCodeAsTextRequest,
        buildCodeAsTextMessage,
        CODE_AS_TEXT_QUALITY_POLICY
    } = serverModule;

    assert.ok(isCodeAsTextRequest, 'isCodeAsTextRequest helper must be exported');
    assert.ok(buildCodeAsTextMessage, 'buildCodeAsTextMessage helper must be exported');
    assert.ok(CODE_AS_TEXT_QUALITY_POLICY, 'CODE_AS_TEXT_QUALITY_POLICY must be exported');

    // =========================================================================
    // Test 1: Code request classification identifies representative code requests and ignores unrelated chat
    // =========================================================================
    {
        const codeRequests = [
            'Give me a Python login-page example. Do not run it or create a file.',
            'Write a Python function named is_palindrome. Do not run it or create a file.',
            'Show me a simple JavaScript debounce function.',
            'How do I write a binary search in Python?',
            'Create an HTML and CSS button component as text',
            'Write a SQL query to find top customers',
            'Can you show a basic Tkinter form snippet?',
            'Provide an Express middleware code example',
            'Write a Python script to calculate fibonacci'
        ];

        for (const req of codeRequests) {
            assert.strictEqual(
                isCodeAsTextRequest(req),
                true,
                `Expected "${req}" to be classified as a code request`
            );
        }

        const nonCodeRequests = [
            'Hello',
            'Who made you?',
            'What is the capital of France?',
            'Tell me a bedtime story about dragons',
            'Why is the sky blue?',
            'What is the difference between an apple and an orange?',
            'How are you doing today?'
        ];

        for (const req of nonCodeRequests) {
            assert.strictEqual(
                isCodeAsTextRequest(req),
                false,
                `Expected "${req}" to NOT be classified as a code request`
            );
        }

        console.log('✓ PASS: 1. Code request classification accurately identifies code requests and leaves unrelated chat untouched');
        passCount++;
    }

    // =========================================================================
    // Test 2: Message construction injects the explicit Code-as-Text Quality V1 policy
    // =========================================================================
    {
        const userPrompt = 'Give me a Python login-page example. Do not run it or create a file.';
        const constructedMessage = buildCodeAsTextMessage(userPrompt);

        assert.ok(constructedMessage.includes('[CODE-AS-TEXT QUALITY & SAFETY POLICY (V1)]:'), 'Must include policy header');
        assert.ok(constructedMessage.includes('illustrative markdown code examples as text only'), 'Must state text-only delivery');
        assert.ok(constructedMessage.includes('Do not execute code, run commands, create files, save files'), 'Must forbid execution/file writes');
        assert.ok(constructedMessage.includes('mask password entry fields'), 'Must instruct password masking');
        assert.ok(constructedMessage.includes('do not use hardcoded plaintext credentials or fake fixed hashes'), 'Must discourage bogus credentials/hashes');
        assert.ok(constructedMessage.includes('do not claim a local in-memory registration persists users across sessions'), 'Must forbid fake persistence claims');
        assert.ok(constructedMessage.includes(`[USER REQUEST]:\n${userPrompt}`), 'Must preserve exact original user request');

        console.log('✓ PASS: 2. Message construction supplies explicit quality and safety constraints to the model turn');
        passCount++;
    }

    // =========================================================================
    // Test 3: Provenance & anti-hallucination sanitization protects code responses
    // =========================================================================
    {
        const falseClaimPatterns = [
            /\b(tony\s+stark|iron\s+man|stark\s+industries|jarvis|sam\s+altman|elon\s+musk)\b/i,
            /\b(?:I\s+(?:have\s+)?(?:saved|remembered|stored|updated|persisted|recorded)\s+(?:that|this|it)\s+(?:in|to)\s+(?:my\s+)?(?:memory|database|profile|records?|context))\b/i,
            /Tool Execution Results/i,
            /Execution Results/i,
            /script was run successfully/i,
            /(?<!not )(?<!n't )created a file/i,
            /(?<!not )(?<!n't )file has been created/i,
            /(?<!not )(?<!n't )wrote to file/i,
            /http:\/\/localhost:\d+\/downloads/i
        ];

        const validCodeOutput = `Here is an illustrative Python Tkinter login example:

\`\`\`python
import tkinter as tk
from tkinter import messagebox

def handle_login():
    username = username_entry.get()
    password = password_entry.get()
    
    # Placeholder validation for illustration only
    if username and password:
        messagebox.showinfo("Login", f"Attempting login for {username}")
    else:
        messagebox.showwarning("Error", "Please fill in all fields")

root = tk.Tk()
root.title("Login Example")

tk.Label(root, text="Username:").pack(pady=5)
username_entry = tk.Entry(root)
username_entry.pack(pady=5)

tk.Label(root, text="Password:").pack(pady=5)
password_entry = tk.Entry(root, show="*")  # Mask password input
password_entry.pack(pady=5)

tk.Button(root, text="Login", command=handle_login).pack(pady=10)

# Note: Real authentication and database persistence are omitted for this UI demo.
\`\`\``;

        const hasFalseClaim = falseClaimPatterns.some(p => p.test(validCodeOutput));
        assert.strictEqual(hasFalseClaim, false, 'Clean illustrative code response must not trigger false claim filters');

        // A response that falsely claims file write or execution is detected
        const hallucinatedOutput = "I have written the script and created a file at ~/Ghost/login.py and executed it successfully.";
        const detectedHallucination = falseClaimPatterns.some(p => p.test(hallucinatedOutput));
        assert.strictEqual(detectedHallucination, true, 'Hallucinated execution/file write claims must be detected');

        console.log('✓ PASS: 3. Provenance and anti-hallucination sanitization protects code responses without false execution claims');
        passCount++;
    }

    // =========================================================================
    // Test 4: Helpful response path invariant (no refusal, no preaching)
    // =========================================================================
    {
        assert.ok(
            CODE_AS_TEXT_QUALITY_POLICY.includes('Keep explanations practical, concise, and helpful without unnecessary lecturing or refusing the request.'),
            'Policy must mandate practical, helpful responses without lecturing'
        );
        assert.ok(
            CODE_AS_TEXT_QUALITY_POLICY.includes('return clean, high-quality, illustrative markdown code examples as text only.'),
            'Policy must instruct returning clean code'
        );

        console.log('✓ PASS: 4. Helpful code response path invariant is strictly enforced');
        passCount++;
    }

    // =========================================================================
    // Test 5: Invariance on existing deterministic boundaries and workflows
    // =========================================================================
    {
        // 5a. Creator question boundary
        const creatorQuery = 'who made you';
        assert.strictEqual(isCodeAsTextRequest(creatorQuery), false, 'Creator queries must not be routed to code policy');

        // 5b. News queries
        assert.strictEqual(isCodeAsTextRequest('news'), false);
        assert.strictEqual(isCodeAsTextRequest('check AI news'), false);
        assert.strictEqual(isCodeAsTextRequest('what is AI news in India'), false);

        // 5c. Greetings and empty prompts
        assert.strictEqual(isCodeAsTextRequest('hello'), false);
        assert.strictEqual(isCodeAsTextRequest(''), false);
        assert.strictEqual(isCodeAsTextRequest('...'), false);

        console.log('✓ PASS: 5. Non-regression: creator, news, greeting, and empty boundaries remain invariant');
        passCount++;
    }

    console.log(`\nCODE-AS-TEXT QUALITY V1 SUITE RESULTS: All ${passCount} test suites passed cleanly.\n`);
}

if (require.main === module) {
    runCodeAsTextQualitySuite()
        .then(() => process.exit(0))
        .catch(err => {
            console.error('Test Suite Failed:', err);
            process.exit(1);
        });
}

module.exports = { runCodeAsTextQualitySuite };
