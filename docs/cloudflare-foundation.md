# Cloudflare Workers and D1 foundation

Verified against official documentation on September 27, 2026. This slice uses one stateless Streamable HTTP MCP endpoint at `/mcp`, with D1 behind the existing storage interfaces. The Node loopback adapter remains for local use. No eBay write or publication tool exists.

## Deployment inputs

- Replace the placeholder `database_id` in `wrangler.jsonc` after a D1 resource is created.
- Apply `migrations/001_initial.sql` and `migrations/002_listing_drafts.sql` to that database before serving requests.
- Provision `MCP_BEARER_TOKEN` as a Worker secret with a random value of at least 32 characters. The Worker fails closed when it is absent or short. Never put it in `wrangler.jsonc` or Git.
- Choose an OAuth 2.1 authorization server that publishes `/.well-known/oauth-authorization-server` or OIDC discovery, supports authorization code with PKCE S256 and either CIMD, DCR, or a predefined ChatGPT client. Its metadata must advertise its actual token endpoint authentication method. Configure the exact ChatGPT redirect URI shown by ChatGPT. The provider must carry ChatGPT's `resource` parameter through authorization and token exchange and issue RS256 JWT access tokens with `aud` equal to `MCP_PUBLIC_ORIGIN`, `iss` equal to `MCP_OAUTH_ISSUER`, and `mcp:use` in `scope` (or `scp`). An opaque token provider or one that cannot bind the resource is incompatible with this Worker validator.
- Provision `MCP_PUBLIC_ORIGIN`, `MCP_OAUTH_ISSUER`, `MCP_OAUTH_JWKS_URI`, and `MCP_OAUTH_ALLOWED_SUBJECT` as Worker configuration after provider selection. The origin must be the exact public HTTPS Worker origin, without `/mcp` or a trailing slash. The issuer must exactly match the provider's discovery `issuer`; the JWKS URI must be its published HTTPS public-key endpoint. The allowed subject must be the exact `sub` claim of the seller identity permitted to access this single-seller D1 store. Keep deployment-specific values outside Git. Incomplete or invalid OAuth configuration publishes no protected-resource metadata and accepts no OAuth tokens.
- Check the provider's authorization-server discovery, `resource` audience mapping, S256 support, client-registration method, and redirect allowlist before enabling the private ChatGPT connection. The Worker publishes `/.well-known/oauth-protected-resource`, challenges unauthenticated `/mcp` requests with that URL, and validates JWT signature, issuer, subject, resource audience, expiry, and scope. The same `/mcp` endpoint continues to accept the static bearer secret for Codex. OAuth grants MCP access only; it never constitutes an ACT approval or eBay permission.
- Verify both the ChatGPT OAuth connection and the Codex bearer connection against the same deployed endpoint. These account-specific checks have not yet been performed.

`npm run worker:build` only bundles and validates locally. The local tests use Miniflare D1 and synthetic records. No account-specific eBay or Cloudflare entitlement has been probed.

## Sources

- [Cloudflare MCP transport](https://developers.cloudflare.com/agents/model-context-protocol/protocol/transport/) documents Streamable HTTP and the stateless handler.
- [Cloudflare D1 binding API](https://developers.cloudflare.com/d1/worker-api/) documents prepared statements and D1 results.
- [Cloudflare D1 local development](https://developers.cloudflare.com/d1/best-practices/local-development/) documents local bindings and migrations.
- [Cloudflare Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) documents D1 binding fields and migration directories.
- [OpenAI MCP authentication](https://developers.openai.com/plugins/build/auth) documents OAuth 2.1, protected resource metadata, and per-request token verification.
- [Cloudflare MCP authorization](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/) distinguishes user authentication, OAuth client authorization, and permission checks inside tools.
- [OpenAI private connection guidance](https://developers.openai.com/plugins/deploy/connect-chatgpt) documents HTTPS `/mcp` and Secure MCP Tunnel options.
