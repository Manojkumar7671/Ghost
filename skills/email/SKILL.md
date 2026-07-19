---
name: email
description: Manage emails, including drafting and sending emails via Gmail or scheduling events on Calendar.
tags: [email, gmail, mail, calendar, calendar_event, send]
triggers: [email, draft email, send email, mail, calendar, calendar event]
---

# Email Skill

Use this skill when you need to draft or send emails, or check/manage calendar events. Under the hood, this routes to `emailAgent.draftEmail()` and `emailAgent.composeAndSend()`.

## Usage Guidelines
- Provide valid recipient addresses, subject lines, and content context.
- Always check that the recipient is specified.
