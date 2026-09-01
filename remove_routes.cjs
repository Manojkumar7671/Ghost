const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

function removeRoute(routePrefix) {
    let index = code.indexOf(routePrefix);
    while (index !== -1) {
        let startIndex = index;
        // Find the opening brace of the route handler
        let braceIndex = code.indexOf('{', startIndex);
        if (braceIndex === -1) break;
        let depth = 1;
        let i = braceIndex + 1;
        while (depth > 0 && i < code.length) {
            if (code[i] === '{') depth++;
            if (code[i] === '}') depth--;
            i++;
        }
        // Remove from the start of the line where route is defined
        let lineStart = code.lastIndexOf('\n', startIndex) + 1;
        // Check for any preceding decorators or comments? Usually just app.get(...)
        code = code.substring(0, lineStart) + code.substring(i);
        // Find next in case there are multiple (e.g. app.get and app.post for same prefix)
        index = code.indexOf(routePrefix);
    }
}

const routesToRemove = [
    "app.get('/api/daemon/status'",
    "app.post('/api/objectives'",
    "app.get('/api/objectives'",
    "app.get('/api/objectives/:id'",
    "app.patch('/api/objectives/:id'",
    "app.delete('/api/objectives/:id'",
    "app.post('/api/agent/schedule'",
    "app.get('/api/agent/schedule'",
    "app.delete('/api/agent/schedule/:id'",
    "app.patch('/api/agent/schedule/:id'",
    "app.get('/api/agent/budget-status'",
    "app.post('/api/agent/kill-switch'",
    "app.post('/api/agent/create-voice-agent'",
    "app.post('/api/voice/activate'",
    "app.post('/api/voice/transcribe'",
    "app.post('/api/voice/tts'",
    "app.post('/api/desktop/notify'",
    "app.post('/api/admin/toggle-autonomy'",
    "app.post('/api/modes/activate'" // Might be Hands-Free mode?
];

routesToRemove.forEach(removeRoute);

// Also remove any specific intervals related to daemon/schedules if they exist in server.js
fs.writeFileSync('server.js', code);
console.log("Routes removed.");
