const jwt = require('jsonwebtoken');
require('dotenv').config();
const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const { execSync } = require('child_process');
const cmd = `curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer ${token}" -d '{"message":"Hello Ghost. Who am I?", "user":"Manoj"}' http://127.0.0.1:3000/api/chat`;
console.log(execSync(cmd).toString());
