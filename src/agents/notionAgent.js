const axios = require('axios');
const { chat } = require('../tools/llm');
const BASE = 'https://api.notion.com/v1';
const h = () => ({ Authorization: `Bearer ${process.env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' });

async function searchPages(query) {
  const res = await axios.post(`${BASE}/search`, { query, filter: { property: 'object', value: 'page' } }, { headers: h() });
  return res.data.results.map(p => ({ id: p.id, title: p.properties?.title?.title?.[0]?.plain_text || 'Untitled', url: p.url }));
}
async function createPage(parentPageId, title, content) {
  const res = await axios.post(`${BASE}/pages`, {
    parent: { page_id: parentPageId },
    properties: { title: { title: [{ text: { content: title } }] } },
    children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content } }] } }]
  }, { headers: h() });
  return { success: true, id: res.data.id, url: res.data.url };
}
async function appendToPage(pageId, content) {
  await axios.patch(`${BASE}/blocks/${pageId}/children`, { children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content } }] } }] }, { headers: h() });
  return { success: true };
}
module.exports = { searchPages, createPage, appendToPage };
