import fs from 'fs';

/**
 * Multilingual STT with Auto Language Detection across Telugu, Hindi, English, Spanish, etc.
 * Supports audio buffers, audio file paths, or text input streams.
 */
export async function transcribeAudioAutoDetect(inputPayload, mimeType = 'audio/wav') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('[Multilingual STT] Missing GEMINI_API_KEY for language detection.');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    let parts = [];
    if (typeof inputPayload === 'string' && fs.existsSync(inputPayload)) {
        const base64Audio = fs.readFileSync(inputPayload).toString('base64');
        parts.push({ text: 'Analyze this audio input. Auto-detect the spoken language (e.g. Telugu, Hindi, English, Spanish). Return JSON with fields: "detected_language", "iso_code" (e.g. te, hi, en, es), and "transcript" (exact text transcription).' });
        parts.push({ inline_data: { mime_type: mimeType, data: base64Audio } });
    } else if (Buffer.isBuffer(inputPayload)) {
        parts.push({ text: 'Analyze this audio input. Auto-detect the spoken language (e.g. Telugu, Hindi, English, Spanish). Return JSON with fields: "detected_language", "iso_code" (e.g. te, hi, en, es), and "transcript" (exact text transcription).' });
        parts.push({ inline_data: { mime_type: mimeType, data: inputPayload.toString('base64') } });
    } else {
        const textContent = String(inputPayload);
        parts.push({ text: `Analyze the following input text speech stream: "${textContent}". Auto-detect the exact language. Return JSON with fields: "detected_language" (full name e.g. Telugu, Hindi, English), "iso_code" (2-letter ISO code e.g. te, hi, en), and "transcript" (the input text string).` });
    }

    const payload = {
        contents: [{ parts }],
        generationConfig: { response_mime_type: 'application/json' }
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`[Multilingual STT API Error ${res.status}]: ${errText}`);
    }

    const data = await res.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
        throw new Error('[Multilingual STT] Empty result returned.');
    }

    const parsed = JSON.parse(rawText.trim());
    return {
        transcript: parsed.transcript || String(inputPayload),
        isoCode: (parsed.iso_code || 'en').toLowerCase(),
        detectedLanguage: parsed.detected_language || 'English'
    };
}
