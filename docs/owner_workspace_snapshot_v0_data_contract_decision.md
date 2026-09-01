# Owner Workspace Snapshot V0 Data-Contract Decision

## 1. Purpose and non-goals
This document is a design-only decision for comparing two possible future directions regarding the Owner Workspace Snapshot V0. It is an intentionally opened, owner-only, read-only presentation of existing Tasks and Goals. It recommends no code, route, component, endpoint name, data field, database, or client behavior as already approved.

## 2. Accepted source evidence
The only accepted source evidence is:
- `authenticateOwner(req)` returns a server-verified `{ ownerId, isOwner: true }` only when the JWT role is `admin`.
- The current owner task-read chat branch invokes `getPersonalOverview(chatOwner.ownerId, pool)`.
- `getPersonalOverview` returns a top-level envelope containing `success`, `continuationSummary`, `goals`, `recentMemories`, `tasks`, and totals.
- The exact fields inside individual Task and Goal items are **not** yet evidenced.
- No separately consumable owner-only Snapshot API was evidenced.
The existing overview envelope is evidence only; it is not proof of a separately consumable Snapshot API.

## 3. Candidate A — dedicated owner-only read contract
A possible future, server-verified read path that may return the minimum audited Tasks/Goals snapshot needed by the owner UI. Any future Candidate A must use the canonical server-side owner identity from `authenticateOwner(req).ownerId`, or a separately evidenced equivalent. UI visibility, CSS hiding, or a client mode flag is never authorization.

## 4. Candidate B — decline Snapshot implementation
Retain the current chat-only overview path and do not expose a separate UI data contract.

## 5. Minimum data contract — SOURCE_UNCONFIRMED
Every individual Task/Goal display field is `SOURCE_UNCONFIRMED — decision required before implementation` until one separate field audit proves it. Do not invent identifiers, titles, statuses, notes, dates, priorities, goals links, or sort order. Neither candidate is selected or implemented by this document. Selection requires a separate owner decision after the required field audit.

## 6. Server-side authorization and failure boundary
Any future Candidate A must use the canonical server-side owner identity from `authenticateOwner(req).ownerId`, or a separately evidenced equivalent. UI visibility, CSS hiding, or a client mode flag is never authorization. A future denied, unavailable, malformed, or failed read must reveal no private Task, Goal, memory, queue, system, or authorization detail. It must fail closed and stop.

## 7. Read-only and refresh boundary
The future snapshot can never create, edit, delete, complete, reorder, confirm, execute, queue, approve, or mutate a Task or Goal. No auto-open, polling, periodic refresh, background refresh, schedule, worker, webhook, cache, retry, or silent fallback. Any future owner refresh is explicit, one-at-a-time, and requires a separately approved implementation contract.

## 8. Privacy and visitor boundary
Visitors receive no Snapshot, Task, Goal, memory, queue, system-detail, or action-authority exposure. No new persistence, database/schema/files, durable memory, external request, account connection, credentials, browser/device control, agent coordination, or provider/model change.

## 9. Required field audit before any implementation
A later implementation can be considered only after one read-only field audit completes that identifies the exact current Task and Goal item fields, ownership rules, and safe response shape.

## 10. Required future implementation evidence
A later implementation can be considered only after all of these separate steps complete:
1. One read-only field audit that identifies the exact current Task and Goal item fields, ownership rules, and safe response shape.
2. A separate owner decision selecting Candidate A or Candidate B.
3. If Candidate A is selected, one tightly scoped implementation prompt with exact permitted files, canonical server-side authorization, explicit allowed response fields, fail-closed errors, no mutation, no automatic refresh, and no scope expansion.
4. A source audit of that implementation, then a focused static/source validation, and only then an optional owner browser check.

## 11. Decision statement
This document is a design-only data-contract decision. It authorizes no source change, UI change, server route, task/goal data access, persistence, external request, background work, owner action, or autonomy capability. It does not select Candidate A or Candidate B and does not authorize implementation.
