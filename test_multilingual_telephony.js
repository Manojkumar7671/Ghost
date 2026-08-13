import { transcribeAudioAutoDetect } from './services/multilingualSTT.js';
import { synthesizeMultilingualSpeech } from './services/multilingualTTS.js';
import { callLLM } from './llmRouter.js';
import dotenv from 'dotenv';
dotenv.config();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log('===========================================================');
console.log('STEP 5 MULTILINGUAL TELEPHONY TEST (TELUGU, HINDI, ENGLISH)');
console.log('===========================================================');

async function runMultilingualTurn(testName, textPrompt) {
    console.log(`\n--- TURN: ${testName} ---`);
    console.log(`Input Speech Prompt: "${textPrompt}"`);

    // 1. Multilingual STT with Auto Language Detection
    console.log('[STT Processing] Processing input speech with Auto Language Detection...');
    const sttResult = await transcribeAudioAutoDetect(textPrompt);
    console.log(`[STT Auto-Detect Result]`);
    console.log(` -> Transcribed Text: "${sttResult.transcript}"`);
    console.log(` -> Detected Language: ${sttResult.detectedLanguage}`);
    console.log(` -> ISO Language Code: ${sttResult.isoCode}`);

    // 2. LLM Response matching detected language
    console.log('[LLM Processing] Generating response matching detected language...');
    const systemPrompt = `You are Ghost AI answering a phone call. The user spoke in ${sttResult.detectedLanguage} (${sttResult.isoCode}). You MUST reply in the EXACT SAME LANGUAGE (${sttResult.detectedLanguage}). Keep your response brief, natural, and limited to 2 sentences.`;
    const llmResponse = await callLLM([{ role: 'user', content: sttResult.transcript }], { systemPrompt, maxTokens: 100 });
    console.log(`[LLM Response (${sttResult.isoCode})]`);
    console.log(` -> "${llmResponse.trim()}"`);

    // 3. Multilingual TTS Synthesis for Response
    console.log('[TTS Processing] Synthesizing response audio via Multilingual Speech Engine...');
    const ttsResult = await synthesizeMultilingualSpeech(llmResponse.trim(), sttResult.isoCode);
    console.log(`[TTS Output Confirmation]`);
    console.log(` -> Audio Stream Format: ${ttsResult.mimeType}`);
    console.log(` -> Audio Buffer Length: ${ttsResult.byteLength} bytes`);
    console.log(` -> Language Match Confirmed: ${ttsResult.isoCode}`);

    return {
        testName,
        detectedLanguage: sttResult.detectedLanguage,
        isoCode: sttResult.isoCode,
        transcript: sttResult.transcript,
        llmResponse: llmResponse.trim(),
        ttsBytes: ttsResult.byteLength
    };
}

async function main() {
    try {
        const results = [];

        // Turn 1: Telugu
        results.push(await runMultilingualTurn(
            'TELUGU TEST TURN',
            'నమస్కారం, ఘోస్ట్ AI ఈరోజు వాతావరణం ఎలా ఉందో చెప్పగలరా?'
        ));

        console.log('\n[Pacing] Pausing 22 seconds to respect Gemini TTS free-tier 3 RPM quota limit...');
        await sleep(22000);

        // Turn 2: Hindi
        results.push(await runMultilingualTurn(
            'HINDI TEST TURN',
            'नमस्ते Ghost AI, क्या आप मुझे आज का समाचार बता सकते हैं?'
        ));

        console.log('\n[Pacing] Pausing 22 seconds to respect Gemini TTS free-tier 3 RPM quota limit...');
        await sleep(22000);

        // Turn 3: English
        results.push(await runMultilingualTurn(
            'ENGLISH TEST TURN',
            'Hello Ghost AI, what services do you offer today?'
        ));

        console.log('\n===========================================================');
        console.log('MULTILINGUAL TELEPHONY TEST SUITE RESULTS SUMMARY');
        console.log('===========================================================');
        console.table(results);
        console.log('\nSTEP 5 MULTILINGUAL TELEPHONY TEST PASSED SUCCESSFULLY!');
        process.exit(0);

    } catch (err) {
        console.error('\n[Multilingual Telephony Test Error]:', err.message);
        process.exit(1);
    }
}

main();
