# Agent guardrails

## Current phase

Phase 0 is discovery and design. No implementation or deployment is authorized by this documentation change. Wait for the project owner's architecture decision before starting a build slice. A documentation merge alone does not authorize live seller-account actions.

## Invariants for later implementation

1. Keep business logic, durable state, seller policy, eBay credentials, and authorization in the service. ChatGPT/Codex configuration and skills are thin adapters.
2. Do not expose generic eBay HTTP/XML execution, arbitrary SQL, filesystem traversal, token retrieval, or arbitrary network fetching through MCP.
3. Agents can prepare action proposals, but cannot mint human approvals, choose an approver identity, activate broader ACT permissions, or use an approval portal with agent credentials.
4. Every consequential action requires the central authorization path. A prompt, tool annotation, client confirmation, or claimed user approval is not an authorization credential.
5. Treat API entitlement, OAuth scope, data-use permission, and human action approval as independent gates. Unknown permissions fail closed. No scraping or manual-import workaround may bypass a data-use restriction.
6. Never describe active asking prices as verified sales. Keep evidence type, provenance, capture time, freshness, and uncertainty. Model confidence is not a calibrated probability unless demonstrated.
7. Missing metrics are unknown, not zero. A sale event is not proof of payment, dispatch, delivery, or financial finality.
8. Isolate production service credentials/data from coding-agent shell access. No production secrets, real buyer data, private images, labels, or databases in Git, fixtures, logs, prompts, or tool responses.
9. Keep public listing photos separate from private originals. Validate actual file bytes; remove private identifiers and location metadata before approved external use.
10. Use optimistic versions, transactional action reservations, idempotency keys, durable queues, and reconciliation. An ambiguous external write is UNKNOWN; never blindly retry publication.
11. Scheduled clients share the service's due-action queue. No chat is the source of truth. Repeated no-op evaluations remain silent; meaningful sync failures must not remain silently hidden.
12. Use synthetic fixtures and an isolated sandbox. Production canary publication requires explicit human approval of the exact item, terms, environment, and proposed action.

## Evidence discipline

Record source URLs, verification date, account-specific probe status, deprecations, and known gaps. Preserve discovery failures as limitations rather than inventing capabilities. Check current method documentation and release/deprecation notices before implementing an adapter.
