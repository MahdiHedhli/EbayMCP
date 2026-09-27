# EbayMCP

A proposed, harness-independent selling-lifecycle service for Operation Declutter: from a physical item's photos to a fast, reviewed eBay listing or auction, then through sale follow-up, fulfillment, and reconciliation.

**Status: v1 foundation deployed to Cloudflare Workers with D1, September 27, 2026. Cloudflare MCP Portal and Managed OAuth are configured; user OAuth login and end-to-end client smoke tests remain. No connected eBay seller account or live publication path; production eBay writes remain disabled.**

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

## Local foundation

`npm install`, `npm run typecheck`, `npm test`, and `npm run worker:build` verify the foundation. The Worker build uses Wrangler dry run only. `npm run d1:migrate:local` applies the SQL migrations to Wrangler's local D1 simulation; `npm run worker:dev` then serves `/mcp`. Copy `.dev.vars.example` to `.dev.vars` and replace the sample value with a random token of at least 32 characters before making local Worker requests. Never commit `.dev.vars`.

The Worker uses the same MCP tool definitions and service classes as the optional Node loopback adapter (`npm run dev`). D1 persists sale items, listing drafts, and the seller policy, including the default 2,500 basis point shipping margin. The public `wrangler.jsonc` database UUID is a placeholder for local validation; account-specific deployment configuration stays outside Git. The Worker rejects unauthenticated direct requests. The selected ChatGPT/Codex path is a Cloudflare MCP Portal using Managed OAuth for clients and a separate server-side bearer credential for the Worker. See [Cloudflare connection setup](docs/cloudflare-foundation.md).

The Worker rejects unauthenticated `/mcp` requests and cross-origin browser requests. ChatGPT and Codex use the same Streamable HTTP MCP service through the private Portal, with no separate business logic. The Portal is deployed with Managed OAuth and exact-identity access policies; client OAuth acceptance remains a user action, and deployment-specific values stay outside Git. See [Cloudflare foundation notes](docs/cloudflare-foundation.md).
## eBay seller connection

The read-only seller OAuth and active-listing integration is described in [docs/ebay-seller-readonly.md](docs/ebay-seller-readonly.md). It requires environment-specific eBay Developer Portal values, a Cloudflare encryption secret, and D1 migration 003 before live use.
