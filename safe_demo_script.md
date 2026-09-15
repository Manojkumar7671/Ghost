# Ghost End-to-End Demo Script (Phase 7)
*Estimated Duration: 2-3 minutes. All paths and data are non-sensitive.*

## Scene 1: Goal Generation & Sandbox Execution
1. **User:** "Write a simple Node script that prints 'Hello Ghost Demo'."
2. **Ghost:** Analyzes intent. Maps to `TASK`.
3. **Action:** Spawns a `mini-swe-agent` task. Ghost writes `demo.js`, executes it in the isolated temporary workspace, and verifies the `Hello Ghost Demo` stdout. 
4. **Result:** Task succeeds.

## Scene 2: Research & Memory Pipeline (Phase 3)
1. **User:** "Look up the standard port for the Vite dev server."
2. **Action:** Ghost runs web research via Playwright headless browser.
3. **Knowledge Extraction:** Ghost abstracts the fact "Vite defaults to port 5173" and stages it in `knowledge_items`.
4. **Approval:** The UI prompts the user to verify the candidate fact. The user clicks "Approve". Ghost now "knows" this fact permanently.

## Scene 3: Skill Curation Loop (Phase 4)
1. **User:** "Save the Node script generation as a repeatable skill."
2. **Action:** Ghost runs the skill extractor. It reads the trajectory from Scene 1, identifies hardcoded values (like the string to print), and parameterizes them into a reusable `input_schema` (e.g. `message: string`).
3. **Approval:** Ghost creates a candidate skill. User reviews and approves it. Ghost can now natively trigger `generate_node_script(message)`.

