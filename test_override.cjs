require('dotenv').config({ override: true });
const { exec } = require('child_process');
exec('uv run python -c "import os; print(os.environ.get(\\"GROQ_API_KEY\\"))"', { cwd: './mini-swe-agent' }, (e, out) => console.log(out));
