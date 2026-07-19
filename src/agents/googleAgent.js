const { safeFetch } = require('../../services/urlSafety.js');

async function getGoogleAuthService() {
  return await import('../../services/googleAuth.js');
}

// Check public mode write permissions
function checkPublicModeWrite(userContext) {
  if (process.env.GHOST_DEPLOYMENT_MODE === 'public' && (!userContext || !userContext.isAdmin)) {
    throw new Error('Access Denied: Writing actions are restricted to admin clearance in public deployment mode.');
  }
}

async function listUnreadEmails(userId) {
  const googleAuth = await getGoogleAuthService();
  const token = await googleAuth.getValidAccessToken(userId);

  if (token) {
    console.log('[Google Agent] Using direct Gmail API to list unread emails...');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=1', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.error) {
      throw new Error(`Gmail API Error: ${data.error.message}`);
    }
    if (!data.messages || data.messages.length === 0) {
      return { success: true, count: 0, emails: [] };
    }
    // Fetch details of the first message
    const msgId = data.messages[0].id;
    const detailsRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const msgDetails = await detailsRes.json();
    
    // Extract headers (Subject, From, Date)
    const headers = msgDetails.payload?.headers || [];
    const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '(No Subject)';
    const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || '(Unknown)';
    const date = headers.find(h => h.name.toLowerCase() === 'date')?.value || '';
    const snippet = msgDetails.snippet || '';

    return {
      success: true,
      count: data.resultSizeEstimate || 1,
      emails: [{ id: msgId, from, subject, date, snippet }]
    };
  }

  // Fallback to Apps Script webhook
  const webhookUrl = process.env.APPS_SCRIPT_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error('Google OAuth is not connected and APPS_SCRIPT_WEBHOOK_URL is not set.');
  }
  console.log('[Google Agent] Falling back to Apps Script webhook for Gmail...');
  const res = await safeFetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'listEmails' })
  });
  const data = await res.json();
  return data;
}

async function createCalendarEvent(userId, userContext, details) {
  checkPublicModeWrite(userContext);

  const googleAuth = await getGoogleAuthService();
  const token = await googleAuth.getValidAccessToken(userId);
  const { summary, description, startTime, endTime } = details;

  if (token) {
    console.log('[Google Agent] Using direct Google Calendar API to create event...');
    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        summary,
        description,
        start: { dateTime: startTime },
        end: { dateTime: endTime }
      })
    });
    const data = await res.json();
    if (data.error) {
      throw new Error(`Calendar API Error: ${data.error.message}`);
    }
    return { success: true, eventId: data.id, htmlLink: data.htmlLink };
  }

  // Fallback to Apps Script webhook
  const webhookUrl = process.env.APPS_SCRIPT_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error('Google OAuth is not connected and APPS_SCRIPT_WEBHOOK_URL is not set.');
  }
  console.log('[Google Agent] Falling back to Apps Script webhook for Calendar...');
  const res = await safeFetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'createEvent', payload: { summary, description, startTime, endTime } })
  });
  const data = await res.json();
  return data;
}

async function appendSheetsValue(userId, userContext, details) {
  checkPublicModeWrite(userContext);

  const googleAuth = await getGoogleAuthService();
  const token = await googleAuth.getValidAccessToken(userId);
  const { spreadsheetId, range, values } = details;

  if (token) {
    console.log('[Google Agent] Using direct Google Sheets API to append values...');
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values })
    });
    const data = await res.json();
    if (data.error) {
      throw new Error(`Sheets API Error: ${data.error.message}`);
    }
    return { success: true, updatedCells: data.updates?.updatedCells };
  }

  // Fallback to Apps Script webhook
  const webhookUrl = process.env.APPS_SCRIPT_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error('Google OAuth is not connected and APPS_SCRIPT_WEBHOOK_URL is not set.');
  }
  console.log('[Google Agent] Falling back to Apps Script webhook for Sheets...');
  const res = await safeFetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'appendSheet', payload: { spreadsheetId, range, values } })
  });
  const data = await res.json();
  return data;
}

module.exports = {
  listUnreadEmails,
  createCalendarEvent,
  appendSheetsValue
};
