const pool = require('../db/pool.js');
const { chat } = require('../tools/llm.js');

/**
 * Extracts a skill from a successful PEVR task run, if it looks repeatable.
 */
async function extractSkillCandidate(goal, taskResult, trajectory) {
    if (!pool) return null;

    const trajSummary = trajectory
        .filter(t => t.type === 'command_finished' || t.type === 'thought')
        .map(t => `[${t.type}]: ${JSON.stringify(t.details)}`).join('\n');

    const prompt = `You are an expert systems engineer extracting reusable skills from a successful task execution.
Task Goal: "${goal}"
Final Result: ${JSON.stringify(taskResult)}
Execution Trajectory (Tool calls & Thoughts):
${trajSummary.substring(0, 5000)}

Analyze the task. Is this a highly repeatable, generalized procedure?
Conditions for extracting a skill:
1. It is a structured process (e.g., reversing a string, building a specific boilerplate, converting a file format).
2. It can be parameterized (e.g., specific file paths or string literals can be abstracted into an input_schema).
3. It does not rely on one-off user data that wouldn't apply elsewhere.

If it is NOT repeatable, respond with exactly "NOT REPEATABLE".
If it IS repeatable, respond with a JSON object containing:
{
  "name": "short_snake_case_name",
  "description": "Clear description of the skill",
  "input_schema": { "type": "object", "properties": { "arg1": { "type": "string" } }, "required": ["arg1"] },
  "steps": ["Step 1...", "Step 2..."],
  "risk_ceiling": "low|medium|high",
  "auto_promote": boolean (false if it involves file writes, deletes, or external sends)
}`;

    try {
        const response = await chat([{ role: 'user', content: prompt }], { maxTokens: 800 });
        const clean = response.trim().replace(/^```json/, '').replace(/```$/, '').trim();
        
        if (clean === "NOT REPEATABLE") {
            console.log("[SkillService] Task deemed not repeatable. No skill extracted.");
            return null;
        }

        const skillDef = JSON.parse(clean);

        // Force manual review for risky actions
        let status = 'candidate';
        const riskyWords = ['write', 'delete', 'save', 'send', 'network', 'post'];
        const isRisky = riskyWords.some(w => goal.toLowerCase().includes(w) || JSON.stringify(skillDef.steps).toLowerCase().includes(w));
        
        if (skillDef.auto_promote && !isRisky) {
            status = 'approved';
        }

        const definition = {
            input_schema: skillDef.input_schema,
            steps: skillDef.steps,
            required_tools: [],
            risk_ceiling: skillDef.risk_ceiling
        };

        const res = await pool.query(
            `INSERT INTO skills (name, description, definition, status) 
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [skillDef.name, skillDef.description, JSON.stringify(definition), status]
        );
        
        console.log(`[SkillService] Extracted skill '${skillDef.name}' with status '${status}'`);
        return res.rows[0].id;

    } catch (e) {
        console.error('[SkillService] Skill extraction failed:', e.message);
        return null;
    }
}

module.exports = { extractSkillCandidate };
