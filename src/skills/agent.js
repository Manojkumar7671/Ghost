const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MAX_STEPS = 6;

async function reactLoop(userGoal, availableSkills) {
  let scratchpad = [];
  let step = 0;

  while (step < MAX_STEPS) {
    step++;

    const prompt = `You are a reasoning agent. Use ReAct format.\n\nGoal: ${userGoal}\n\nAvailable skills: ${availableSkills.join(", ")}\n\nScratchpad so far:\n${scratchpad.join("\n") || "None"}\n\nNow respond with EXACTLY this format:\nThought: <your reasoning>\nAction: <skill_name> | <input>\n\nOr if done:\nThought: <final reasoning>\nAnswer: <final answer to user>`;

    const res = await groq.chat.completions.create({
      model: "llama3-70b-8192",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 400,
    });

    const text = res.choices[0].message.content.trim();
    scratchpad.push(`[Step ${step}]\n${text}`);

    if (text.includes("Answer:")) {
      const answer = text.split("Answer:")[1].trim();
      return { success: true, answer, steps: scratchpad };
    }

    const actionMatch = text.match(/Action:\s*(\w+)\s*\|\s*(.+)/);
    if (actionMatch === null) break;

    const skillName = actionMatch[1];
    const input = actionMatch[2];

    let observation = "Skill not found.";
    try {
      const skill = require(`./${skillName}`);
      const result = await skill.run({ query: input });
      observation = typeof result === "string" ? result : JSON.stringify(result);
    } catch (e) {
      observation = `Error: ${e.message}`;
    }

    scratchpad.push(`Observation: ${observation}`);
  }

  return { success: false, answer: "Max steps reached.", steps: scratchpad };
}

module.exports = { name: "agent", description: "Multi-step ReAct reasoning agent for complex multi-action goals", run: async ({ query }) => {
  const skills = ["weather", "web_search", "hacking"];
  const result = await reactLoop(query, skills);
  return result.answer;
}};

// Ghost skill metadata
module.exports.name = "agent";
module.exports.description = "Multi-step ReAct reasoning agent — use for complex goals requiring multiple actions";
