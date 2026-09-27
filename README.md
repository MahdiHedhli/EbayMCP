# EbayMCP

A proposed, harness-independent selling-lifecycle service for Operation Declutter: from a physical item's photos to a fast, reviewed eBay listing or auction, then through sale follow-up, fulfillment, and reconciliation.

**Status: Phase 0 architecture proposal, September 27, 2026. No runtime implementation, connected seller account, or production actions.**

ChatGPT and Codex are clients of the same service. The service owns the minimum durable sale record, eBay access, policy, workflow state, approvals, and audit history. Hosts may supply vision, writing, and scheduling; they do not supply authorization merely by claiming that the seller approved something.

## Design review

- [Architecture and MVP](docs/phase-0-architecture.md)
- [API discovery, permissions, limitations, and primary sources](docs/api-discovery.md)
- [Proposed MCP contracts and persistent follow-up policy](docs/mcp-contracts.md)
- [Agent development guardrails](AGENTS.md)

The first production milestone is one correctly identified item, a fixed-price-versus-auction recommendation, a shipping estimate protected by the seller's default 25% safety margin, one complete draft, one authenticated human approval, one verified listing, and a restart-safe follow-up obligation. Broad offer automation, messaging actions, postage purchases, refunds, and large-scale publishing are not part of this first milestone.

Important research gates include eBay data-use permission for market-derived pricing, production API entitlement, ChatGPT private-app access, photo transfer, and a tested manual seller recovery path. See the discovery document; an API existing is not proof this application may use it or send its data to an external model.

## Repository boundaries

This repository contains public documentation and, after approval, application source and synthetic tests. It must never contain seller OAuth credentials, production databases, private photos, buyer information, shipping labels, or production API payloads. Runtime data belongs in a separately protected service volume, not a checkout accessible to coding agents.

The proposed implementation layout is documented, not scaffolded as working functionality. Do not treat this proposal as authorization to connect an account, publish inventory, subscribe to external services, or deploy infrastructure.
