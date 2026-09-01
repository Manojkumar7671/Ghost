const fs = require('fs');
let content = fs.readFileSync('public/ghost-ui.js', 'utf8');

// We'll replace the fetch call URL logic.
const fetchTarget = `
            let targetUrl = apiUrl('/api/chat');
            if (payload.message && payload.message.trim().toLowerCase().startsWith('/copilot ')) {
                targetUrl = apiUrl('/api/coding-copilot');
                payload.message = payload.message.substring(9).trim();
            }

            const response = await fetch(targetUrl, {
`;

content = content.replace("const response = await fetch(apiUrl('/api/chat'), {", fetchTarget);

fs.writeFileSync('public/ghost-ui.js', content);
console.log('Patched ghost-ui.js');
