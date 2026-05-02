const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

class VisionAgent {
  async run(task, imageBase64, mimeType = "image/jpeg") {
    if (!imageBase64) return { error: "No image provided" };
    const res = await groq.chat.completions.create({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            { type: "text", text: task || "Describe this image in detail." }
          ]
        }
      ],
      max_tokens: 1024,
    });
    return { result: res.choices[0].message.content };
  }
}

module.exports = VisionAgent;
