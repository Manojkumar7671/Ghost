const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const FormData = require('form-data');
const crypto = require('crypto');

const OUTPUT_DIR = path.join(__dirname, '../../logs/audio');
fs.ensureDirSync(OUTPUT_DIR);

let localTtsInstance = null;

/**
 * Text to Speech using local Kokoro-82M as primary, falling back to ElevenLabs
 */
async function textToSpeech(text, filename) {
  let finalFilename = filename;
  if (!finalFilename) {
    finalFilename = `speech_${Date.now()}.wav`;
  }
  const filePath = path.join(OUTPUT_DIR, finalFilename);

  console.log(`[voiceAgent] Attempting Text-to-Speech via local Kokoro-82M...`);
  try {
    const { KokoroTTS } = await import('kokoro-js');
    if (!localTtsInstance) {
      console.log('[voiceAgent] Initializing local KokoroTTS ONNX model (cpu)...');
      localTtsInstance = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
        dtype: "q8",
        device: "cpu"
      });
      console.log('[voiceAgent] KokoroTTS ONNX model initialized successfully.');
    }
    const audio = await localTtsInstance.generate(text, { voice: "af_sky" });
    await audio.save(filePath);
    console.log(`[voiceAgent] Local Kokoro TTS succeeded. Saved to: ${filePath}`);
    return { success: true, file: filePath };
  } catch (err) {
    console.warn(`[voiceAgent] Local Kokoro-82M failed: ${err.message}. Falling back to ElevenLabs...`);
    
    let fallbackFilename = filename;
    if (!fallbackFilename) {
      fallbackFilename = `speech_${Date.now()}.mp3`;
    } else if (fallbackFilename.endsWith('.wav')) {
      fallbackFilename = fallbackFilename.replace(/\.wav$/, '.mp3');
    }
    const fallbackPath = path.join(OUTPUT_DIR, fallbackFilename);

    if (!process.env.ELEVENLABS_API_KEY) {
      return { error: `Local Kokoro failed (${err.message}) and ElevenLabs is not configured (missing ELEVENLABS_API_KEY)` };
    }

    try {
      const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
      console.log(`[voiceAgent] Initiating ElevenLabs synthesis API fallback...`);
      const res = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        { 
          text, 
          model_id: 'eleven_multilingual_v2', 
          voice_settings: { 
            stability: 0.4, 
            similarity_boost: 0.75, 
            style: 0.05, 
            use_speaker_boost: true 
          } 
        },
        { 
          headers: { 
            'xi-api-key': process.env.ELEVENLABS_API_KEY, 
            'Content-Type': 'application/json' 
          }, 
          responseType: 'arraybuffer' 
        }
      );
      await fs.writeFile(fallbackPath, res.data);
      console.log(`[voiceAgent] ElevenLabs fallback succeeded. Saved to: ${fallbackPath}`);
      return { success: true, file: fallbackPath };
    } catch (elevenErr) {
      const errorMsg = elevenErr.response?.data ? Buffer.from(elevenErr.response.data).toString() : elevenErr.message;
      console.error(`[voiceAgent] ElevenLabs fallback failed:`, errorMsg);
      return { error: `TTS failed. Local Kokoro error: ${err.message}. ElevenLabs error: ${errorMsg}` };
    }
  }
}


/**
 * Audio Transcription using Whisper API (Groq or OpenAI endpoint)
 */
async function transcribeAudio(audioBuffer, filename = 'input.webm') {
  const tryTranscribe = async (endpoint, apiKey, model) => {
    const form = new FormData();
    form.append('file', audioBuffer, { filename, contentType: 'audio/webm' });
    form.append('model', model);

    const res = await axios.post(endpoint, form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${apiKey}`
      },
      timeout: 15000
    });
    return res.data?.text || res.data?.text_output || '';
  };

  // 1. Try Groq Whisper API
  if (process.env.GROQ_API_KEY) {
    try {
      console.log('[voiceAgent] Attempting Groq Whisper transcription (whisper-large-v3-turbo)...');
      const text = await tryTranscribe('https://api.groq.com/openai/v1/audio/transcriptions', process.env.GROQ_API_KEY, 'whisper-large-v3-turbo');
      if (text) return { success: true, text };
    } catch (err) {
      console.warn('[voiceAgent] Groq Whisper transcription failed:', err.response?.data?.error?.message || err.message);
    }
  }

  // 2. Try NVIDIA NIM Audio Transcription
  if (process.env.NVIDIA_API_KEY) {
    try {
      console.log('[voiceAgent] Attempting NVIDIA NIM audio transcription (nvidia/canary-1b)...');
      const text = await tryTranscribe('https://integrate.api.nvidia.com/v1/audio/transcriptions', process.env.NVIDIA_API_KEY, 'nvidia/canary-1b');
      if (text) return { success: true, text };
    } catch (err) {
      console.warn('[voiceAgent] NVIDIA NIM audio transcription failed:', err.response?.data?.error?.message || err.message);
    }
  }

  // 3. Try OpenAI Whisper API
  if (process.env.OPENAI_API_KEY || process.env.WHISPER_API_KEY) {
    const key = process.env.WHISPER_API_KEY || process.env.OPENAI_API_KEY;
    try {
      console.log('[voiceAgent] Attempting OpenAI Whisper transcription...');
      const text = await tryTranscribe('https://api.openai.com/v1/audio/transcriptions', key, 'whisper-1');
      if (text) return { success: true, text };
    } catch (err) {
      console.warn('[voiceAgent] OpenAI Whisper transcription failed:', err.response?.data?.error?.message || err.message);
    }
  }

  return { error: 'Voice transcription failed across all available provider endpoints.' };
}

module.exports = { textToSpeech, transcribeAudio };
