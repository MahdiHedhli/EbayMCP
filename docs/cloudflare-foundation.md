# Cloudflare Workers and D1 foundation

Verified against official documentation on September 27, 2026. This slice uses one stateless Streamable HTTP MCP endpoint at `/mcp`, with D1 behind the existing storage interfaces. The Node loopback adapter remains for local use. No eBay write or publication tool exists.

## Deployment inputs, held for a later approved slice

- Replace the placeholder `database_id` in `wrangler.jsonc` after a D1 resource is created.
- Apply `migrations/001_initial.sql` and `migrations/002_listing_drafts.sql` to that database before serving requests.
- Provision `MCP_BEARER_TOKEN` as a Worker secret with a random value of at least 32 characters. The Worker fails closed when it is absent or short. Never put it in `wrangler.jsonc` or Git.
- Integrate an MCP compliant OAuth 2.1 identity provider and resource server authorization for private ChatGPT app use. The current bearer gate alone is not a ChatGPT end-user authorization flow. Preserve the service authorization boundary when adding ACT tools later.
- Verify the private ChatGPT app connection and the Codex connection against the same endpoint. This has not been account-tested.

`npm run worker:build` only bundles and validates locally. The local tests use Miniflare D1 and synthetic records. No account-specific eBay or Cloudflare entitlement has been probed.

## Sources

- [Cloudflare MCP transport](https://developers.cloudflare.com/agents/model-context-protocol/protocol/transport/) documents Streamable HTTP and the stateless handler.
- [Cloudflare D1 binding API](https://developers.cloudflare.com/d1/worker-api/) documents prepared statements and D1 results.
- [Cloudflare D1 local development](https://developers.cloudflare.com/d1/best-practices/local-development/) documents local bindings and migrations.
- [Cloudflare Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) documents D1 binding fields and migration directories.
- [OpenAI MCP authentication](https://developers.openai.com/plugins/build/auth) documents OAuth 2.1, protected resource metadata, and per-request token verification.
- [OpenAI private connection guidance](https://developers.openai.com/plugins/deploy/connect-chatgpt) documents HTTPS `/mcp` and Secure MCP Tunnel options.
