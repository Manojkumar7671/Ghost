const axios = require('axios');
async function generateImage(prompt, { width = 768, height = 768 } = {}) {
  if (!process.env.REPLICATE_API_TOKEN) return { error: 'REPLICATE_API_TOKEN not set' };
  try {
    const res = await axios.post(
      'https://api.replicate.com/v1/models/stability-ai/sdxl/versions/7762fd07cf82c948538e41f63f77d685e02b063e37291c2f594d2d8f1961ae8e/predictions',
      { input: { prompt, width, height, num_outputs: 1, num_inference_steps: 25 } },
      { headers: { Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`, 'Content-Type': 'application/json' } }
    );
    const id = res.data.id;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const poll = await axios.get(`https://api.replicate.com/v1/predictions/${id}`, { headers: { Authorization: `Token ${process.env.REPLICATE_API_TOKEN}` } });
      if (poll.data.status === 'succeeded') return { success: true, url: poll.data.output[0], prompt };
      if (poll.data.status === 'failed') return { error: 'Failed', detail: poll.data.error };
    }
    return { error: 'Timed out' };
  } catch (err) {
    if (err.response?.status === 401) {
      return { error: 'API key invalid/expired' };
    }
    return { error: `Replicate API error: ${err.message}` };
  }
}
module.exports = { generateImage };
