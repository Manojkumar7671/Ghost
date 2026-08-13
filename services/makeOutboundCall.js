import dotenv from 'dotenv';
import express from 'express';
dotenv.config();

/**
 * Initiates a real outbound phone call to a given recipient number using Twilio REST API
 * @param {string} toPhoneNumber - E.164 formatted target phone number (e.g. +917671014128)
 * @param {string} publicWebhookUrl - Publicly accessible HTTPS URL for Twilio TwiML webhook (e.g. ngrok / server)
 */
export async function makeOutboundCall(toPhoneNumber, publicWebhookUrl) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
        throw new Error(`[Twilio Outbound Error]: Missing Twilio credentials in environment (.env).
Required variables:
- TWILIO_ACCOUNT_SID: ${accountSid ? 'Present' : 'MISSING'}
- TWILIO_AUTH_TOKEN: ${authToken ? 'Present' : 'MISSING'}
- TWILIO_PHONE_NUMBER: ${fromNumber ? 'Present' : 'MISSING'}`);
    }

    // Format phone number to E.164 standard if missing country code
    let formattedTo = toPhoneNumber.trim();
    if (!formattedTo.startsWith('+')) {
        if (formattedTo.length === 10) {
            formattedTo = '+91' + formattedTo; // Default to India country code +91 for 10-digit numbers
        } else {
            formattedTo = '+' + formattedTo;
        }
    }

    console.log(`[Twilio Outbound] Initiating call from ${fromNumber} to ${formattedTo}...`);

    const twilioEndpoint = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`;
    const authHeader = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const params = new URLSearchParams();
    params.append('To', formattedTo);
    params.append('From', fromNumber);
    params.append('Url', publicWebhookUrl || `${process.env.PUBLIC_URL || 'http://localhost:3000'}/api/telephony/incoming`);

    const res = await fetch(twilioEndpoint, {
        method: 'POST',
        headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
    });

    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`[Twilio API Call Failed ${res.status}]: ${errorText}`);
    }

    const data = await res.json();
    console.log(`[Twilio Outbound Success] Call SID: ${data.sid} | Status: ${data.status} | To: ${data.to}`);
    return data;
}

// CLI Execution support
if (process.argv[1] && process.argv[1].endsWith('makeOutboundCall.js')) {
    const targetNumber = process.argv[2] || '7671014128';
    makeOutboundCall(targetNumber)
        .then(result => console.log('Outbound Call Triggered Successfully:', result.sid))
        .catch(err => console.error(err.message));
}
