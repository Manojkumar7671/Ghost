---
name: browser_automation
description: Perform browser automation actions such as navigating to a URL, scraping dynamically loaded elements, or clicking elements using Playwright/Browserbase.
tags: [browser_automation, scrape, playwright, browserbase, view]
triggers: [navigate, scrape page, open url, screenshots, dynamic elements, browser]
---

# Browser Automation Skill

Use this skill when you need to load a webpage dynamically, execute actions, or scrape data that requires Javascript rendering. Under the hood, this routes to `browserbaseClient.executeTool()`.

## Usage Guidelines
- Provide the target URL and the actions to execute.
- Best for pages that require interaction or have client-side JavaScript.
