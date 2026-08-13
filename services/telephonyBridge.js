import express from 'express';
import { callLLM } from '../llmRouter.js';
import { logUsage } from './usageTracker.js';
import { transcribeAudioAutoDetect } from './multilingualSTT.js';
import { synthesizeMultilingualSpeech } from './multilingualTTS.js';

export function initTelephonyBridge(app, pool) {
    if (!process.env.TWILIO_ACCOUNT_SID) {
        console.warn('[TelephonyBridge] Missing Twilio credentials. Telephony subsystem inactive.');
    }

    console.log('[TelephonyBridge] Initializing Multilingual Twilio Voice Integration (Telugu, Hindi, English, etc.)...');

    // Webhook for incoming Twilio calls
    app.post('/api/telephony/incoming', express.urlencoded({ extended: false }), async (req, res) => {
        const twiml = `
            <Response>
                <Say voice="Polly.Aditi">Hello, you have reached Ghost AI. Please state your request in any language.</Say>
                <Record action="/api/telephony/process-recording" maxLength="30" playBeep="true" />
            </Response>
        `;
        res.type('text/xml');
        res.send(twiml);
    });

    // Webhook to process recording with multilingual STT -> LLM -> TTS pipeline
    app.post('/api/telephony/process-recording', express.urlencoded({ extended: false }), async (req, res) => {
        const recordingUrl = req.body.RecordingUrl;
        const callSid = req.body.CallSid;
        
        if (!recordingUrl) {
            const twiml = '<Response><Say>Sorry, I did not catch that. Goodbye.</Say><Hangup/></Response>';
            res.type('text/xml');
            return res.send(twiml);
        }

        try {
            console.log(`[TelephonyBridge] Fetching recording audio from ${recordingUrl}...`);
            const audioResp = await fetch(recordingUrl);
            const audioBuffer = Buffer.from(await audioResp.arrayBuffer());

            // 1. Multilingual STT with Auto Language Detection
            const sttResult = await transcribeAudioAutoDetect(audioBuffer, 'audio/m4a');
            console.log(`[TelephonyBridge] STT Transcribed: "${sttResult.transcript}" | Detected Language: ${sttResult.detectedLanguage} (${sttResult.isoCode})`);

            // 2. Multilingual LLM Response matching detected language
            const systemPrompt = `You are Ghost AI answering a phone call. The user spoke in ${sttResult.detectedLanguage} (ISO: ${sttResult.isoCode}). You MUST reply in the EXACT SAME LANGUAGE (${sttResult.detectedLanguage}). Keep your response brief, natural, and limited to 2 sentences.`;
            const llmResponse = await callLLM([{ role: 'user', content: sttResult.transcript }], { systemPrompt, maxTokens: 120 });
            console.log(`[TelephonyBridge] LLM Response (${sttResult.isoCode}): "${llmResponse.trim()}"`);

            // 3. Multilingual Audio Synthesis (TTS)
            const ttsResult = await synthesizeMultilingualSpeech(llmResponse.trim(), sttResult.isoCode);
            console.log(`[TelephonyBridge] TTS Audio Synthesized: ${ttsResult.byteLength} bytes (${sttResult.detectedLanguage})`);

            // 4. Log to Supabase call_logs
            if (pool) {
                try {
                    await pool.query(
                        'INSERT INTO call_logs (call_sid, user_transcript, agent_response, created_at) VALUES ($1, $2, $3, NOW())',
                        [callSid, `[${sttResult.detectedLanguage}] ${sttResult.transcript}`, llmResponse]
                    );
                } catch (e) {
                    console.error('[TelephonyBridge] Failed to save call log:', e.message);
                }
            }
            
            await logUsage('twilio_voice_multilingual', 0.02).catch(() => {});

            // 5. TwiML Output Response
            const twiml = `
                <Response>
                    <Say voice="Polly.Aditi">${llmResponse.substring(0, 500)}</Say>
                    <Hangup/>
                </Response>
            `;
            res.type('text/xml');
            res.send(twiml);

        } catch (error) {
            console.error('[TelephonyBridge] Error processing call:', error);
            const twiml = '<Response><Say>I encountered an error processing your call. Please try again later.</Say><Hangup/></Response>';
            res.type('text/xml');
            res.send(twiml);
        }
    });
}
