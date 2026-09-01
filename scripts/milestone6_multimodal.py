import sys
import os
import time
import logging
from playwright.sync_api import sync_playwright
import pypdf

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(message)s")
audit_logger = logging.getLogger("BROWSER_AUDIT")

BROWSER_SCHEMA = {
    "type": "function",
    "function": {
        "name": "browser_read",
        "description": "Read-only browser interaction. NEVER pass form fields, submit buttons, or inputs.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {"type": "string"},
                "action": {"type": "string", "enum": ["text", "title", "screenshot"]},
                "screenshot_path": {"type": "string"}
            },
            "required": ["url", "action"]
        }
    }
}

PDF_SCHEMA = {
    "type": "function",
    "function": {
        "name": "read_pdf",
        "description": "Extract text from a PDF.",
        "parameters": {
            "type": "object",
            "properties": {
                "file_path": {"type": "string"}
            },
            "required": ["file_path"]
        }
    }
}

class MultimodalConnectors:
    def __init__(self):
        pass

    def browser_read(self, url: str, action: str, screenshot_path: str = None, **kwargs):
        # 5. HARD GUARD against side-effects
        forbidden_keys = {"fill", "click", "submit", "type", "post", "login", "password", "username"}
        if any(k in kwargs for k in forbidden_keys):
            msg = f"Operation rejected: Found forbidden arguments indicative of a side effect (write/form). Found keys: {list(kwargs.keys())}"
            audit_logger.error(f"[BROWSER REJECT] url={url} action={action} reason=\"{msg}\"")
            raise ValueError(msg)
            
        start_t = time.time()
        status = "ERR"
        
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                page = browser.new_page()
                resp = page.goto(url, timeout=30000)
                status = resp.status if resp else "UNKNOWN"
                
                result = {}
                if action == "title":
                    result['output'] = page.title()
                elif action == "text":
                    result['output'] = f"Title: {page.title()}\n\n" + str(page.evaluate("document.body.innerText"))
                elif action == "screenshot":
                    if not screenshot_path:
                        screenshot_path = f"screenshot_{int(time.time())}.png"
                    page.screenshot(path=screenshot_path)
                    result['output'] = f"Screenshot saved to {screenshot_path}"
                
                browser.close()
                latency = time.time() - start_t
                audit_logger.info(f"[BROWSER AUDIT] url={url} status={status} latency={latency*1000:.0f}ms action={action}")
                return {"returncode": 0, "output": result['output']}
                
        except Exception as e:
            latency = time.time() - start_t
            audit_logger.error(f"[BROWSER AUDIT] url={url} status={status} latency={latency*1000:.0f}ms action={action} err='{e}'")
            return {"returncode": 1, "output": str(e)}

    def read_pdf(self, file_path: str):
        try:
            with open(file_path, 'rb') as f:
                reader = pypdf.PdfReader(f)
                text = []
                for page in reader.pages:
                    text.append(page.extract_text())
                return {"returncode": 0, "output": "\n".join(text)}
        except Exception as e:
            return {"returncode": 1, "output": str(e)}

if __name__ == "__main__":
    mm = MultimodalConnectors()
    
    print("\n--- TEST 1: REAL BROWSER READ ---")
    res1 = mm.browser_read("https://en.wikipedia.org/wiki/Artificial_intelligence", "text")
    print(f"Title/Text Preview: {res1['output'][:250]}...\n")
    
    print("\n--- TEST 2: SCREENSHOT CAPABILITY ---")
    res2 = mm.browser_read("https://example.com", "screenshot", screenshot_path="example.png")
    print(f"Screenshot Result: {res2['output']}")
    os.system("ls -lh example.png")
    
    print("\n--- TEST 3: PDF EXTRACTION ---")
    res3 = mm.read_pdf("sample.pdf")
    print(f"PDF Content Preview: {res3['output'][:200]}\n")
    
    print("\n--- TEST 4: REJECT UNSAFE BROWSER ACTION ---")
    try:
        mm.browser_read("https://example.com/login", "text", fill={"username": "test"})
    except Exception as e:
        print(f"Hard Rejection Triggered: {e}")
