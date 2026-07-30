const fs = require('fs');
const path = require('path');
const { chat } = require('../tools/llm');

async function processDocument(filePath, query = 'Summarize key points') {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at path: ${filePath}`);
  }

  let textContent = '';
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.pdf') {
    const pdfBuffer = fs.readFileSync(filePath);
    const pdfStr = pdfBuffer.toString('binary');
    const textBlocks = [];
    const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
    let match;
    const zlib = require('zlib');
    while ((match = streamRegex.exec(pdfStr)) !== null) {
      try {
        const decompressed = zlib.inflateSync(Buffer.from(match[1], 'binary')).toString('utf-8');
        const extracted = decompressed.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ');
        if (extracted.length > 20) textBlocks.push(extracted);
      } catch (e) {}
    }
    textContent = textBlocks.join('\n');
    if (!textContent) {
      textContent = pdfStr.replace(/[^\x20-\x7E\n\r\t]/g, ' ').slice(0, 5000);
    }
  } else {
    textContent = fs.readFileSync(filePath, 'utf-8');
  }

  const prompt = `Analyze the following document content (${path.basename(filePath)}):\n\n${textContent.slice(0, 6000)}\n\nTask: ${query}`;
  const response = await chat([
    { role: 'user', content: prompt }
  ], { systemPrompt: 'You are Ghost Document Intelligence Agent. Provide detailed, structured summaries and answer document questions accurately.' });

  return {
    filePath,
    filename: path.basename(filePath),
    charCount: textContent.length,
    analysis: response
  };
}

async function run(task = 'summarize resume') {
  let filePath = '/Users/manojkumarmathangi/Downloads/Manoj_Kumar_Resume.pdf';
  const pathMatch = task.match(/(\/[^\s]+|\w+\.(?:pdf|txt|md|doc|docx))/i);
  if (pathMatch && fs.existsSync(pathMatch[1])) {
    filePath = pathMatch[1];
  }

  try {
    const res = await processDocument(filePath, task);
    return {
      success: true,
      data: res,
      text: `📄 **Ghost Document Intelligence: ${res.filename}** (${res.charCount} characters processed)\n\n${res.analysis}`
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      text: `[Doc Agent Error]: ${err.message}`
    };
  }
}

module.exports = { run, processDocument };
