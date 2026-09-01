# T1 Bounded Research Preview V0 (Design)

## 1. Purpose and Non-Goal
The future T1 Bounded Research Preview V0 flow helps the owner understand and explicitly continue one bounded research request before any read occurs. It is not an autonomous agent, browser, scraper, scheduler, monitor, connected-account system, or general web-search tool.

This document itself makes **no source, UI, server, process, browser, network, authority, storage, or runtime change**.

## 2. Existing Capability Boundary

| Existing accepted fact | Future preview implication | Not established by this document |
| --- | --- | --- |
| Cited research is manual and bounded to named RSS/OpenAlex-style metadata sources | The preview must name the applicable fixed source class before continuation | Exact implementation route, parser, and provider details |
| Results are bounded citations/headlines and do not open articles | The preview must declare metadata-only/no article-opening behavior | Any arbitrary webpage or full-text access |
| Manual operation is the current safe default | No automatic initiation, refresh, schedule, or monitoring | Any background worker or recurring task |
| New persistence is not approved | Preview/request/evidence state must be transient by default | Database, schema, file, or durable retention design |
| Owner identity is required for private data or action proposals | A future implementation must use the canonical server-side owner identity path | Client-side visibility as an authorization proof |

## 3. One-Request Owner Flow
1. The owner manually enters a bounded research request in normal chat.
2. Ghost checks whether the request is eligible for the named source class and whether it contains disallowed personal/credential content.
3. If eligible, Ghost returns a **preview only**; it does not fetch.
4. The preview lists the topic, source class, maximum-result limit, expected output, non-effects, personal-data boundary, and a concise expiry/one-use statement.
5. The owner explicitly continues that exact preview.
6. A future implementation consumes the owner-keyed one-use preview before one sequential bounded attempt.
7. Ghost returns concise cited evidence or an honest failure/unsupported result, then stops with no retry or substitution.

All steps after the current manual request are proposed future behavior only, not present functionality.

## 4. Preview Content Contract

| Preview field | Required plain-language content | Constraint |
| --- | --- | --- |
| Topic | The owner’s exact proposed research subject | No rewriting that broadens scope |
| Source class | Only an existing named RSS/OpenAlex-style allowlisted class | Never arbitrary URLs |
| Maximum result limit | A bounded small number | **`SOURCE_UNCONFIRMED — decision required before implementation`** unless using the already observed cited-research maximum of five as a proposed default |
| Expected output | Cited metadata/headlines only | No article opening or full-text summaries |
| Will not do | No scraping/crawling, arbitrary browsing, account access, credential use, persistence, task mutation, action execution, schedule, monitor, or retry | Must be stated explicitly |
| Personal-data screen | Request must fail closed when it contains credentials or unnecessary personal data | Absolute |
| Continuation | Explicit owner continuation of this one preview only | Never implied by the original request |
| Expiry and one-use | Proposed maximum five-minute, owner-keyed, transient preview | Must be consumed before the read attempt |

## 5. Authority, Privacy, and Failure Rules
1. The preview is **not** authority and must not initiate a read.
2. Client visibility is not server authorization; any future implementation must require the canonical server-side owner identity path.
3. One owner’s preview must not be readable, confirmable, or consumable by another owner/session.
4. The future default is no new persistence. No stored query history, source history, or result archive is authorized by this document.
5. A request that is unsupported, ambiguous, non-owner, expired, consumed, personally sensitive, or execution-failed returns a concise honest status and stops.
6. There is no silent retry, automatic reformulation, source substitution, scope expansion, or fallback to arbitrary web access.
7. Operations are sequential, one at a time; parallel requests/agents are not authorized.

## 6. Explicit Exclusions

| Excluded capability | Why it is excluded from this V0 design | Future decision required |
| --- | --- | --- |
| Automatic fetching, refreshes, schedules, digests, monitors, workers, webhooks, and background loops | Manual operation is the safe default for bounded research | Whether any periodic check is ever safe |
| Agent fleets, coordination runtimes, self-delegation, or self-approval | T1 is an owner-requested bounded read, not an action tier or unlimited agent behavior | Whether a separately designed T2 bounded action is ever needed |
| Arbitrary URLs, article opening, scraping, crawling, browser automation, and legacy web-agent paths | The accepted capability is named metadata sources only | If structured document fetching is needed |
| Mac, device, filesystem, terminal, or UI control | Violates isolation and local safety | None for T1 research |
| Connected accounts, credentials, secrets, external messaging, payments, purchases, or transfers | High-risk, unrelated to bounded reading | If T2 scoped actions ever permit it |
| Voice, Hands-Free Mode, wake-word, TTS, or companion/legacy-agent activation | Out of scope for a text-based preview flow | Whether multi-modal input requires distinct screening |
| Provider/model/timeout changes | T1 uses existing runtime configuration | How to handle complex prompt limits |
| Databases, schemas, files, durable memory, retention systems, deployment, PM2, and Git | No new persistence is approved | If short-term query caching is needed |

## 7. Future Implementation Decisions and Evidence Gates

| Decision needed | Safe proposed default | Evidence required before implementation | Hard stop |
| --- | --- | --- | --- |
| Exact allowable source classes | Existing named RSS/OpenAlex-style metadata source classes; never arbitrary URLs | Named fixed source-class decision and boundary audit | Any unapproved or arbitrary URL |
| Eligibility/personal-data screening criteria | Fail closed for credentials or unnecessary personal data; precise screening mechanism is SOURCE_UNCONFIRMED — decision required before implementation | Owner screening decision and focused tests only after a separate implementation decision | Silent bypassing or unapproved screening mechanism |
| Exact preview-continuation wording and interaction surface | Explicit "Confirm and Read" button in UI | UI source-level assertion | Auto-clicking |
| Owner-keyed transient state, expiry, and consume-before-read behavior | Proposed five-minute owner-keyed transient one-use preview; precise state-storage mechanism is SOURCE_UNCONFIRMED — decision required before implementation | Owner state-lifecycle decision and focused tests only after a separate implementation decision | Cross-session use or unapproved state mechanism |
| Result cap and evidence shape | 5 results maximum, strictly citations | Parser boundary audit | Unlimited fetches |
| Server-side owner authorization boundary | Canonical existing auth checks | Server endpoint security review | Client-side trust |
| No-persistence confirmation | No DB/file writes for queries | Code review of data paths | Any new table/schema |
| One-at-a-time execution and no-retry behavior | Sequential async await, fail fast | Execution trace verification | Parallel spawning |
| Kill-switch/disable state | Capability Status checks | Status integration tests | Unkillable task |
| Source audit, focused validation, and optional owner-led browser check | Exact read-only audits and UI checks | Completed validation reports | Unaudited capability |

No implementation begins until an owner separately accepts the decision and its evidence plan.

## 8. Owner Decisions Required
1. What exact named RSS or metadata source categories should be permitted in this V0?
2. Is a maximum result cap of five citations appropriate for the preview?
3. What specific personal-data/credential screening criteria should fail a request?
4. Is a five-minute transient expiry adequate for an owner continuation?
5. What should the exact continuation wording and interaction surface (e.g., button, chat command) be?
6. Is it confirmed that there will be no new evidence retention or query history beyond the session?
7. How should the kill-switch/disable state integrate with the existing Capability Status Screen V0?
8. Do you confirm that all results must strictly remain metadata and headlines with no article opening?
