const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MAX_STEPS = 6;

async function reactLoop(userGoal, skillsObj) {
  let scratchpad = [];
  let step = 0;
  const availableSkills = Object.keys(skillsObj).filter(k => k !== "agent");

  while (step < MAX_STEPS) {
    step++;

    const prompt = `You are a reasoning agent. Use ReAct format.\n\nGoal: ${userGoal}\n\nAvailable skills: ${availableSkills.join(", ")}\n\nScratchpad:\n${scratchpad.join("\n") || "None"}\n\nRespond EXACTLY:\nThought: <reasoning>\nAction: <skill_name> | <input>\n\nOr if done:\nThought: <reasoning>\nAnswer: <final answer>`;

    const res = await groq.chat.completions.create({
      model: "llama3-70b-8192",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 400,
    });

    const text = res.choices[0].message.content.trim();
    scratchpad.push(`[Step ${step}]\n${text}`);

    if (text.includes("Answer:")) {
      return text.split("Answer:")[1].trim();
    }

    const actionMatch = text.match(/Action:\s*(\w+)\s*\|\s*(.+)/);
    if (actionMatch === null) break;

    const skillName = actionMatch[1];
    const input = actionMatch[2].trim();

    let observation = "Skill not found.";
    if (skillsObj[skillName]) {
      try {
        const result = await skillsObj[skillName].run({ query: input, location: input }, { groq });
        observation = result.text || JSON.stringify(result);
      } catch (e) {
        observation = `Error: ${e.message}`;
      }
    }

    scratchpad.push(`Observation: ${observation}`);
  }

  return "Could not complete the task in max steps.";
}

module.exports = {
  name: "agent",
  description: "Multi-step ReAct reasoning agent for complex multi-action goals",
  run: async (args, ctx) => {
    const skillsObj = ctx && ctx.skills ? ctx.skills : {};
    const answer = await reactLoop(args.query, skillsObj);
    return { text: answer };
  }
};
