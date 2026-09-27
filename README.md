# EbayMCP

A proposed, harness-independent selling-lifecycle service for Operation Declutter: from a physical item's photos to a fast, reviewed eBay listing or auction, then through sale follow-up, fulfillment, and reconciliation.

**Status: v1 foundation under local development, September 27, 2026. No connected seller account, live publication path, Cloudflare deployment, or production actions.**

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

The Worker uses the same MCP tool definitions and service classes as the optional Node loopback adapter (`npm run dev`). D1 persists sale items, listing drafts, and the seller policy, including the default 2,500 basis point shipping margin. The `wrangler.jsonc` database UUID is a placeholder for local validation. Before any later deployment, a project owner must create the D1 resource, replace that UUID, apply migrations, and provision the bearer secret through Cloudflare's secret binding. None of those account actions occur in this slice.

The Worker rejects `/mcp` requests without the server-side bearer secret and rejects cross-origin browser requests. This bearer gate supports local validation and manually configured clients. A private ChatGPT app requires the supported MCP OAuth flow and a reachable HTTPS endpoint or Secure MCP Tunnel; that identity integration and an actual ChatGPT connection are release gates. ChatGPT and Codex will use this same Streamable HTTP MCP service, with no separate business logic. See [Cloudflare foundation notes](docs/cloudflare-foundation.md).
