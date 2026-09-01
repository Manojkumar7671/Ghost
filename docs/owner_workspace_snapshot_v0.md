# Owner Workspace Snapshot V0

## 1. Purpose and non-goals
The Owner Workspace Snapshot V0 makes existing owner Tasks and Goals visible. It does not create, update, delete, execute, schedule, or autonomously decide anything.

## 2. Owner and visitor boundary
The screen is owner-only in intended product behavior; visitor UI must not reveal task, goal, memory, queue, system-detail, or action-authority content. Client-side hiding is not server authorization. Server-side enforcement is a separate implementation requirement.

## 3. Proposed interaction
The owner explicitly opens the snapshot from the existing **Open Workspace** entry. The snapshot has one visible **Back to chat** path. There is no auto-open and no auto-refresh. Any actual DOM identifier, route, component, endpoint, or event handler is `SOURCE_UNCONFIRMED — decision required before implementation`.

## 4. Read-only snapshot content
The snapshot is a two-section display only:
- **Tasks:** title, existing status, optional linked-goal label, and an optional existing blocker reason if already supplied by the approved task source.
- **Goals:** title, existing status, and optional existing note if already supplied by the approved goal source.
The exact existing source/response contract is `SOURCE_UNCONFIRMED — decision required before implementation` unless separately evidenced. No fields, counts, priorities, deadlines, task operations, goal operations, storage, memory, or data sources are invented here.

## 5. Presentation states
The product states are: loading, no saved Tasks/Goals, unavailable/not authorized, and ordinary read-only display.

## 6. Manual refresh boundary
V0 has no automatic refresh, polling, schedule, watcher, background worker, webhook, or retry. A future manual owner-triggered refresh, if separately designed and authorized, must disclose scope and return concise evidence; it is out of scope for V0.

## 7. Accessibility and safe exit
Readable status text, keyboard reachability, visible focus, Escape/Back close behavior, focus return to the opener, and an ordinary non-destructive failure state are required. Exact focus implementation is `SOURCE_UNCONFIRMED — decision required before implementation`.

## 8. Explicit exclusions
- Task/goal mutation
- Auto-fetch
- Agent fleets, self-delegation, approval execution
- Queues
- Tests
- Terminal/filesystem/browser/Mac/device control
- Arbitrary URLs/scraping/crawling
- Accounts/credentials, external messaging/payments
- Voice/hands-free
- Database/schema change, persistence
- Schedules/workers/webhooks/background loops
- Provider/model changes
- PM2, deployment, and Git

## 9. Future implementation decisions
The following must be separately evidenced and approved before an implementation prompt:
- Exact data source/response shape
- Server-side authorization point
- Allowed files
- Test strategy
- Manual refresh decision
- Empty/error behavior
- Separate owner browser check
Design approval would not authorize implementation.

## 10. Decision statement
**This document is design-only. It authorizes no source change, UI change, server route, data access, persistence, external request, background work, owner action, or autonomy capability.**
