# Ghost Functional Audit

## Phase 0 — Baseline & Discovery
- **Original behavior**: The application initializes an Express server, serving static assets (HTML/JS) for a Web UI and Holographic 4D visualization.
- **Root Cause (Pre-existing failures)**: `npm test` fails with `ECONNREFUSED` because the test suite `integration_stress_test.js` attempts to hit `localhost:3000` without spinning up the server internally.
- **Server framework**: Express.js
- **Auth model**: Custom timing-safe passphrase hash comparison issuing JWT tokens.
- **Persistence**: Supabase (PostgreSQL via `pg`).
- **LLM module**: `llmRouter.js` (`callLLM`), handling multiple provider endpoints.
- **Voice routes**: Browser-based `SpeechRecognition` and `speechSynthesis` natively managed in `public/ghost-ui.js`, with telephony hooks in `services/telephonyBridge.js`.

## Authentication and Session
- **Original behavior**: `ghost_owner_clearance` (the plaintext admin passphrase) is stored in browser `localStorage` and sent inside the JSON body of `/api/verify-auth` requests to validate the session on refresh.
- **Root Cause**: The client-side code bypasses the HTTP-only `ghost_session` cookie for persistent re-authentication.
- **Selected Repair**: 
  - Remove `localStorage.getItem/setItem('ghost_owner_clearance')` from `ghost-ui.js`.
  - Refactor `/api/verify-auth` to derive identity strictly from `req.cookies.ghost_session`.
  - Add `POST /api/logout` to clear cookies.

## LLM Run Controller
- **Original behavior**: `/api/chat` processes requests linearly without deduplication. FreeLLMAPI rate limits cause the server/client to crash the task immediately without recovery.
- **Root Cause**: Lack of a centralized run state map, retry logic with backoff, and a cancellation `AbortController`.
- **Selected Repair**: 
  - Implement a `runController` Map storing `{ runId, status, abortController }`.
  - Enforce one active run per session (returning 409).
  - Wrap provider calls in exponential backoff (max 3 retries) and expose `/api/runs/:runId/cancel`.

## Voice & Hands-Free Reliability
- **Original behavior**: Voice states are handled by loose global booleans (`isHandsFreeActive`, `recognitionActive`). Microphone initiates and occasionally falls into overlapping loops or stuck TTS states.
- **Selected Repair**: Centralize voice logic into a finite state machine (`idle`, `listening`, `speaking`). Clear media streams explicitly upon mode exit or error.

## Safe Coding-Agent Plans & Approvals
- **Original behavior**: Local side effects run implicitly if the text output implies success.
- **Selected Repair**: Enforce typed status checks and explicit `/api/runs/:runId/approve` endpoints. Prevent execution until cryptographically validated by the authenticated session.

## Attachments & Defensive Boundaries
- **Original behavior**: Links parse into raw `href` without secure targets, and large payloads process indiscriminately.
- **Selected Repair**: Limit HTML generation to `target="_blank" rel="noopener noreferrer"`. Enforce server-side file caps.
