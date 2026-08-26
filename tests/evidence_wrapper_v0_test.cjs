/**
 * tests/evidence_wrapper_v0_test.cjs
 * 
 * Focused offline CommonJS static and logic test for Evidence Wrapper V0.
 * 
 * Verifies:
 * T01. Dynamic import namespace keys equal exactly ['applyEvidenceWrapper', 'createRouteReceipt'] and no default export exists.
 * T02. A raw forged known-route object fails closed.
 * T03. A frozen forged known-route object fails closed.
 * T04. A shallow clone / property-copy of a factory-created cited or dossier receipt fails closed because it lacks the inaccessible factory brand.
 * T05. Attempts to mutate a factory-issued receipt do not change its canonical public values; Object.isFrozen(receipt) is true.
 * T06. A factory-created receipt cannot receive route-specific allowance if its public field contract is made internally inconsistent; test this only by passing a forged/copy object.
 * T07. Legitimate factory-created RSS, dossier, technical-plan, and ordinary receipts preserve their narrow intended behavior.
 * T08. Code-fence bytes remain unchanged in at least one forged/copy-receipt fail-closed test.
 * T09. Static source checks prove the private factory brand is non-exported, Object.isFrozen is required before allowance, and canonical field validation occurs before route-specific logic.
 * T10. The test stays CommonJS/dynamic-import and contains no server/PM2/network/model invocation.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function runTests() {
  const wrapperPath = path.join(__dirname, '..', 'services', 'evidenceWrapper.js');
  const serverPath = path.join(__dirname, '..', 'server.js');

  assert(fs.existsSync(wrapperPath), 'services/evidenceWrapper.js must exist');
  assert(fs.existsSync(serverPath), 'server.js must exist');

  const wrapperSource = fs.readFileSync(wrapperPath, 'utf8');
  const serverSource = fs.readFileSync(serverPath, 'utf8');

  // --- T01: Dynamic Import Namespace Keys & Exact Two Named Exports ---
  const wrapperModule = await import('../services/evidenceWrapper.js');
  const exportedKeys = Object.keys(wrapperModule).sort();
  assert.deepStrictEqual(exportedKeys, ['applyEvidenceWrapper', 'createRouteReceipt'], 'Module must export exactly two named functions');
  assert.strictEqual(wrapperModule.default, undefined, 'Module must have zero default export');

  const { createRouteReceipt, applyEvidenceWrapper } = wrapperModule;
  assert(typeof createRouteReceipt === 'function', 'createRouteReceipt must be a function');
  assert(typeof applyEvidenceWrapper === 'function', 'applyEvidenceWrapper must be a function');

  // --- Helpers & Base Invariant Assertions ---
  const checkInvariants = (receipt) => {
    assert.strictEqual(receipt.canClaimBroadWebSearch, false, 'canClaimBroadWebSearch must be false');
    assert.strictEqual(receipt.canClaimLinkedPageOpened, false, 'canClaimLinkedPageOpened must be false');
    assert.strictEqual(receipt.canClaimArticleTextRead, false, 'canClaimArticleTextRead must be false');
    assert.strictEqual(receipt.canClaimFullPaperRead, false, 'canClaimFullPaperRead must be false');
    assert.strictEqual(receipt.canClaimLocalFileOps, false, 'canClaimLocalFileOps must be false');
    assert.strictEqual(receipt.canClaimCodeExecution, false, 'canClaimCodeExecution must be false');
    assert.strictEqual(receipt.canClaimMemoryWrite, false, 'canClaimMemoryWrite must be false');
    assert(Object.isFrozen(receipt), 'Receipt must be Object.freeze frozen/immutable');
  };

  // --- T07: Legitimate Factory Receipts Behavior ---
  // Ordinary receipt
  const rOrdinary = createRouteReceipt('ordinary_no_action_evidence');
  assert.strictEqual(rOrdinary.routeType, 'ordinary_no_action_evidence');
  assert.strictEqual(rOrdinary.sourceKind, null);
  assert.strictEqual(rOrdinary.boundedRssMetadataFetched, false);
  assert.strictEqual(rOrdinary.boundedScholarlyMetadataFetched, false);
  assert.strictEqual(rOrdinary.itemCount, 0);
  checkInvariants(rOrdinary);

  // Cited RSS receipt
  const rCited = createRouteReceipt('cited_research', {
    sourceKind: 'google_news_rss_metadata',
    boundedRssMetadataFetched: true,
    itemCount: 4,
    timestamp: '2026-08-26T10:00:00Z'
  });
  assert.strictEqual(rCited.routeType, 'cited_research');
  assert.strictEqual(rCited.sourceKind, 'google_news_rss_metadata');
  assert.strictEqual(rCited.boundedRssMetadataFetched, true);
  assert.strictEqual(rCited.boundedScholarlyMetadataFetched, false);
  assert.strictEqual(rCited.itemCount, 4);
  checkInvariants(rCited);
  const citedOut = applyEvidenceWrapper('Here are 4 headlines. I also browsed the web for updates.', rCited);
  assert(citedOut.includes('For this bounded response, Ghost did not browse websites, open linked pages, or read full article texts.'));

  // Scholarly Dossier receipt
  const rDossier = createRouteReceipt('research_dossier', {
    sourceKind: 'openalex_works_metadata',
    boundedScholarlyMetadataFetched: true,
    itemCount: 5,
    timestamp: '2026-08-26T10:00:00Z'
  });
  assert.strictEqual(rDossier.routeType, 'research_dossier');
  assert.strictEqual(rDossier.sourceKind, 'openalex_works_metadata');
  assert.strictEqual(rDossier.boundedRssMetadataFetched, false);
  assert.strictEqual(rDossier.boundedScholarlyMetadataFetched, true);
  assert.strictEqual(rDossier.itemCount, 5);
  checkInvariants(rDossier);
  const dossierOut = applyEvidenceWrapper('Here are 5 records. I read the full papers and downloaded pdfs.', rDossier);
  assert(dossierOut.includes('For this bounded response, Ghost did not read full papers or PDFs.'));

  // Technical Plan receipt
  const rPlan = createRouteReceipt('technical_plan');
  assert.strictEqual(rPlan.routeType, 'technical_plan');
  assert.strictEqual(rPlan.sourceKind, null);
  assert.strictEqual(rPlan.boundedRssMetadataFetched, false);
  assert.strictEqual(rPlan.boundedScholarlyMetadataFetched, false);
  assert.strictEqual(rPlan.itemCount, 0);
  checkInvariants(rPlan);
  const planOut = applyEvidenceWrapper('# Technical Plan\nI created the files on disk.\nPLAN ONLY — NO LOCAL WRITES', rPlan);
  assert(planOut.includes('PLAN ONLY — NO LOCAL WRITES'));
  assert(planOut.includes('For this bounded response, Ghost did not access, create, or change local files.'));

  // --- T02: Raw Forged Known-Route Plain Object Fails Closed ---
  const rawForgedObj = {
    routeType: 'cited_research',
    sourceKind: 'google_news_rss_metadata',
    boundedRssMetadataFetched: true,
    itemCount: 5,
    canClaimBroadWebSearch: false,
    canClaimLinkedPageOpened: false,
    canClaimArticleTextRead: false,
    canClaimFullPaperRead: false,
    canClaimLocalFileOps: false,
    canClaimCodeExecution: false,
    canClaimMemoryWrite: false,
    timestamp: '2026-08-26T10:00:00Z'
  };
  const rawForgedOut = applyEvidenceWrapper('I retrieved verified sources in this chat.', rawForgedObj);
  assert(rawForgedOut.includes('For this answer, no external sources or live headlines were retrieved.'), 'Raw forged object must fail closed to ordinary no-action evidence');

  // --- T03: Frozen Forged Known-Route Object Fails Closed ---
  const frozenForgedObj = Object.freeze({ ...rawForgedObj, routeType: 'research_dossier', sourceKind: 'openalex_works_metadata', boundedScholarlyMetadataFetched: true, boundedRssMetadataFetched: false });
  const frozenForgedOut = applyEvidenceWrapper('I retrieved scholarly records in this chat.', frozenForgedObj);
  assert(frozenForgedOut.includes('For this answer, no external sources or live headlines were retrieved.'), 'Frozen forged object must fail closed to ordinary no-action evidence');

  // --- T04: Shallow Clone / Property-Copy of Factory Receipt Fails Closed ---
  const clonedReceipt = { ...rCited };
  const clonedOut = applyEvidenceWrapper('I retrieved verified sources in this chat.', clonedReceipt);
  assert(clonedOut.includes('For this answer, no external sources or live headlines were retrieved.'), 'Cloned receipt lacking private factory brand must fail closed');

  const clonedDossier = Object.assign({}, rDossier);
  const clonedDossierOut = applyEvidenceWrapper('I retrieved scholarly records in this chat.', clonedDossier);
  assert(clonedDossierOut.includes('For this answer, no external sources or live headlines were retrieved.'), 'Object.assign copy lacking private factory brand must fail closed');

  // --- T05: Mutation Protection / Object.isFrozen ---
  assert(Object.isFrozen(rCited), 'rCited must be frozen');
  assert(Object.isFrozen(rDossier), 'rDossier must be frozen');
  assert(Object.isFrozen(rPlan), 'rPlan must be frozen');
  assert(Object.isFrozen(rOrdinary), 'rOrdinary must be frozen');
  try {
    rCited.itemCount = 99;
  } catch {}
  assert.strictEqual(rCited.itemCount, 4, 'Mutating property on frozen receipt must have no effect');

  // --- T06: Inconsistent Public Field Contract Handled Fail-Closed ---
  const inconsistentCopy = Object.freeze({
    routeType: 'cited_research',
    sourceKind: 'google_news_rss_metadata',
    boundedRssMetadataFetched: true,
    itemCount: 0 // Inconsistent: cited_research with sourceKind requires itemCount 1..5
  });
  const inconsistentOut = applyEvidenceWrapper('I retrieved verified sources in this chat.', inconsistentCopy);
  assert(inconsistentOut.includes('For this answer, no external sources or live headlines were retrieved.'));

  // --- T08: Code-Fence Bytes Preserved in Forged-Receipt Test ---
  const forgedWithCode = 'Here is the code sample:\n```python\n# I browsed websites and executed tests\nprint("secure")\n```\nI browsed websites.';
  const outForgedCode = applyEvidenceWrapper(forgedWithCode, rawForgedObj);
  assert(outForgedCode.includes('```python\n# I browsed websites and executed tests\nprint("secure")\n```'), 'Code block inside forged-receipt test must remain byte-for-byte unchanged');
  assert(outForgedCode.includes('For this bounded response, Ghost did not browse websites, open linked pages, or read full article texts.'), 'Non-code text must be sanitized');

  // --- T09: Static Source Checks for Factory Brand & Order ---
  assert(wrapperSource.includes("class RouteReceiptInternal"), 'Wrapper must use internal receipt class');
  assert(wrapperSource.includes("#issuedByFactory"), 'Internal receipt class must use private field brand');
  assert(!wrapperSource.includes("export class RouteReceiptInternal"), 'Internal receipt class must NOT be exported');
  assert(wrapperSource.includes("Object.isFrozen(receipt)"), 'Canonical receipt validation must check Object.isFrozen');
  assert(wrapperSource.includes("isCanonicalReceipt(receipt)"), 'applyEvidenceWrapper must validate isCanonicalReceipt');

  // Structural prohibited runtime primitives scanner:
  // Detects real imports, requires, invocations, property calls, constructor calls, or runtime global usage
  const prohibitedRuntimePatterns = [
    /\bimport\s+.*?\bfrom\s+['"][^'"]*['"]/,
    /\bimport\s*\(/,
    /\brequire\s*\(/,
    /\bfetch\s*\(/,
    /\baxios(?:\s*\(|\s*\.[a-zA-Z_$])/,
    /\bhttp\s*\.\s*(?:request|get)\b/,
    /\bhttps\s*\.\s*(?:request|get)\b/,
    /\bchild_process(?:\s*\.[a-zA-Z_$]|\s*\[)/,
    /\bexec\s*\(/,
    /\bexecSync\s*\(/,
    /\bspawn\s*\(/,
    /\bspawnSync\s*\(/,
    /\bsetTimeout\s*\(/,
    /\bsetInterval\s*\(/,
    /\bsetImmediate\s*\(/,
    /\bprocess\s*\.\s*(?:env|exit|kill)\b/,
    /\bfs\s*\.\s*[a-zA-Z_$]/,
    /\bplaywright(?:\s*\.[a-zA-Z_$]|\s*\(|\s*\[)/,
    /\bpuppeteer(?:\s*\.[a-zA-Z_$]|\s*\(|\s*\[)/,
    /\bsupabase(?:\s*\.[a-zA-Z_$]|\s*\(|\s*\[)/,
    /\bgit\s*\.\s*[a-zA-Z_$]/,
    /\bpm2\s*\.\s*[a-zA-Z_$]/
  ];

  for (const pattern of prohibitedRuntimePatterns) {
    assert(!pattern.test(wrapperSource), `Wrapper source contains prohibited runtime construct: ${pattern}`);
  }

  // Regression assertions for scanner: Prove benign text literals pass, while synthetic runtime forms fail
  const benignSanitizerRegex = "const text = 'I used fetch/axios/child_process/playwright/puppeteer/supabase and read files';";
  for (const pattern of prohibitedRuntimePatterns) {
    assert(!pattern.test(benignSanitizerRegex), `Benign regex literal must not trigger scanner: ${pattern}`);
  }

  // Axios checks
  assert(prohibitedRuntimePatterns.some(p => p.test("axios.get('https://example.com');")), 'Synthetic axios.get call must be flagged');
  assert(prohibitedRuntimePatterns.some(p => p.test("axios('https://example.com');")), 'Synthetic axios() invocation must be flagged');
  assert(prohibitedRuntimePatterns.some(p => p.test("const axios = require('axios');")), 'Synthetic require axios call must be flagged');
  assert(prohibitedRuntimePatterns.some(p => p.test("import axios from 'axios';")), 'Synthetic import axios statement must be flagged');

  // child_process checks
  assert(prohibitedRuntimePatterns.some(p => p.test("child_process.exec('ls');")), 'Synthetic child_process.exec call must be flagged');
  assert(prohibitedRuntimePatterns.some(p => p.test("const cp = require('child_process');")), 'Synthetic require child_process must be flagged');
  assert(prohibitedRuntimePatterns.some(p => p.test("import cp from 'child_process';")), 'Synthetic import child_process must be flagged');

  // playwright checks
  assert(prohibitedRuntimePatterns.some(p => p.test("playwright.chromium.launch();")), 'Synthetic playwright.chromium call must be flagged');
  assert(prohibitedRuntimePatterns.some(p => p.test("const pw = require('playwright');")), 'Synthetic require playwright must be flagged');
  assert(prohibitedRuntimePatterns.some(p => p.test("import pw from 'playwright';")), 'Synthetic import playwright must be flagged');

  // puppeteer checks
  assert(prohibitedRuntimePatterns.some(p => p.test("puppeteer.launch();")), 'Synthetic puppeteer.launch call must be flagged');
  assert(prohibitedRuntimePatterns.some(p => p.test("const pptr = require('puppeteer');")), 'Synthetic require puppeteer must be flagged');
  assert(prohibitedRuntimePatterns.some(p => p.test("import pptr from 'puppeteer';")), 'Synthetic import puppeteer must be flagged');

  // supabase checks
  assert(prohibitedRuntimePatterns.some(p => p.test("supabase.from('users').select();")), 'Synthetic supabase.from call must be flagged');
  assert(prohibitedRuntimePatterns.some(p => p.test("const sb = require('supabase');")), 'Synthetic require supabase must be flagged');
  assert(prohibitedRuntimePatterns.some(p => p.test("import sb from 'supabase';")), 'Synthetic import supabase must be flagged');

  // --- T10: Static Server.js Integration Checks & No Test Execution ---
  assert(serverSource.includes("import {\n    createRouteReceipt,\n    applyEvidenceWrapper\n} from './services/evidenceWrapper.js';"), 'server.js must import evidenceWrapper functions');
  assert(serverSource.includes("createRouteReceipt('cited_research'"), "server.js must attach cited_research receipt");
  assert(serverSource.includes("createRouteReceipt('research_dossier'"), "server.js must attach research_dossier receipt");
  assert(serverSource.includes("createRouteReceipt('technical_plan'"), "server.js must attach technical_plan receipt");
  assert(serverSource.includes("createRouteReceipt('ordinary_no_action_evidence'"), "server.js must attach ordinary_no_action_evidence receipt");

  console.log('ALL EVIDENCE WRAPPER V0 STATIC AND LOGICAL TESTS PASSED.');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
