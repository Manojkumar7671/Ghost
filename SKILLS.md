# GHOST AGENT SKILL MATRIX

## 1. OPTICAL ANALYSIS
- Capability: NVIDIA Llama-3.2-90B-Vision.
- Protocol: Active frame capture via WebRTC.
- Use Case: Screen element extraction, text resolution, physical object identification.
- Constraint: Feed must be live to prevent hallucination.

## 2. ORACLE ACCESS
- Capability: Tavily Web-Search API.
- Protocol: <search> [Query] </search>.
- Use Case: Live news, market trends, technical research.
- Constraint: No code block formatting for search summaries.

## 3. AGENTIC NAVIGATION
- Capability: Browser Control.
- Protocol: <open> [URL] </open>.
- Use Case: Navigating to authenticated portals or specific documentation.

## 4. ADMINISTRATIVE CONTROL
- Capability: Camera/Screen Triggering.
- Protocol: [trigger_camera] or [trigger_screen].
- Use Case: Initiating physical or digital surveillance.
- Constraint: ONLY on explicit command. NO autonomous triggering.

