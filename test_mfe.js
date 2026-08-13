import workspaceTools from './src/tools/workspaceTools.js';
import { execSync } from 'child_process';
import fs from 'fs';

async function run() {
  const payload = {
    files: [
      {
        path: '/Users/manojkumarmathangi/Ghost/node_task_api/server.js',
        targetContent: 'app.get(\'/api/tasks\', (req, res) => {\n    res.json({ success: true, data: tasks });\n});',
        replacementContent: 'app.get(\'/api/tasks\', (req, res) => {\n    res.json({ success: true, data: tasks });\n});\n\napp.get(\'/api/status\', (req, res) => {\n    res.json({ status: \'ok\', version: \'1.0.1\' });\n});'
      },
      {
        path: '/Users/manojkumarmathangi/Ghost/node_task_api/package.json',
        targetContent: '  "version": "1.0.0",',
        replacementContent: '  "version": "1.0.1",'
      }
    ]
  };

  console.log('Running workspaceTools.multiFileEdit...');
  try {
    const res = await workspaceTools.multiFileEdit(payload);
    console.log('\n--- Tool Result ---');
    console.log(res);

    console.log('\n--- Git Diff ---');
    const diff = execSync('HOME=/tmp git diff', { cwd: '/Users/manojkumarmathangi/Ghost/node_task_api', encoding: 'utf8' });
    console.log(diff);
  } catch (err) {
    console.error(err);
  }
}

run();
