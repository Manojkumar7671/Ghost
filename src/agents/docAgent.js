const fs = require('fs');
const path = require('path');
const { chat } = require('../tools/llm');

/**
 * PageIndex - Reasoning-Based Document Indexer
 * Builds a hierarchical section/page index with titles and summaries,
 * then uses LLM reasoning to target precise pages rather than raw cosine distance chunking.
 */
async function buildPageIndex(textContent, chunkSize = 2500) {
  const pages = [];
  let offset = 0;
  let pageNum = 1;

  while (offset < textContent.length) {
    const chunk = textContent.slice(offset, offset + chunkSize);
    const cleanText = chunk.replace(/\s+/g, ' ').trim();
    const isRepetitive = /(.)\1{30,}/.test(chunk);
    const firstLine = cleanText.split('\n')[0] || `Section ${pageNum}`;
    const cleanTitle = firstLine.slice(0, 80).replace(/[^\w\s-]/g, '');
    
    pages.push({
      page: pageNum,
      title: cleanTitle || `Section ${pageNum}`,
      summary: isRepetitive ? '[Repetitive Padding Data]' : cleanText.slice(0, 300),
      isRepetitive,
      text: chunk
    });

    offset += chunkSize;
    pageNum++;
  }

  return pages;
}

async function queryWithPageIndex(pages, query) {
  if (pages.length <= 2) {
    // Short document — pass full text directly
    const fullText = pages.map(p => p.text).join('\n\n');
    return await chat([
      { role: 'user', content: `Document Content:\n${fullText.slice(0, 15000)}\n\nQuery: ${query}` }
    ], { systemPrompt: 'You are Ghost Document Intelligence Agent. Answer accurately based on the document.' });
  }

  // 1. Filter out repetitive padding pages for selection unless query is about padding
  const informativePages = pages.filter(p => !p.isRepetitive);
  const searchSet = informativePages.length > 0 ? informativePages : pages;

  // 2. Send page index hierarchy to LLM for reasoning-based page selection
  const indexSummary = searchSet.slice(0, 30).map(p => `Page ${p.page} [${p.title}]: ${p.summary}`).join('\n');
  const selectionPrompt = `You are a Document Indexing Reasoner (PageIndex). Below is the hierarchical index of key document sections:\n\n${indexSummary}\n\nUser Query: "${query}"\n\nIdentify the 1 to 4 most relevant Page numbers that contain the information to answer this query. Respond ONLY with a JSON array of numbers, e.g. [1, 2].`;

  let selectedPages = [searchSet[0]?.page || 1];
  try {
    const selectionRes = await chat([{ role: 'user', content: selectionPrompt }], { maxTokens: 50 });
    const jsonMatch = selectionRes.match(/\[[\d\s,]+\]/);
    if (jsonMatch) {
      selectedPages = JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    selectedPages = [searchSet[0]?.page || 1];
  }

  // 3. Fetch full targeted text from selected pages
  const targetedPages = pages.filter(p => selectedPages.includes(p.page));
  const targetedText = (targetedPages.length > 0 ? targetedPages : searchSet.slice(0, 2))
    .map(p => `--- Page ${p.page}: ${p.title} ---\n${p.text}`)
    .join('\n\n');

  console.log(`[PageIndex] Reasoning selected pages [${selectedPages.join(', ')}] out of ${pages.length} total pages (${targetedText.length} targeted chars)`);

  // 4. Generate final answer using targeted text
  const finalPrompt = `Analyze the targeted document pages below:\n\n${targetedText}\n\nTask: ${query}`;
  return await chat([
    { role: 'user', content: finalPrompt }
  ], { systemPrompt: 'You are Ghost Document Intelligence Agent. Provide detailed, structured summaries and answer document questions accurately.' });
}

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

  // Build PageIndex hierarchical tree and query via reasoning page selection
  const pageIndex = await buildPageIndex(textContent);
  const response = await queryWithPageIndex(pageIndex, query);

  return {
    filePath,
    filename: path.basename(filePath),
    charCount: textContent.length,
    pageCount: pageIndex.length,
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
      text: `📄 **Ghost Document Intelligence (PageIndex): ${res.filename}** (${res.charCount} chars, ${res.pageCount} indexed pages)\n\n${res.analysis}`
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      text: `[Doc Agent Error]: ${err.message}`
    };
  }
}

module.exports = { run, processDocument, buildPageIndex };
