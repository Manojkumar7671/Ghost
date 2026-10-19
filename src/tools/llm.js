const MODELS = ['nvidia/llama-3.1-nemotron-70b-instruct', 'auto', 'llama-3.3-70b-versatile', 'meta-llama/llama-3.3-70b-instruct', 'gemini-1.5-flash'];

async function chat(messages, options = {}) {
  if (process.env.MOCK_LLM === 'true') {
    const promptText = JSON.stringify(messages);
    if (!promptText.includes('mock_429')) {
        if (promptText.includes('critique') || promptText.includes('Critique') || promptText.includes('subtasks')) {
          return JSON.stringify({ subtasks: messages.map(m => m.content) });
        }
        if (promptText.includes('confidence') || promptText.includes('Rating') || promptText.includes('0.70')) {
          return JSON.stringify({ rating: 0.65, reasoning: "Gated for verification" });
        }
        if (promptText.includes('50-line') || (promptText.includes('scrapes a page') && promptText.includes('pydantic'))) {
          return `Assumptions: Target page is https://quotes.toscrape.com and OPENAI_API_KEY is available in the environment.

\`\`\`python
import os
import json
import urllib.request
from bs4 import BeautifulSoup
from pydantic import BaseModel, Field

class Quote(BaseModel):
    quote: str = Field(description="The quote text")
    author: str = Field(description="Author name")

def scrape_quote(url: str = "https://quotes.toscrape.com") -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as resp:
        soup = BeautifulSoup(resp.read().decode(), "html.parser")
    first = soup.select_one("div.quote span.text")
    return first.get_text(strip=True) if first else ""

def extract_structured(text: str) -> Quote:
    api_key = os.environ.get("OPENAI_API_KEY", "")
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps({
            "model": "gpt-4o-mini",
            "messages": [{"role": "user", "content": f"Extract quote: {text}"}]
        }).encode(),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
    return Quote.model_validate_json(data["choices"][0]["message"]["content"])

if __name__ == "__main__":
    t = scrape_quote()
    print("Scraped:", t[:30])
\`\`\``;
        }
        if (promptText.includes('10-line')) {
          return `Assumptions: Target page is https://quotes.toscrape.com and OPENAI_API_KEY is available in the environment.

\`\`\`python
import os
import json
import urllib.request
from bs4 import BeautifulSoup
from pydantic import BaseModel, Field

class Quote(BaseModel):
    quote: str = Field(description="The quote text")
    author: str = Field(description="Author name")

def scrape_quote(url: str = "https://quotes.toscrape.com") -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as resp:
        soup = BeautifulSoup(resp.read().decode(), "html.parser")
    first = soup.select_one("div.quote span.text")
    return first.get_text(strip=True) if first else ""

def call_llm(text: str) -> Quote:
    api_key = os.environ.get("OPENAI_API_KEY", "")
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps({"model": "gpt-4o-mini", "messages": [{"role": "user", "content": text}]}).encode(),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:
        res = json.loads(resp.read().decode())
    return Quote.model_validate_json(res["choices"][0]["message"]["content"])
\`\`\``;
        }
        return "Mock LLM Audit Response";
    }
  }
  const router = await import('../../llmRouter.js');
  const opts = typeof options === 'object' ? options : {};
  return await router.callLLM(messages, {
    systemPrompt: null,
    maxTokens: 1024,
    model: null,
    ...opts
  });
}

async function callLLM(messages, options = {}) {
  if (process.env.MOCK_LLM === 'true') {
    const text = JSON.stringify(messages);
    if (!text.includes('mock_429')) {
        return "Mock LLM Audit Response";
    }
  }
  const router = await import('../../llmRouter.js');
  return await router.callLLM(messages, options);
}

module.exports = { chat, callLLM, MODELS };
