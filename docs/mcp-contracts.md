# Proposed MCP contracts and follow-up policy

**Design only.** These are proposed application tools, not claims that eBay exposes matching endpoints. Generate strict JSON Schemas and executable contract tests only after architecture approval.

## Shared contract

Use UUIDs for local entities, typed money `{currency, minor_units}`, RFC3339 UTC instants, bounded arrays and pagination cursors. The service binds account/environment from authenticated access and stored entities; agents cannot switch an action's environment. Every mutation requires `idempotency_key`; updates also require `expected_version`. A duplicate key with different content is an error.

Return `operation_id`, `status`, `as_of`, `data`, structured `warnings`, `blockers` and `next_actions`. Include evidence references and freshness where relevant. Errors distinguish `CONFLICT`, `AUTH_RECONNECT_REQUIRED`, `CAPABILITY_UNAVAILABLE`, `DATA_USE_NOT_AUTHORIZED`, `VALIDATION_FAILED`, `APPROVAL_REQUIRED`, `APPROVAL_STALE`, `RATE_LIMITED` and `EXTERNAL_RESULT_UNKNOWN`. Never return tokens or unredacted upstream request/response bodies.

`caller` and approval identity come from authenticated context, not model-supplied fields. MCP safety annotations describe real effects and supplement, not replace, authorization. An eBay-read tool that changes local state must not claim it is wholly read-only simply to avoid host confirmations.

## First slice

Common mutation/version fields above are omitted from signatures below for readability.

| Tool | Essential contract |
|---|---|
| `get_capabilities()` | Per-module enabled/blocked/unknown status, environment, required reconnect/permission checks, schema version; no secrets |
| `create_sale_item(facts)` | Returns UUID, stable SKU and version; persists only sale-relevant facts with source/confidence labels |
| `get_item(item_id)` | Current projection, draft/listing references, blockers and next action |
| `list_sale_items(filter, cursor?, limit)` | Bounded query by sale stage, incomplete draft or attention state |
| `update_sale_item(item_id, patch)` | Allowlisted sale-fact changes only; cannot write listing status, approval or financial outcomes |
| `create_photo_upload(item_id, media_type, byte_length)` | Short-lived, bounded upload handle; host transport adapter transfers actual bytes |
| `finalize_photo(item_id, upload_id)` | Verify stored bytes, digest, type and ownership; create private asset reference |
| `list_photos(item_id)` | Private/public-derivative metadata; authorized preview links only |
| `search_active_listings(query, marketplace, filters, cursor?)` | eBay adapter retrieval only after entitlement and data-use checks; explicitly ACTIVE_ASK |
| `record_research(item_id, evidence[])` | Typed provenance and permissions; disallow unsupported verified-sale assertions |
| `recommend_sale_format(item_id, evidence_refs[])` | Fixed-price vs auction recommendation with rationale, uncertainty and evidence; no publication side effect |
| `find_categories(query, marketplace)` | Candidate leaf categories and evidence, not an authoritative visual identification |
| `get_listing_requirements(category_id, marketplace)` | Specifics, condition constraints and relevant seller requirements with freshness |
| `create_draft(item_id, content)` | Local versioned draft; no implicit eBay mutation |
| `get_draft(draft_id, version?)` | Copy, photos, price source, specifics, shipping and outstanding questions |
| `update_draft(draft_id, patch)` | New version; invalidate dependent approval proposals |
| `estimate_shipping(item_id, package?, destination_basis?)` | Base estimate plus persisted seller safety margin and protected estimate; default margin 25%; no postage purchase |
| `validate_draft(draft_id, version)` | Local checks plus supported non-publishing eBay verification; fee/protected-shipping estimates and warnings |
| `prepare_publication(draft_id, version)` | Immutable action ID, exact terms/diff, review URL and required approvals; cannot publish |
| `get_action(action_id)` | Proposal, status and redacted approval receipt; no redeemable approval secret |
| `execute_approved_action(action_id)` | Closed, server-owned action type; fresh authorization/reconciliation; no replacement payload |

No universal `manage_ebay`, generic HTTP/XML call, SQL tool, or arbitrary filesystem upload is allowed. Actual photo handoff from each host is a readiness test. Public-safe derivative selection and export authorization precede Media upload; private originals are never automatically uploaded to eBay. Material image changes invalidate an existing proposal.

Publication action states are `PREPARED → AWAITING_APPROVAL → APPROVED → EXECUTING → SUCCEEDED`, with `REJECTED`, `EXPIRED`, `REVOKED`, `FAILED` and `UNKNOWN` branches. Only a human-authenticated review endpoint can create an ordinary approval. On UNKNOWN, reconcile external state before deciding whether another request is safe.

## Policy inheritance and scheduled-work surface

Policy resolution is deterministic: service safety invariants → seller/account defaults → marketplace defaults → category overrides → item overrides. A more specific value wins only where that field is explicitly set; absence inherits and an explicit `null` has field-defined semantics. Persist the resolved policy version on each evaluation/action and expose each field's source so the seller can answer “why did it do that?”

Separate strategy from authority. A seller may configure pricing cadence, offer thresholds, listing duration, handling expectations and notifications without thereby authorizing live mutations. Automatic ACT authority, if introduced later, is a distinct bounded grant with its own authenticated human activation, eligible operations, floor/cap, expiry and revocation. Ordinary agent-facing policy tools cannot create that grant.

The service computes and persists `next_due_at` from policy plus observed events. Schedulers wake work; they do not own the schedule's meaning. Event-driven work and timer-driven work enter the same durable queue and evaluation path, so ChatGPT, Codex and a service worker cannot produce divergent behavior.

## Policy and scheduled-work surface

| Tool | Essential contract |
|---|---|
| `get_policy(item_id)` | Resolved values, source of each override, version and effective authority |
| `propose_policy_change(scope, target_id, patch)` | Versioned proposal; no silent elevation of action authority |
| `update_followup_preferences(target_id, observation_patch)` | Only allowlisted observation/reminder preferences; cannot activate ACT or widen permissions |
| `get_due_actions(before?, cursor?, limit)` | Durable pending obligations, not a promise to execute them |
| `claim_due_actions(action_ids, lease_seconds)` | Atomic bounded lease; caller identity is server-derived |
| `check_listing_status(item_id)` | Read permitted eBay state and persist observations, freshness and gaps |
| `evaluate_followup(item_id, observation_version, policy_version)` | Deterministic rule evaluation; recommendation/next-due/outbox changes only |
| `get_items_requiring_attention(filter, cursor?, limit)` | Missing facts, pending approval, stale sync, low-activity rule hit, expiring offer, buyer-message/problem signal, sale/fulfillment deadline |
| `summarize_active_inventory(filter)` | Counts, age, asking totals, known acquisition cost, explicitly labeled estimated net proceeds and realized/reconciled proceeds |
| `list_notifications(filter, cursor?, limit)` | Durable notification outbox/history with urgency, dedupe key and delivery/acknowledgment state; no buyer PII unless necessary |

This is a design inventory, not an instruction to expose every tool on day one. The MVP needs persistence and a minimal listing-status/due-evaluation path. Add `prepare_price_revision`, offer response preparation, message preparation, relist, postage and refund tools only in later accepted slices. The existing executor can dispatch new action types only after their authorization and recovery tests pass.

## Policy interpretation example

Synthetic illustration of: list at $225, check the market after seven unsold days, ask before reducing, alert on offers over $180. The price is seller-specified, not a valuation of any actual item.

```json
{
  "schema_version": 1,
  "scope": "item",
  "currency": "USD",
  "listing": {
    "initial_price_minor": 22500,
    "price_source": "seller_specified"
  },
  "offers": {
    "enable_requested": true,
    "minimum_acceptable_price_minor": null,
    "auto_accept": false,
    "auto_counter": false,
    "urgent_notice": {
      "comparison": "gt",
      "amount_minor": 18000,
      "basis": "item_price_excluding_shipping_and_tax"
    }
  },
  "followup": [{
    "anchor": "listing_published_at",
    "after": "P7D",
    "condition": "still_unsold",
    "operation": "refresh_market_and_recommend",
    "requires_permitted_market_data": true,
    "on_unavailable": "request_seller_review_without_price_recommendation"
  }],
  "live_price_changes": {
    "mode": "approval_required",
    "automatic": false
  },
  "notifications": {
    "silent_when_no_actionable_change": true
  }
}
```

Enabling offers externally is part of the approved listing/change, not an effect of saving this policy. The $180 threshold is strictly greater-than and is neither an acceptance floor nor permission to accept. Shipping/tax basis must be visible in review. Unspecified minimums, cadence, notification delivery channel and handling times remain unset or inherit visible seller defaults; do not invent them.

Seller policy includes `shipping_safety_margin_bps`, default `2500` (25%). Future preference fields include listing type/duration, initial strategy, gross/net minimum basis, first-review delay, reduction cadence, maximum cumulative reduction, minimum net proceeds, relist criteria, quiet hours, digest cadence and handling expectations. Validate these against applicable marketplace/category rules. Changing a global policy should not silently revise existing live listings: require an explicit migration scope and fresh action proposals.

A low-activity rule must name its metric, observation window, threshold, freshness and coverage. `unknown`, `not_supported`, `not_authorized` and `stale` are not numerical zero. Never infer the last week had no activity from one current watcher snapshot. Authorized market valuation remains disabled until the discovery rights gate is resolved.

Deduplicate notices by item/listing, rule version, event/observation and meaningful change. Use cooldowns and digests for low urgency, while sale/expiry/deadline events can be urgent. Record attempted and acknowledged delivery separately; do not claim a notification was received merely because it was queued.

## Lifecycle follow-up semantics

A listing entering LISTED schedules its first policy-derived obligation immediately and records the effective policy version. Follow-up can observe supported traffic signals, offers, orders, messages/problems, listing end state and fulfillment deadlines. Recommendations may use only evidence the application is entitled to use, with evidence type and freshness preserved. If comparable-sale data is unavailable or not authorized, the recommendation must say so rather than substituting active asks as sold comps.

Sale detection transitions the workflow into order/fulfillment observation, not directly to COMPLETE. “Sold”, “paid/ready to ship”, “tracking submitted”, “carrier accepted”, “delivered”, “return/dispute open” and “financially reconciled” remain distinct facts. Pack/ship reminders derive from authoritative order deadlines where available. Completion can later reopen for returns, disputes or reconciliation corrections.

Buyer messages are untrusted external content. Observation may surface a redacted summary and urgency signal when the API/data policy permits it. Any outbound message remains ACT and uses an immutable proposed response plus human approval unless a separately designed bounded grant exists.

A low-activity evaluation only fires when its configured metrics have sufficient coverage and freshness. Unknown metrics defer or produce an explicit “insufficient telemetry” recommendation. No-op checks create audit/observation records as needed but do not enqueue user-facing notifications.

## Bulk safety

A batch freezes its selected UUIDs, purpose, policy versions, stop condition and limits. Workers lease per-item tasks and record partial progress. `prepare_only` workers can research allowed sources, generate drafts and flag uncertainty, but cannot acquire execution authority. Cancellation stops future work; it does not undo a completed external action.

Future bulk approval must enumerate exact immutable action proposals, with no wildcard authorization over an evolving search result. Capture external edits before acting and stop on conflict. Report asking-price total, acquisition cost when known, estimated net proceeds and realized/reconciled proceeds as separate measures; never call unsold asking value cash.
