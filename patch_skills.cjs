const fs = require('fs');
const content = fs.readFileSync('server.js', 'utf8');

const skillsRoute = `
app.get('/api/skills', chatLimiter, securityMiddleware, (req, res) => {
    // Only return working, confirmed capabilities
    const skills = [
        {
            title: "Ordinary Chat",
            whatItDoes: "LLM-backed conversation using Groq/NVIDIA NIM fallback chain.",
            exactLimit: "No memory of other users, no autonomous action."
        },
        {
            title: "Cited News",
            whatItDoes: "Fetches up to 5 items from Google News RSS (metadata only).",
            exactLimit: "Does not open, read, or summarize full articles."
        },
        {
            title: "Scholarly Dossier",
            whatItDoes: "Fetches up to 5 records and abstracts from OpenAlex.",
            exactLimit: "Abstracts only, does not retrieve or read full papers."
        },
        {
            title: "Coding Copilot (V0)",
            whatItDoes: "Provides draft-only code and test help via the /copilot command.",
            exactLimit: "Never writes files, runs code, or touches the repository."
        },
        {
            title: "Technical Copilot (V0)",
            whatItDoes: "Generates a structured, deterministic technical plan via the 'mission:' command.",
            exactLimit: "Plan-only, deterministic template, no execution or LLM dependencies."
        }
    ];
    res.json({ success: true, skills });
});
`;

const updated = content.replace("app.post('/api/coding-copilot'", skillsRoute + "\\napp.post('/api/coding-copilot'");
fs.writeFileSync('server.js', updated);
console.log('Patched server.js for /api/skills');
