# Phase 0: architecture and MVP

**Status:** proposed; implementation not approved. **Discovery date:** 2026-09-27. Account-specific capabilities have not been exercised. The [API discovery ledger](api-discovery.md) distinguishes documentation from actual access.

## 1. Recommended shape

Build a private, single-seller modular service, initially using TypeScript, an official MCP SDK, SQLite on local durable storage, and a separate blob directory. This is a recommendation, not a committed stack. Start with one deployment and one domain model, not microservices or one implementation per host.

```text
ChatGPT -- Secure MCP Tunnel --+
Codex ---- private HTTP MCP ---+--> authenticated tools --> domain services
Worker --- internal API -------+                            | approvals
Human ---- separate review UI ------------------------------+ policies
                                                          | eBay adapters
                                                          | SQLite + blobs
Public eBay event ingress --> durable inbox --> reconciler -+
```

OpenAI documents an outbound private tunnel, but private-app availability and photo transfer require account-level tests. The tunnel does not provide a public eBay notification receiver. See discovery sources O1-O3 and E12.

## 2. Boundary between host and service

The host interprets photographs, proposes identifications, asks about missing physical facts, writes copy, and explains recommendations from permitted evidence. The service owns UUIDs, facts and provenance, actual files, eBay retrieval, schema validation, state transitions, policy evaluation, authorization, and external actions. Model proposals are inputs, never authority.

A small human review/upload page belongs to the service. It is not a second selling application. Thin ChatGPT/Codex adapters may handle authentication or host file transport, but must not calculate permissions or own workflow state.

For the first listing adapter, prefer Trading API plus a local canonical draft, pending a tested Seller Hub edit/reconciliation path. eBay recommends Inventory API for new integrations, but documents a Seller Hub editing restriction for Inventory-created listings. Implement only one adapter initially; record the backend on every listing and never silently migrate it. See E5-E6.

## 3. Domain model

| Record | Responsibility |
|---|---|
| Item | Permanent UUID, stable SKU, physical location, disposition, identifying facts, uncertainty and verification tasks |
| Asset | Private original/public derivative, storage key, digest, content type, provenance, export permission |
| Evidence | Source, evidence kind, observed time, quality, access/data-use rights and retention |
| Draft revision | Immutable version, category, specifics, condition, photos, copy, price, shipping and policy references |
| Listing | Backend, account, environment, marketplace, external ID and observed state; multiple historical listings per item |
| Offer/order/shipment | Separate negotiation, payment, fulfillment, tracking, returns and financial reconciliation |
| Policy/rule | Versioned preferences, overrides, bounded authority grants and effective policy |
| Due action/notification | Durable work, leases, attempts, due time, deduplication, delivery/acknowledgment status |
| Action/approval/audit | Immutable proposal, authenticated authorization, execution state and tamper-evident history |

Keep CAPTURED, IDENTIFIED, RESEARCHED and DRAFTED as useful workflow milestones, but do not force every reality into one status column. HOLD and ERROR are overlays. SELL/KEEP/FUTURE_HACKING/DONATE/E_WASTE are dispositions. APPROVED describes an exact action revision, not an item forever. LISTED/SOLD/SHIPPED/COMPLETE are projections over listing/order facts.

Relisting creates another listing record without another physical UUID. Sold, paid, ready to ship, carrier accepted, delivered and financially reconciled are distinct. Completion may reopen for a return or dispute. A research stage may finish with documented gaps; it must not imply sold evidence exists.

## 4. Authorization and execution

Use three operational classes: OBSERVE, RECOMMEND and ACT. Local draft edits are ordinarily autonomous. Publishing, consequential live revisions, ending/relisting, accepting/countering/declining offers, messaging, refunds, tracking submission and postage purchases enter ACT. Changes to shared eBay business policies or native automatic-offer settings are also ACT.

Agents may prepare an immutable proposal and obtain a review URL. They cannot call a general `record_approval` tool. The seller authenticates separately, reviews the exact terms and approves through a human-only endpoint. Bind approval to seller/account, environment, item, operation, draft/policy versions, content and image hashes, monetary terms, expiry and single-use execution. Tool arguments cannot supply an approver identity or replace the approved payload.

The executor verifies authorization and fresh external state, atomically reserves the action, records intent, performs the eBay request and reconciles the result. Changes to material terms invalidate approval. A lost response becomes UNKNOWN, not permission to retry blindly. Prevent two active publications for one quantity-one item. A global production-write switch can stop execution without disabling inventory access.

A narrowly bounded automatic-action grant can be designed later with its own authenticated activation, expiry, limits, cumulative reduction cap, floor, eligible operations and revocation. An arbitrary policy edit cannot weaken baseline safeguards.

## 5. Durable follow-up

Resolve preferences deterministically through non-overridable service safety rules, seller/account defaults, marketplace defaults, category overrides, then item overrides. More-specific policy overrides only explicitly set fields. Persist duration/type, pricing mode, explicitly defined gross/net floor basis, offer settings, review/reduction timing, maximum cumulative reduction, relisting criteria, notifications and handling expectations. Preserve the effective policy version and each field's origin.

Strategy and authority are separate. A preference such as “review after seven days” or “offers enabled” does not authorize a live mutation. Ordinary policy editing can change OBSERVE/RECOMMEND behavior, while any future automatic ACT permission is a separately authenticated, narrowly bounded authority grant.

When a listing becomes LISTED, the service persists its effective policy and first `next_due_at`. An eBay event or timer makes work due. Any authorized worker claims a lease, synchronizes permitted observations, evaluates deterministic rules, persists a recommendation or action proposal, schedules the next obligation and writes a deduplicated notification. A restart or expired lease must not erase work. Multiple hosts must not duplicate actions. Event and timer triggers converge on this same durable queue.

Use events where actually supported, with periodic reconciliation for missed events and delayed metrics. Treat unavailable, stale and zero-valued metrics differently. A low-activity rule requires adequate metric coverage rather than treating missing traffic as zero. Notify promptly upon receipt, not with a guarantee that eBay and a host deliver in real time. A no-op stays silent; a prolonged sync failure, buyer problem or approaching fulfillment deadline is actionable.

Post-sale follow-up continues through distinct order facts such as paid/ready-to-ship, tracking submitted, carrier acceptance, delivery and financial reconciliation. A sale is not COMPLETE, and a completed transaction may reopen for a return/dispute. Inventory summaries keep unsold asking value, known acquisition cost, estimated net proceeds and realized/reconciled proceeds separate.

ChatGPT routines are an optional scheduler adapter, subject to a real custom-tool execution test. A service worker plus system timer is the reliable baseline. LLM work needs an explicitly configured runner; it cannot happen merely because a due row exists. Policy correctness does not depend on a living conversation.

## 6. Credentials, storage and audit

Separate client-to-MCP authentication from service-to-eBay OAuth. Use least-privilege client roles and method allowlists even when an eBay scope is broad. Keep tokens encrypted server-side with the wrapping key outside SQLite; lock refresh per account, use returned expiry, and pause external jobs on revocation/reconnect errors. Keep sandbox and production credentials, identifiers and data isolated. Never turn a sandbox request into a production fallback. See E16 and the scope matrix.

Use SQL migrations, foreign keys, version comparisons and transactional outbox/inbox tables. SQLite lives on local service storage, not a network filesystem. Blob keys pass through a storage interface so later object-storage migration does not change item identity. Back up a consistent database snapshot and referenced files, with a separately protected key-recovery process; test restoration.

Trace every invocation with operation ID, authenticated caller/client, item UUID, sanitized input summary, outcome/error, external identifiers, timestamps and approval references. Audit consequential intent and result append-only with chained digests and separately retained checkpoints; this is tamper-evident, not magically administrator-proof. Keep deletable buyer details separate from audit metadata, and account for deletion obligations and identifiable hashes. See E17.

Production secrets and data must be inaccessible to coding-agent shells. MCP permissions are ineffective if a worker can read the token vault, alter the database, control the service container, or reuse the seller's browser session. Treat buyer messages, listing descriptions and uploaded documents as untrusted content, never instructions.

## 7. First complete vertical slice

**Readiness:** prove private connection, durable photo ingestion, eligible eBay account/scopes, data-use permissions, and the selected listing adapter. Market-derived pricing remains disabled until its permission gate is resolved; a seller-set price is an explicit fallback, not claimed completion of automated valuation.

**Sandbox:** known item/photo → UUID/private assets → provenance and missing-fact checks → permitted current research → Taxonomy/Metadata requirements → versioned local draft → non-publishing verification → separate human approval → publish/readback → durable follow-up. Use synthetic sandbox data.

**Production canary:** one seller, one marketplace, quantity one, one approved fixed-price listing. Store the listing ID and next follow-up atomically with reconciled publication. Prove restart recovery and a due observation/recommendation that cannot change price. Basic order observation and pack/ship reminders may follow; no automatic offers, messages, labels or refunds.

Acceptance tests include forged approvals, changed draft/image/policy invalidation, duplicate publication attempts, ambiguous responses, external edits, expired tokens, event replay, unknown metrics, silent no-ops, backup restoration and prevention of secret exposure. A price/fee estimate is not a guarantee; review tolerances and unsupported limits explicitly.

## 8. Decisions still requiring resolution

The recommended defaults are Trading-first, local canonical drafts, human-only approvals and observe/recommend-only follow-up. Before building, resolve eBay data-use consent and production access; verify actual ChatGPT plan/mobile/file/scheduled-tool support; confirm the Seller Hub recovery path; and choose the service host, identity provider, notification channel and seller shipping/return policies. None of those account or deployment changes were performed during Phase 0.

Proposed later layout: `src/domain`, `src/mcp`, `src/ebay`, `src/auth`, `src/storage`, `src/workers`, `src/review`, `migrations`, `tests`, and thin `clients/chatgpt` / `clients/codex` configuration. No placeholder runtime directories are represented as implemented features.
