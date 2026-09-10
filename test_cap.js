import memoryTools from './src/tools/memory.js';
const { saveMessage, getHistory, clearHistory } = memoryTools;

const USER = 'cap_test_user';
clearHistory(USER);

console.log("Pushing 25 messages into history...");
for (let i = 1; i <= 25; i++) {
  saveMessage(USER, 'user', `Message ${i}`);
}

const history = getHistory(USER, 40);
console.log(`History length is now: ${history.length}`);
console.log(`First message: ${history[0].content}`);
console.log(`Last message: ${history[history.length - 1].content}`);
