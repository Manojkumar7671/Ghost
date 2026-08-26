/**
 * tests/plain_language_router_test.cjs
 *
 * Focused offline CommonJS static and logic test for Ghost Plain-Language News Router V0.
 *
 * Verifies:
 * 1. Exact named ESM export (`classifyPlainLanguageIntent`), with no external network/model/process calls.
 * 2. New positive natural current-news and academic-dossier forms route correctly.
 * 3. Existing accepted natural-news phrases and generic-news clarification shapes are preserved.
 * 4. Narrow fallthrough returns null for conceptual/historic questions, normal chat, bare/ambiguous inputs, and URLs.
 * 5. Safety filters return null for control characters, credentials, offensive cyber patterns, and local/browser actions.
 * 6. No accidental broadening: empty topics or trailing whitespace-only topics do not route.
 */

const assert = require('assert');

async function runTests() {
  const routerModule = await import('../services/plainLanguageRouter.js');
  const { classifyPlainLanguageIntent } = routerModule;

  assert(typeof classifyPlainLanguageIntent === 'function', 'classifyPlainLanguageIntent must be an exported function');

  // ==========================================
  // 1. New Positive News Forms (Pattern 1c)
  // ==========================================
  const positiveNewsCases = [
    {
      input: 'What is the latest news about space exploration?',
      expectedTopic: 'space exploration'
    },
    {
      input: "what's the latest news on quantum computing",
      expectedTopic: 'quantum computing'
    },
    {
      input: 'WHAT IS THE LATEST NEWS ABOUT ARTIFICIAL INTELLIGENCE???',
      expectedTopic: 'ARTIFICIAL INTELLIGENCE'
    },
    {
      input: "  What's the latest news about fusion energy!  ",
      expectedTopic: 'fusion energy'
    },
    {
      input: 'What is the latest news on Mars rover mission.',
      expectedTopic: 'Mars rover mission'
    },
    {
      input: 'what is the latest news about renewable tech??!',
      expectedTopic: 'renewable tech'
    }
  ];

  for (const { input, expectedTopic } of positiveNewsCases) {
    const result = classifyPlainLanguageIntent(input);
    assert(result !== null, `Expected route result for: "${input}"`);
    assert.strictEqual(result.type, 'route', `Expected type 'route' for: "${input}"`);
    assert.strictEqual(result.route, 'research', `Expected route 'research' for: "${input}"`);
    assert.strictEqual(result.topic, expectedTopic, `Expected topic "${expectedTopic}" for: "${input}"`);
  }

  // ==========================================
  // 2. Positive V0 Academic Dossier Forms (Pattern 2b)
  // ==========================================
  const positiveDossierCases = [
    {
      input: 'Give me an academic research dossier on quantum computing',
      expectedTopic: 'quantum computing'
    },
    {
      input: 'Academic research dossier about fusion energy',
      expectedTopic: 'fusion energy'
    },
    {
      input: 'research dossier for climate adaptation',
      expectedTopic: 'climate adaptation'
    },
    {
      input: '  GIVE ME AN ACADEMIC RESEARCH DOSSIER FOR CRISPR-CAS9???  ',
      expectedTopic: 'CRISPR-CAS9'
    },
    {
      input: 'academic research dossier on machine learning models.',
      expectedTopic: 'machine learning models'
    },
    {
      input: 'Research dossier about room temperature superconductors!',
      expectedTopic: 'room temperature superconductors'
    }
  ];

  for (const { input, expectedTopic } of positiveDossierCases) {
    const result = classifyPlainLanguageIntent(input);
    assert(result !== null, `Expected dossier route result for: "${input}"`);
    assert.strictEqual(result.type, 'route', `Expected type 'route' for: "${input}"`);
    assert.strictEqual(result.route, 'dossier', `Expected route 'dossier' for: "${input}"`);
    assert.strictEqual(result.topic, expectedTopic, `Expected topic "${expectedTopic}" for: "${input}"`);
  }

  // ==========================================
  // 3. Existing Behavior Preserved
  // ==========================================
  // Existing positive news pattern (Pattern 1a & Pattern 1b)
  const existingNewsResult = classifyPlainLanguageIntent('What is the latest biotech news?');
  assert.deepStrictEqual(existingNewsResult, {
    type: 'route',
    route: 'research',
    topic: 'biotech'
  }, 'Existing Pattern 1a must be preserved');

  const existingNewsResult2 = classifyPlainLanguageIntent('Find current news about cybersecurity');
  assert.deepStrictEqual(existingNewsResult2, {
    type: 'route',
    route: 'research',
    topic: 'cybersecurity'
  }, 'Existing Pattern 1b must be preserved');

  // Existing clarification pattern
  const clarificationResult = classifyPlainLanguageIntent('What is the latest news?');
  assert.deepStrictEqual(clarificationResult, {
    type: 'clarification',
    route: 'research',
    text: 'What topic do you want current news about?'
  }, 'Existing empty news query clarification must be preserved');

  // Existing dossier pattern preserved (Pattern 2a)
  const dossierResult = classifyPlainLanguageIntent('Give me scholarly sources on CRISPR');
  assert.deepStrictEqual(dossierResult, {
    type: 'route',
    route: 'dossier',
    topic: 'CRISPR'
  }, 'Existing dossier intent must be preserved');

  // Existing empty scholarly clarification preserved
  const emptyDossierClarification = classifyPlainLanguageIntent('find scholarly sources');
  assert.deepStrictEqual(emptyDossierClarification, {
    type: 'clarification',
    route: 'dossier',
    text: 'What topic should I make a bounded scholarly-source overview for?'
  }, 'Existing empty scholarly clarification must be preserved');

  // ==========================================
  // 4. Narrow Fallthrough (Returns null)
  // ==========================================
  const fallthroughCases = [
    'How does quantum entanglement work conceptually?',
    'Who was the first president of the United States?',
    'Hello Ghost, how are you today?',
    'Can you help me write a Python script for sorting?',
    'What do you think about the future of humanity?',
    'https://example.com/news/article-12345',
    'random news phrase without trigger structure',
    'tell me something interesting',
    'Give me an academic research dossier',
    'What is an academic research dossier?',
    'research dossier',
    'https://openalex.org/works/W123456789'
  ];

  for (const input of fallthroughCases) {
    const result = classifyPlainLanguageIntent(input);
    assert.strictEqual(result, null, `Expected null fallthrough for: "${input}"`);
  }

  // ==========================================
  // 5. Safety Preservation (Returns null)
  // ==========================================
  // Control characters
  assert.strictEqual(
    classifyPlainLanguageIntent("What is the latest news about quantum\x00computing?"),
    null,
    'Control characters must be rejected'
  );
  assert.strictEqual(
    classifyPlainLanguageIntent("Give me an academic research dossier on quantum\x00computing"),
    null,
    'Control characters in dossier phrase must be rejected'
  );
  assert.strictEqual(
    classifyPlainLanguageIntent("Academic research dossier about space\nexploration"),
    null,
    'Newline characters in dossier phrase must be rejected'
  );

  // High-confidence credentials
  assert.strictEqual(
    classifyPlainLanguageIntent("What is the latest news about gsk_1234567890abcdef1234567890abcdef?"),
    null,
    'Credential patterns must be rejected'
  );
  assert.strictEqual(
    classifyPlainLanguageIntent("Give me an academic research dossier on gsk_1234567890abcdef1234567890abcdef"),
    null,
    'Credential patterns in dossier phrase must be rejected'
  );
  assert.strictEqual(
    classifyPlainLanguageIntent("Research dossier for AKIAIOSFODNN7EXAMPLE"),
    null,
    'AWS key patterns in dossier phrase must be rejected'
  );

  // Offensive cyber terms
  assert.strictEqual(
    classifyPlainLanguageIntent("What is the latest news about credential theft?"),
    null,
    'Offensive cyber terms must be rejected'
  );
  assert.strictEqual(
    classifyPlainLanguageIntent("Give me an academic research dossier on credential theft"),
    null,
    'Offensive cyber terms in dossier phrase must be rejected'
  );
  assert.strictEqual(
    classifyPlainLanguageIntent("Research dossier on ransomware payload"),
    null,
    'Offensive cyber terms in dossier phrase must be rejected'
  );

  // Local / browser actions
  assert.strictEqual(
    classifyPlainLanguageIntent("What is the latest news and open safari"),
    null,
    'Browser actions must be rejected'
  );
  assert.strictEqual(
    classifyPlainLanguageIntent("Give me an academic research dossier on quantum computing and open terminal"),
    null,
    'Browser/local actions in dossier phrase must be rejected'
  );

  // ==========================================
  // 6. No Accidental Broadening
  // ==========================================
  // Empty topic with whitespace
  assert.strictEqual(
    classifyPlainLanguageIntent("What is the latest news about ?"),
    null,
    'Empty topic after about must return null'
  );
  assert.strictEqual(
    classifyPlainLanguageIntent("What's the latest news on ???"),
    null,
    'Punctuation-only topic must return null'
  );
  assert.strictEqual(
    classifyPlainLanguageIntent("What is the latest news on    "),
    null,
    'Whitespace-only topic must return null'
  );

  // Dossier anti-broadening
  assert.strictEqual(
    classifyPlainLanguageIntent("Give me an academic research dossier on ?"),
    null,
    'Empty topic in dossier phrase must return null'
  );
  assert.strictEqual(
    classifyPlainLanguageIntent("Academic research dossier about    "),
    null,
    'Whitespace-only topic in dossier phrase must return null'
  );
  assert.strictEqual(
    classifyPlainLanguageIntent("What is the latest research dossier on quantum computing?"),
    null,
    'Unanchored mixed question must not match Pattern 2b'
  );

  console.log('ALL PLAIN-LANGUAGE NEWS ROUTER V0 STATIC AND LOGICAL TESTS PASSED.');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
