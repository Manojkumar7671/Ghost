const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const FormData = require('form-data');

const OUTPUT_DIR = path.join(__dirname, '../../logs/audio');
fs.ensureDirSync(OUTPUT_DIR);

/**
 * Text to Speech using ElevenLabs
 */
async function textToSpeech(text, filename = `speech_${Date.now()}.mp3`) {
  if (!process.env.ELEVENLABS_API_KEY) return { error: 'ELEVENLABS_API_KEY not set' };
  const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
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
    { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' }, responseType: 'arraybuffer' }
  );
  const filePath = path.join(OUTPUT_DIR, filename);
  await fs.writeFile(filePath, res.data);
  return { success: true, file: filePath };
}

/**
 * Audio Transcription using Whisper API (Groq or OpenAI endpoint)
 */
async function transcribeAudio(audioBuffer, filename = 'input.webm') {
  const apiKey = process.env.WHISPER_API_KEY || process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { error: 'WHISPER_API_KEY (or GROQ_API_KEY/OPENAI_API_KEY) not set in environment variables.' };
  }

  const isGroq = !process.env.WHISPER_API_KEY && !process.env.OPENAI_API_KEY && process.env.GROQ_API_KEY;
  const endpoint = isGroq
    ? 'https://api.groq.com/openai/v1/audio/transcriptions'
    : 'https://api.openai.com/v1/audio/transcriptions';
  const model = isGroq ? 'whisper-large-v3' : 'whisper-1';

  try {
    const form = new FormData();
    form.append('file', audioBuffer, { filename, contentType: 'audio/webm' });
    form.append('model', model);

    const res = await axios.post(endpoint, form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${apiKey}`
      }
    });

    return { success: true, text: res.data.text };
  } catch (err) {
    const errorMsg = err.response?.data?.error?.message || err.message;
    console.error('[voiceAgent] Whisper transcription failed:', errorMsg);
    return { error: `Whisper transcription failed: ${errorMsg}` };
  }
}

module.exports = { textToSpeech, transcribeAudio };
