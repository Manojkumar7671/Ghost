# Owner Workspace Snapshot V0 Candidate A Implementation Contract

## 1. Purpose and decision status
This is a Candidate A **design-only** implementation contract. It records a possible minimal owner-only read contract for future consideration. It neither implements nor authorizes the Snapshot.

## 2. Verified source evidence
| Verified source facts | Unverified assumption |
| --- | --- |
| `getPersonalOverview(ownerId, dbPool)` visibly rejects missing or non-string owner input; calls `listOwnerGoals(ownerId, dbPool)` and `listPersonalTasks(ownerId, dbPool)`; and returns their values as `goals` and `tasks`, alongside `success`, `continuationSummary`, `recentMemories`, `totalGoals`, `totalMemories`, and `totalTasks`. | That its input validation itself authenticates the owner. |
| The visible Task **database-row branch** maps these fields: `id`, `ownerId`, `goalId`, `goalTitle`, `title`, `description`, `status`, `blockerReason`, `kind`, `createdAt`, and `updatedAt`. | The shape and field safety of in-memory Task and Goal fallback records. |
| The visible Goal **database-row branch** maps these fields: `id`, `ownerId`, `title`, `note`, `status`, `kind`, `createdAt`, and `updatedAt`. | An existing separately consumable Snapshot API or server route. |
| The visible Task and Goal database queries each pass `String(ownerId)` into an owner-filtered query. | Any current route’s exact response status/body behavior for Snapshot requests. |
| Canonical server-side ownership uses `authenticateOwner(req).ownerId`; client display or hiding is not authorization. | Browser/UI rendering behavior, client authorization, runtime data, database contents, tests, and end-to-end behavior. |
| `getPersonalOverview` supplies returned `goals` and `tasks` through the visible owner-parameterized helpers. | Exact implementation mechanism for server-side response normalization, if needed. |

## 3. Candidate A boundary
Candidate A is a possible **separate, owner-only, read-only** contract for Tasks and Goals. It is not current behavior and must never be described as already implemented or already routed. Client presentation is never authorization, and the future route/contract must derive owner identity only from `authenticateOwner(req).ownerId` or a separately evidenced equivalent.

## 4. Proposed minimum stable Snapshot response
The following is a **proposed design target, not verified current behavior and not implementation instruction**:
```
success
tasks
goals
totalTasks
totalGoals
```
`continuationSummary`, `recentMemories`, and `totalMemories` are outside the proposed Snapshot minimum and must not be added by implication.

| Collection | Proposed item fields | Evidence status |
| --- | --- | --- |
| Tasks | `id`, `goalId`, `goalTitle`, `title`, `description`, `status`, `blockerReason`, `kind`, `createdAt`, `updatedAt` | The visible database-row branch maps these fields; fallback record shape is `SOURCE_UNCONFIRMED — decision required before implementation`. |
| Goals | `id`, `title`, `note`, `status`, `kind`, `createdAt`, `updatedAt` | The visible database-row branch maps these fields; fallback record shape is `SOURCE_UNCONFIRMED — decision required before implementation`. |

`ownerId` is **not** a proposed Snapshot item field, even though the visible database-row branches map it, because it is not needed for an owner viewing their own Snapshot. This is a privacy-minimizing design decision, not a claim about current output.

Exposing any additional field, exposing raw fallback records, or returning items without a separately accepted stable-field decision is prohibited. Do not choose or invent a normalization mechanism.

## 5. Server-side authorization and fail-closed boundary
1. A future separate Snapshot request must derive its identity server-side from `authenticateOwner(req).ownerId` or a separately evidenced equivalent.
2. Missing, invalid, or non-owner authorization must fail closed before retrieving or returning Snapshot data.
3. Client-provided owner IDs, client display state, and client-only hiding cannot authorize the request.
4. Failure responses must not reveal Task/Goal content, record existence, counts, field names, database details, memory data, or internal implementation details.
5. The exact route, status codes, response body, and error implementation remain `SOURCE_UNCONFIRMED — decision required before implementation`.

## 6. Read-only, refresh, and fallback boundary
Candidate A permits only a one-shot owner-initiated read. It permits no creation, update, deletion, save, task execution, goal mutation, approval action, action proposal, persistence, caching, automatic refresh, polling, background work, worker, schedule, webhook, retry, fallback to another data source, or silent retry.

The shown helper fallback records exist as a source fact, but their shape and safe exposure remain `SOURCE_UNCONFIRMED — decision required before implementation`. A future implementation must fail closed rather than return a raw/unvalidated fallback record, unless a separate design decision and evidence accept a safe stable-field path.

## 7. Privacy and visitor boundary
Visitors must receive no Snapshot content, counts, field hints, authorization detail, or existence signal. The owner-only route boundary must be server-enforced; client hiding is presentation only. Candidate A must not expose `ownerId` in Snapshot items and must not include `recentMemories`, `continuationSummary`, or unrelated personal data.

## 8. Required future implementation evidence
| Required proof | What it must establish | Not proved by this document |
| --- | --- | --- |
| Narrow source implementation audit | The exact modified source files, canonical server-owner derivation, stable-field handling, fail-closed path, and absence of out-of-scope features | That code works at runtime or in a browser |
| Focused static/source validation | The future contract’s declared boundaries and regressions | Server authorization or live behavior |
| Owner-led browser check | Owner presentation and safe empty/error state after separately accepted validation/load evidence | Visitor/server security or end-to-end security |
| Separate visitor/server authorization evidence | Server-enforced denial without private detail | Client hiding, screenshots, or static tests alone |

## 9. Explicit exclusions
This Candidate A design excludes and does not authorize arbitrary files, terminal or device control, browser automation, network or external requests, scraping/crawling/URLs, credentials/accounts, external messages/payments, legacy agents/voice/hands-free/companions, agent fleets, schedules/workers/webhooks/background loops, retries, provider/model/timeout changes, database/schema changes, deployment, PM2, and Git.

## 10. Decision statement
> This document is a design-only Candidate A implementation contract. It selects no implementation and authorizes no source change, UI change, server route, task/goal data access, persistence, external request, background work, owner action, test, runtime action, browser action, process action, credential/account action, deployment, Git action, or autonomy capability. Any future implementation requires a separate explicit owner decision and the evidence gates stated above.
