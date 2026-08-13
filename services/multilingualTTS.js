import fs from 'fs';
import { execSync } from 'child_process';

/**
 * Multilingual Text-To-Speech Synthesizer
 * Uses Gemini Multilingual TTS preview for Telugu, Hindi, English, etc.,
 * with graceful fallback to native voice synthesis if API quota 429 is reached.
 */
export async function synthesizeMultilingualSpeech(text, isoCode = 'en', voiceName = 'Puck') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;
            
            const payload = {
                contents: [{
                    parts: [{ text: `Read aloud the following text transcript: ${text}` }]
                }],
                generationConfig: {
                    responseModalities: ['AUDIO'],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: voiceName }
                        }
                    }
                }
            };

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                const data = await res.json();
                const candidatePart = data.candidates?.[0]?.content?.parts?.[0];
                
                if (candidatePart && candidatePart.inlineData) {
                    const audioBuffer = Buffer.from(candidatePart.inlineData.data, 'base64');
                    return {
                        success: true,
                        audioBuffer,
                        mimeType: candidatePart.inlineData.mimeType || 'audio/pcm',
                        isoCode,
                        byteLength: audioBuffer.length,
                        provider: 'Gemini Multilingual TTS'
                    };
                }
            } else if (res.status === 429) {
                console.warn('[Multilingual TTS Warning]: 429 Rate Limit / Quota Exceeded on Gemini TTS. Engaging native voice synthesizer fallback.');
            }
        } catch (e) {
            console.warn('[Multilingual TTS Warning]: Primary TTS failed, engaging fallback:', e.message);
        }
    }

    // Native Fallback Synthesizer
    const tmpAiff = `/tmp/tts_fallback_${Date.now()}.aiff`;
    const tmpWav = `/tmp/tts_fallback_${Date.now()}.wav`;
    
    try {
        if (isoCode === 'hi') {
            execSync(`say -v Lekha -o "${tmpAiff}" "${text.replace(/"/g, '')}"`);
        } else {
            execSync(`say -o "${tmpAiff}" "${text.replace(/"/g, '')}"`);
        }
        execSync(`afconvert "${tmpAiff}" "${tmpWav}" -f WAVE -d LEI16@24000`);
        
        const audioBuffer = fs.readFileSync(tmpWav);
        if (fs.existsSync(tmpAiff)) fs.unlinkSync(tmpAiff);
        if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav);

        return {
            success: true,
            audioBuffer,
            mimeType: 'audio/wav',
            isoCode,
            byteLength: audioBuffer.length,
            provider: 'Native Voice Synthesizer Fallback'
        };
    } catch (fallbackErr) {
        throw new Error(`[Multilingual TTS Fatal]: Both Gemini TTS and native fallback failed: ${fallbackErr.message}`);
    }
}
