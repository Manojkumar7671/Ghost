const assert = require('assert');
const { validateAndFilterGrounding } = require('../src/agents/deepResearchAgent');

console.log("=== RUNNING DEEP RESEARCH GROUNDING TEST ===");

// 1. Realistic source text mentioning real Transformer concepts and entities
const mockSources = `
Source: Google Research - Attention Is All You Need (2017)
The Transformer model was introduced by Vaswani et al. at Google Brain.
It replaces recurrent connections with multi-head self-attention.
Key developments include BERT by Devlin et al. and GPT by OpenAI.
Hardware accelerators like TPU v3 and Nvidia V100 were used for training.
`;

// 2. Synthesis text containing both grounded entities (Vaswani, BERT, GPT, TPU, Nvidia)
// and hallucinated/ungrounded entities ("Synapse-3D", "NOA Consortium", "QuantumMem-X").
const mockSynthesisWithHallucinations = `
# Transformer Neural Networks Report

### Foundations and Lineage
The architecture was developed by Vaswani et al. at Google Brain.
Modern developments include BERT and GPT models.

### State of the Art Hardware and Prototypes
Recent claims from the NOA Consortium suggest the deployment of Synapse-3D accelerators.
Furthermore, QuantumMem-X has been proposed for non-volatile weight storage.
Nvidia V100 GPUs and TPU architectures remain the industrial standard.
`;

// Run the grounding validator
const result = validateAndFilterGrounding(mockSynthesisWithHallucinations, mockSources);

console.log("\n1. Grounding Validation Result:");
console.log(`   isValid: ${result.isValid}`);
console.log(`   Ungrounded Entities Detected:`, result.ungroundedEntities);

// Assertions
assert.strictEqual(result.isValid, false, "Expected grounding validation to fail when ungrounded entities are present.");
assert.ok(result.ungroundedEntities.includes("NOA Consortium"), "Should detect ungrounded entity 'NOA Consortium'");
assert.ok(result.ungroundedEntities.includes("Synapse-3D"), "Should detect ungrounded entity 'Synapse-3D'");
assert.ok(result.ungroundedEntities.includes("QuantumMem-X"), "Should detect ungrounded entity 'QuantumMem-X'");

// Assert grounded entities were preserved
assert.ok(!result.ungroundedEntities.includes("Vaswani"), "Vaswani is grounded in sources and should NOT be flagged");
assert.ok(!result.ungroundedEntities.includes("BERT"), "BERT is grounded in sources and should NOT be flagged");
assert.ok(!result.ungroundedEntities.includes("GPT"), "GPT is grounded in sources and should NOT be flagged");

// Verify filtered synthesis has ungrounded entities stripped/replaced
console.log("\n2. Filtered Synthesis Output:");
console.log(result.filteredSynthesis);

assert.ok(result.filteredSynthesis.includes("[UNGROUNDED ENTITY REMOVED: NOA Consortium]"), "NOA Consortium should be stripped");
assert.ok(result.filteredSynthesis.includes("[UNGROUNDED ENTITY REMOVED: Synapse-3D]"), "Synapse-3D should be stripped");
assert.ok(result.filteredSynthesis.includes("[UNGROUNDED ENTITY REMOVED: QuantumMem-X]"), "QuantumMem-X should be stripped");
assert.ok(result.filteredSynthesis.includes("BERT"), "BERT should remain intact");
assert.ok(result.filteredSynthesis.includes("Vaswani"), "Vaswani should remain intact");

// 3. Test clean grounded synthesis
const cleanSynthesis = `
The Transformer architecture was introduced by Vaswani et al. at Google Brain.
It enables high parallelism compared to RNNs and underpins BERT and GPT.
`;
const cleanResult = validateAndFilterGrounding(cleanSynthesis, mockSources);
console.log("\n3. Clean Synthesis Validation:");
console.log(`   isValid: ${cleanResult.isValid}`);
console.log(`   Ungrounded Entities:`, cleanResult.ungroundedEntities);
assert.strictEqual(cleanResult.isValid, true, "Clean grounded synthesis must pass validation.");
assert.strictEqual(cleanResult.ungroundedEntities.length, 0, "No ungrounded entities should be found in clean synthesis.");

console.log("\nAll Grounding Tests PASSED successfully!\n");
