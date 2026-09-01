# Ghost — Autonomy Architecture V1 (Design Only)

**Author:** Architecture Design  
**Target System:** Ghost Private Local AI Workspace  
**Owner:** Mathangi Manoj Kumar  
**Status:** Design Proposal & Decision Record (No Runtime / Source Changes)  

---

## 1. Purpose and Non-Goal

The goal of Ghost Autonomy Architecture V1 is to establish a **controlled owner-operated workspace**, not an "unlimited admin" system or autonomous agent engine. Autonomy within Ghost is strictly defined as follows: **Ghost may prepare bounded, explainable proposals; meaningful effects still require a narrowly defined authority path and explicit owner evidence.**

This document is a formal design proposal and decision record. It creates **no implementation, permissions, background process, code, schema, or runtime change** in the existing Ghost workspace.

---

## 2. Non-Negotiable System Invariants

All future design and implementation phases must adhere strictly to these non-negotiable principles:

1. **Owner identity is required for any private data or action proposal.** Private workspace information and capability proposals are restricted strictly to the authenticated owner.
2. **Visitors receive no private workspace data, action controls, queue detail, or internal system claims.** Visitor access remains strictly informational and bounded.
3. **A proposal is not authority.** Preparing or formatting a proposal grants zero execution rights. Authority is granted exclusively by explicit owner confirmation.
4. **Every action must have a declared scope, effect, non-effect, expiry, one-use confirmation, consume-before-execution behavior, and concise evidence afterward.**
5. **Fail closed on missing identity, expired/consumed approval, ambiguous scope, unsupported source, or execution error.** Any uncertainty immediately halts execution without side effects.
6. **No silent retries, capability broadening, or "done" claims without evidence.** Side effects must never be repeated automatically or reported as completed without empirical proof.
7. **Kill switches must disable capability classes immediately and default to disabled for new capability types.** Any new or existing capability must be off by default until explicitly enabled by the owner.
8. **All implementation phases require separate source audit and separate runtime validation before acceptance.** Design approval does not authorize deployment or implementation without explicit step-by-step verification.

---

## 3. Four Capability Tiers

The system classifies all potential operations into four strict tiers:

| Tier | Name | May Do | Must Not Do |
| --- | --- | --- | --- |
| **T0** | Inform and Draft | Explain, summarize, draft, fill a chat composer, propose a plan | Fetch automatically, mutate data, execute tools, claim completion |
| **T1** | Owner-Requested Bounded Read | Perform an explicit owner-requested, allowlisted read such as the accepted cited research route | Arbitrary URL access, scraping/crawling, account ingestion, persistence by default, background refresh |
| **T2** | Owner-Confirmed Bounded Action | Execute one allowlisted action only after an expiring, one-use owner confirmation and consume-before-action | Retries, chaining, scope expansion, arbitrary terminal/browser/device access |
| **T3** | Deferred High-Risk Integrations | Describe only as future evaluation topics | Implement, enable, or imply approval for messaging, payments, credentials, devices, browser control, arbitrary terminal, or account connections |

---

## 4. Proposed Agent Model: Coordinators, Not an Unbounded Fleet

The orchestrator in Ghost is designed as a **proposal coordinator, not an executor**. Future agent capabilities are structured around exactly four conceptual roles:

| Role Name | Operating Tier | Permitted Scope | Explicit Boundaries |
| --- | --- | --- | --- |
| **Research Scout** | T1 only | Owner-requested bounded cited research | Cannot crawl, browse arbitrary URLs, store results, or schedule itself |
| **Task Planner** | T0 only | Turns an owner goal into an explicit draft plan | Cannot create, edit, or execute tasks without a separately accepted path |
| **Verifier** | T0 / T2 Boundary | Explains existing test evidence and proposes allowlisted checks | Cannot execute any test or check without the existing confirmation lifecycle |
| **Approval Coordinator** | Governance | Records/provides human-readable proposal preview, expiry, status, and evidence links | Must never approve proposals itself or execute unconfirmed proposals |

*Architectural Boundary Statement:* These are **logical roles** for structuring proposals, not permission to add a concurrent "agent fleet," background event loop, multi-agent runtime, or autonomous process. Any future agent role must be introduced singly through a separate design proposal, implementation, static source audit, and owner-led validation.

---

## 5. Future Auto-Fetching: Explicit Opt-In Design Envelope

Auto-fetching is evaluated strictly within a bounded design envelope. It is **not authorized** by this document.

| Question | Design Position | Not Authorized by This V1 |
| --- | --- | --- |
| **Manual vs. Automatic Fetching** | Manual owner-initiated requests are default; auto-fetch requires explicit opt-in | Automatic fetching without explicit owner trigger or configuration |
| **Source Scope** | Public allowlisted domain registries only (e.g., OpenAlex, RSS) | Arbitrary URL fetching, web scraping, crawling, or unvalidated endpoints |
| **Execution Pattern** | One-shot bounded reads with explicit limits | Background monitoring, continuous polling, webhooks, or daemon loops |
| **Data History** | Ephemeral in-memory summary for active session | Automatic database ingestion, raw article storage, or background indexing |
| **Visibility Boundary** | Strictly owner-visible local presentation | Visitor access, external API exposure, or unauthenticated rendering |
| **Content Processing** | Bounded factual metadata and citations | Full-text article opening, arbitrary code execution, or unverified claims |

*Design Guardrail:* A future auto-fetch capability is **not approved** merely because it is designed here. Before implementation is considered, it must possess an explicit owner configuration surface, a named source allowlist, an execution budget, a frequency ceiling, an immediate kill switch, a no-retry policy, an evidence record schema, and a separate privacy/retention specification.

---

## 6. Authority and Approval Lifecycle

All owner-confirmed operations must follow a strict 6-step authority lifecycle:

1. **Capability Open:** Owner explicitly opens or requests a specific bounded capability.
2. **Proposal Preview:** Ghost presents a clear, human-readable preview displaying: exact rationale (why), specific scope, expected effect, non-effects, source/action identity, and expiration timestamp.
3. **Owner Confirmation:** Owner explicitly confirms the single specific proposal.
4. **Proposal Consumption:** The proposal state is consumed (invalidated) *before* a single bounded attempt is launched.
5. **Execution & Evidence Report:** Ghost executes the single attempt and returns a concise evidence report containing explicit success, failure, or unsupported status.
6. **Hard Stop on Failure:** Any error or failure immediately halts processing. No automatic retries, fallbacks, or substituted actions occur.

*Default Expiry Baseline:* A **five-minute maximum expiry** and **one-use owner-keyed proposal isolation** serve as the mandatory design baseline for any future confirmation lifecycle, subject to separate source validation.

---

## 7. Data, Memory, and Privacy Classes

Data within Ghost is categorized into five distinct classes with predefined retention and visibility rules:

| Data / Memory Class | Default Retention / Visibility Rule | Architectural Status |
| --- | --- | --- |
| **Public Bounded Research Metadata** | Ephemeral or session-scoped; owner-visible only | Present Now (via accepted research routes) |
| **Transient Owner Session Context** | Session-scoped; explicitly clearable by owner; owner-visible | Present Now (via explicit chat session) |
| **Explicit Owner-Approved Durable Records** | Stored locally; owner-only access; explicit owner deletion | Future Design Only (requires schema review) |
| **Credentials & Connected-Account Data** | Strict isolation; zero persistent plain-text storage | Prohibited / Deferred |
| **Visitor-Visible Content** | Public landing info only; zero access to private state or controls | Present Now (strictly isolated) |

---

## 8. Kill Switches and Observable State

### Capability Registry Concept
Every future capability must be formally defined within a conceptual Capability Registry with the following explicit schema:
- **Capability Identifier:** Unique string key.
- **Tier Assignment:** T0, T1, T2, or T3.
- **Default State:** Disabled (Off).
- **Visibility:** Owner-only.
- **Allowed Inputs / Sources / Actions:** Strictly allowlisted parameters.
- **Maximum Scope Boundary:** Hard ceiling on resources or items affected.
- **Expiry Window:** Maximum 5-minute validity.
- **Evidence Schema:** Structured outcome payload.
- **Kill-Switch State:** Active / Hardware-Software Disabled.

*Note:* This registry is a document-level architectural concept only. No registry code, data structures, or implementations are created by this document.

### Observable Capability Status Screen Concept
The owner interface must provide a transparent status view reflecting the precise state of all registered capabilities:
- `Available`: Configured, owner-authenticated, and ready for explicit request.
- `Disabled`: Inactive by default or toggled off via kill switch.
- `Needs Approval`: Proposal prepared; awaiting owner confirmation.
- `Not Configured`: Missing owner parameters or endpoints.
- `Unsupported`: Explicitly excluded from system capabilities.

The status screen must **never** imply background activity, silent monitoring, hidden access, or automatic completion.

---

## 9. Explicitly Excluded Until Separate Decisions

The following capability classes are **explicitly excluded** from V1 design and implementation:

- Arbitrary terminal command execution and filesystem mutation;
- Browser control, macOS system control, device interaction, or direct UI automation;
- Arbitrary URL fetching, web scraping, crawling, and legacy web-agent execution paths;
- Voice synthesis/recognition, wake-word detection, TTS, Hands-Free Mode, companion loops, or agent activation;
- External messaging, social media posting, financial transactions, purchases, or funds transfers;
- Credential ingestion, secrets management, or third-party account linking;
- Scheduled background jobs, cron workers, webhooks, persistent monitors, polling loops, retries, and background daemons;
- Provider, model, or network timeout modifications;
- Database schema migrations, production deployments, and automated Git actions.

---

## 10. Staged Future Decision Roadmap

Any future development must proceed strictly through five sequential, independent decision stages:

| Stage | Focus | Required Evidence | Hard Stop Condition |
| --- | --- | --- | --- |
| **Stage 1** | Design Review & Registry Contract | Signed design spec & static schema definition | Any ambiguity in boundary or tier assignment |
| **Stage 2** | Owner-Requested Bounded Read Proposal | Static test proving 0 auto-fetches & 0 background activity | Any unrequested network attempt or unlisted source |
| **Stage 3** | Single Proposal-Only Agent Role | Static test proving 0 execution rights & T0/T1 restriction | Any attempt to execute actions or create multi-agent loops |
| **Stage 4** | Auto-Fetch Envelope Evaluation | Owner configuration UI spec, kill-switch proof, budget limits | Any background persistence or missing kill switch |
| **Stage 5** | Production Readiness Audit | Dual static-source audit and empirical owner validation | Any failure in isolation, evidence logging, or owner control |

*Constraint:* Each stage represents **a separate future choice**, not an automatic mandate for implementation.

---

## 11. Owner Decisions Required Before Any Future Build

Before any code for future autonomy or fetching is written, the owner (**Mathangi Manoj Kumar**) must review and decide upon the following 8 questions:

1. **Source Categories:** Which specific public sources (e.g., OpenAlex, specific RSS feeds) should be permitted for bounded reads?
2. **Data Retention:** What exact retention period should apply to research metadata versus session context?
3. **Fetch Frequency:** What strict rate limit and frequency ceiling should be enforced on T1 read operations?
4. **Maximum Parallelism:** Should all fetch operations be strictly capped at sequential execution (max parallelism = 1)?
5. **Evidence Retention:** How long should execution evidence records be retained before automatic local cleanup?
6. **Immediate Kill Switch:** Should a global master toggle be placed on the header to instantly disable all T1/T2 capabilities?
7. **Personal-Data Boundaries:** What sanitization rules must filter query parameters before sending external requests?
8. **Action Lifecycle:** Should all future workspace updates remain strictly proposal-only requiring explicit owner confirmation?

---
