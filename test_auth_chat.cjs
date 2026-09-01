require('dotenv').config({ override: true });
const jwt = require('jsonwebtoken');
const token = jwt.sign({ user: 'Admin', role: 'admin' }, process.env.JWT_SECRET || 'fallback_secret', { expiresIn: '1h' });

const { execSync } = require('child_process');
try {
    const res = execSync(`curl -s -X POST http://localhost:3000/api/chat -H 'Content-Type: application/json' -b 'ghost_session=${token}' -d '{"message": "Hello", "user": "Manoj"}'`).toString();
    console.log("Chat Response:", res);
} catch (e) {
    console.error(e);
}
