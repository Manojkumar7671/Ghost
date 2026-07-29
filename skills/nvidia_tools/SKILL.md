---
name: nvidia_tools
description: Access NVIDIA NIM APIs for heavy compute tasks (OCR, Content Safety, AIQ Orchestration).
tags: [nvidia, ocr, safety, aiq, orchestration, extract text, content moderation]
triggers: [extract text from image, moderate content, check safety, orchestrate tasks, run aiq]
---

# NVIDIA Tools Skill Knowledge & Rules

You are equipped with NVIDIA tools for offloading heavy compute tasks to cloud external APIs, specifically via NVIDIA NIM.

Use the `nvidia_tools` tool with the appropriate `actionType` to perform these operations:

## 1. Nemotron OCR v2 (`actionType: 'ocr'`)
- Use this to extract text from documents, images, or PDFs instead of running a local parsing library.
- **Input:** Provide `details.fileUrl` or `details.content`.
- **Rule:** Required for processing uploaded images/documents containing text.

## 2. Nemotron 3.5 Content Safety (`actionType: 'safety'`)
- Use this to moderate messages before sending them or to check if a user prompt is safe.
- **Input:** Provide `details.text`.
- **Rule:** Call this if the system policy requires message moderation or before generating risky output.

## 3. AIQ Orchestration Helper (`actionType: 'aiq'`)
- Use this to plan, route, and orchestrate complex tasks when `TASK_ROUTE_MODE` prevents using the local multi-agent orchestrator.
- **Input:** Provide `details.task` containing the complex user request.
- **Rule:** If the local orchestrator is blocked, fallback to AIQ to map out the execution plan.

**Usage Note:** All calls are logged to `/logs/nvidia_actions.log`.
