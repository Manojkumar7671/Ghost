const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const OUTPUT_DIR = path.join(__dirname, '../../logs/audio');
fs.ensureDirSync(OUTPUT_DIR);

async function textToSpeech(text, filename = `speech_${Date.now()}.mp3`) {
  if (!process.env.ELEVENLABS_API_KEY) return { error: 'ELEVENLABS_API_KEY not set' };
  const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  const res = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    { text, model_id: 'eleven_monolingual_v1', voice_settings: { stability: 0.5, similarity_boost: 0.75 } },
    { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' }, responseType: 'arraybuffer' }
  );
  const filePath = path.join(OUTPUT_DIR, filename);
  await fs.writeFile(filePath, res.data);
  return { success: true, file: filePath };
}
module.exports = { textToSpeech };
