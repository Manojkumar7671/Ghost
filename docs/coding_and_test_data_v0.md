# Ghost — Coding and Test Data V0

## 1. Purpose and decision status
This is a design for an owner-controlled, **text-only, draft-only** coding aid. It can help a user understand manually supplied code or errors, review code conceptually, draft tests, and draft clearly labelled synthetic test fixtures. No implementation is selected or authorized.

## 2. Accepted evidence and source limits
No current Ghost route, input format, authorization behavior, persistence behavior, model behavior, repository access behavior, or visitor behavior is established by this document. 

Every such unspecified fact is:
`SOURCE_UNCONFIRMED — decision required before implementation`

## 3. Proposed V0 interaction boundary
Proposed interaction:
1. A person manually pastes ordinary text, code, or an error message into the existing normal chat input and explicitly sends it.
2. Ghost returns a bounded text draft or explanation.
3. The person remains responsible for review, testing, and any later action outside this V0.

The exact request recognition, message limit, and implementation mechanism are `SOURCE_UNCONFIRMED — decision required before implementation`.

## 4. Allowed draft-only outputs
| Category | Proposed V0 result |
| --- | --- |
| Code explanation | A plain-language explanation of manually supplied text/code. |
| Conceptual code review | Potential defects, maintainability concerns, or security observations from manually supplied text/code. |
| Test draft | Human-reviewable test cases or test-file text; it must never run them. |
| Synthetic test fixtures | Clearly labelled example data for testing only; it must never claim the examples are real, collected, validated, or production-safe. |

Every output is advisory draft text only: Ghost must not write files, apply patches, run code, execute tests, invoke commands, access a repository, inspect a device, or make external requests.

## 5. Input, privacy, and fail-closed boundary
V0 is restricted to content that a person intentionally pastes and sends. It must not obtain code, data, files, URLs, browser content, device content, contacts, emails, credentials, or repository material by itself.

Credentials, tokens, private keys, unnecessary personal data, and sensitive production data must not be supplied. A future implementation must fail closed rather than process unsafe inputs, but the precise screening and error mechanism are `SOURCE_UNCONFIRMED — decision required before implementation`.

## 6. Test-data and training boundary
- Synthetic fixtures are proposed testing examples only, clearly labelled as synthetic, and must be reviewed by the user.
- They are not repository training data, collected data, or an approval to train, fine-tune, evaluate, upload, retain, or share a model/dataset.
- Existing repository data is outside this V0. Its provenance, licence, privacy, current use, retention, and evaluation requirements remain `SOURCE_UNCONFIRMED — decision required before implementation`.
- No model training, fine-tuning, persistent learning, bulk data collection, external upload, or dataset creation is part of V0.

## 7. Owner and visitor boundary
Client-side presentation is never authorization. Any future owner-only extension must derive ownership server-side using accepted canonical source evidence or newly evidenced equivalent behavior; the exact endpoint and implementation remain `SOURCE_UNCONFIRMED — decision required before implementation`.

No user may receive another person’s pasted content, task, goal, workspace data, or private coding context. All visitor behavior beyond that is `SOURCE_UNCONFIRMED — decision required before implementation`.

## 8. Explicit exclusions
Explicitly excluded from this V0:
- repository/file-system inspection, terminal/command execution, test execution, code modification, patch application, PM2/process control, Git, deployment, database/schema changes, and browser/device control;
- arbitrary URLs, web search, scraping, crawling, arbitrary APIs, external requests, background fetching, schedules, workers, webhooks, monitoring, automatic refresh, retry loops, agents, delegation, self-approval, or autonomy;
- credentials, accounts, Google/Gmail/Drive/Docs access, email sending, external messaging, payments, phone/SMS/calls, contacts, notifications, or phone pairing;
- model/provider/timeout changes, model training, fine-tuning, persistent learning, data ingestion, data retention, external uploads, and training-data creation or use;
- voice, hands-free, companion, or legacy agent behavior.

## 9. Required future implementation evidence
Required before any future implementation decision:
1. a separately scoped source audit proving the exact current chat entry point and any relevant server-side authorization boundary;
2. an owner decision on the minimum request/response contract, unsafe-input handling, output labels, and whether owner-only gating is needed;
3. a separately approved, minimal implementation handoff;
4. a post-change source audit and focused validation that proves no file, command, repository, network, persistence, training, or external side effect can occur;
5. only after those steps, an optional owner-led browser check.

None of those future steps are approved by this document.

## 10. Decision statement
> This document is a design-only Coding and Test Data V0 contract. It selects no implementation and authorizes no source change, UI change, server route, repository or file access, code or test execution, training-data use, model training, persistence, external request, account or credential access, device or phone action, background work, test, runtime action, browser action, process action, deployment, Git action, or autonomy capability. Any future implementation requires a separate explicit owner decision and the evidence gates stated above.
