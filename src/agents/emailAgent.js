const nodemailer = require('nodemailer');
const { chat } = require('../tools/llm');

async function getGoogleAuthService() {
  return await import('../../services/googleAuth.js');
}

function getTransport() {
  return nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
}

function checkPublicModeWrite(userContext) {
  if (process.env.GHOST_DEPLOYMENT_MODE === 'public' && (!userContext || !userContext.isAdmin)) {
    throw new Error('Access Denied: Sending emails is restricted to admin clearance in public deployment mode.');
  }
}

async function sendEmail({ to, subject, body }, userContext) {
  checkPublicModeWrite(userContext);
  const triggerSource = userContext?.triggerSource || 'automated_flow';
  console.log(`[Security Audit] emailAgent.sendEmail triggered by source: ${triggerSource}`);
  if (triggerSource !== 'user_message') {
    throw new Error(`Email Agent blocked: Sending emails is restricted in automated or background flows (trigger source: ${triggerSource}).`);
  }

  // Check for Google OAuth token
  const userId = 'master_manoj'; // Default to admin
  const googleAuth = await getGoogleAuthService();
  const token = await googleAuth.getValidAccessToken(userId);

  if (token) {
    console.log('[Email Agent] Using direct Gmail API to send email...');
    const emailLines = [
      `To: ${to}`,
      `Subject: ${subject}`,
      `Content-Type: text/plain; charset="utf-8"`,
      `MIME-Version: 1.0`,
      ``,
      body
    ];
    const email = emailLines.join('\r\n');
    const base64EncodedEmail = Buffer.from(email)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ raw: base64EncodedEmail })
    });

    const data = await res.json();
    if (data.error) {
      throw new Error(`Gmail API send failed: ${data.error.message || JSON.stringify(data.error)}`);
    }
    return { success: true, messageId: data.id };
  }

  // Fallback to Nodemailer SMTP path
  console.log('[Email Agent] Falling back to Nodemailer SMTP for Gmail send...');
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    throw new Error('Google OAuth is not connected and GMAIL_USER/GMAIL_APP_PASSWORD variables are missing.');
  }
  const info = await getTransport().sendMail({ from: process.env.GMAIL_USER, to, subject, text: body });
  return { success: true, messageId: info.messageId };
}

async function draftEmail({ to, subject, context }) {
  const body = await chat([{ role: 'user', content: `Draft email.\nTo: ${to}\nSubject: ${subject}\nContext: ${context}` }], { systemPrompt: 'Write professional emails. Output only the body.' });
  return { to, subject, body };
}

async function composeAndSend({ to, subject, context }, userContext) {
  const { body } = await draftEmail({ to, subject, context });
  return await sendEmail({ to, subject, body }, userContext);
}

module.exports = { sendEmail, draftEmail, composeAndSend };
