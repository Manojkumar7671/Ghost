const jwt = require('jsonwebtoken');
require('dotenv').config();
const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const { execSync } = require('child_process');
const port = process.env.PORT || 8080;
const cmd = `curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer ${token}" -d '{"message":"Ghost, please tell me who I am. Am I a guest visitor?", "user":"Manoj"}' http://127.0.0.1:${port}/api/chat`;
console.log(`Executing on port ${port}...`);
console.log(execSync(cmd).toString());
