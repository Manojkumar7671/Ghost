require('dotenv').config();
const scheduler = require('./src/agents/scheduler.js');
setTimeout(async () => {
  await scheduler.scheduleTask('test_persisted_job', '* * * * *', 'generateBriefing', 'Test Job');
  console.log("Tasks after schedule:", scheduler.listTasks());
  setTimeout(() => process.exit(0), 1000);
}, 2000);
