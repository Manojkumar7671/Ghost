const email = require('../agents/emailAgent');
module.exports = {
  name: 'email',
  description: 'Draft or send emails',
  triggers: ['email','send mail','draft email','write email'],
  async run(args) {
    const task = args.task || args.query || args.message || '';
    try {
      const result = await email.run(task, []);
      return { text: result.result || result.text || JSON.stringify(result) };
    } catch(e) { return { text: `Email skill failed: ${e.message}` }; }
  }
};
