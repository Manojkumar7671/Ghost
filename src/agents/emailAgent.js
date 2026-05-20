const nodemailer = require('nodemailer');
const { chat } = require('../tools/llm');

function getTransport() {
  return nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
}
async function sendEmail({ to, subject, body }) {
  const info = await getTransport().sendMail({ from: process.env.GMAIL_USER, to, subject, text: body });
  return { success: true, messageId: info.messageId };
}
async function draftEmail({ to, subject, context }) {
  const body = await chat([{ role: 'user', content: `Draft email.\nTo: ${to}\nSubject: ${subject}\nContext: ${context}` }], { systemPrompt: 'Write professional emails. Output only the body.' });
  return { to, subject, body };
}
async function composeAndSend({ to, subject, context }) {
  const { body } = await draftEmail({ to, subject, context });
  return await sendEmail({ to, subject, body });
}
module.exports = { sendEmail, draftEmail, composeAndSend };
