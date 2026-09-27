# Cloudflare Worker and private MCP access

Verified against the live Cloudflare dashboard and official documentation on September 27, 2026. The service is deployed as a stateless Streamable HTTP MCP Worker with a production D1 binding. No eBay seller account is connected, and no production publication or seller-write tool exists.

## Live state

- Production Worker and D1 binding are present in Cloudflare.
- An unauthenticated request to the Worker `/mcp` route returns `401`; the Worker is fail-closed when no valid bearer secret is supplied.
- The Worker-level `/.well-known/oauth-protected-resource` route returns `404` because its optional custom OAuth verifier is not configured. This is not the selected ChatGPT discovery path.
- No Cloudflare MCP server or MCP Portal was present when inspected. The Portal configuration is pending the action-time confirmation required for creating authenticated access.
- `npm run worker:build` is a Wrangler dry run. The local tests use Miniflare D1 and synthetic records; they do not prove production eBay entitlements.

## Selected client architecture

Use Cloudflare MCP Portals with Managed OAuth. MCP Portals are generally available and provide one HTTPS `/mcp` endpoint for ChatGPT and Codex. Managed OAuth protects the Portal and handles client OAuth; it does not replace upstream Worker authentication. Do not use a generic self-hosted Access application or turn on Managed OAuth directly for the Worker: the Worker does not validate Cloudflare's `Cf-Access-Jwt-Assertion` header.

The Portal-to-Worker hop uses a separate high-entropy static bearer credential:

1. Store it only as the Cloudflare Worker secret `MCP_BEARER_TOKEN` and as the Cloudflare MCP server's upstream Authorization bearer credential.
2. Never pass this upstream credential to ChatGPT, Codex, prompts, logs, local configuration, or Git.
3. Restrict both the MCP server and Portal with an Allow policy for the single approved owner identity. Do not add Bypass, public, or broad-domain policies.
4. Keep the Worker direct origin fail-closed. Its public workers.dev hostname is not an anonymous access path; requests without the separate bearer must remain unauthorized.
5. Disable Portal Code Mode and expose only the reviewed MCP tools. In particular, do not expose `set_shipping_safety_margin` through the Portal; retain the +25% safety margin.
6. Use the Portal HTTPS `/mcp` URL for both ChatGPT and Codex. Codex should authenticate with its OAuth flow, not receive the Worker bearer.

Cloudflare Managed OAuth is the authorization server for the Portal. The Portal is responsible for OAuth/protected-resource discovery seen by clients; the Worker's optional JWT validator is a separate path and remains unconfigured unless a later architecture change explicitly requires direct client-to-Worker OAuth. Access is authentication only; it does not constitute eBay API entitlement, tool-level approval, or permission to publish.

## Acceptance checks

Before calling the connection ready:

- Confirm the Portal `/mcp` URL is protected by Cloudflare Managed OAuth and exact-identity Access policy.
- Verify OAuth authorization-server and protected-resource discovery from the client-visible Portal URL.
- Confirm unauthenticated Portal and direct Worker requests cannot initialize MCP.
- Authenticate an approved MCP client and complete `initialize`, `tools/list`, and a harmless tool call.
- Create and retrieve one clearly synthetic sale record in D1; do not use buyer or real inventory data for the smoke test.
- Confirm `set_shipping_safety_margin` is absent from the Portal tool list and the stored default remains `2500` basis points (+25%).
- Verify no live eBay write/publication tool is available.
- Verify the same Portal endpoint is registered in ChatGPT and Codex. OAuth sign-in/consent is a user step; do not complete human approval on the user's behalf.

## ChatGPT plan limitation

OpenAI's current Help Center states that Pro users can connect custom MCP apps with read/fetch permissions, while full MCP write/modify access is rolling out for Business, Enterprise, and Edu. Therefore the requested ChatGPT test that creates a synthetic D1 record may be unavailable on a personal Pro account even when Portal OAuth and tool discovery work. Treat that tool call as plan-gated; do not weaken server authentication or tool approval to work around it.

## Sources

- [Cloudflare MCP server portals](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/mcp-portals/) documents server registration, bearer credentials, Portal policies, Managed OAuth, discovery, and the Portal `/mcp` endpoint.
- [Cloudflare Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/) documents enabling Managed OAuth on a Portal.
- [Cloudflare secure MCP servers](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/secure-mcp-servers/) warns to enable Managed OAuth only where the MCP server validates Cloudflare Access JWTs.
- [Cloudflare identity providers](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/) documents Cloudflare identity and one-time PIN options.
- [Cloudflare MCP transport](https://developers.cloudflare.com/agents/model-context-protocol/protocol/transport/) documents Streamable HTTP.
- [Cloudflare D1 binding API](https://developers.cloudflare.com/d1/worker-api/) documents prepared statements and D1 results.
- [Cloudflare Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) documents D1 binding and migration configuration.
- [OpenAI MCP authentication](https://developers.openai.com/plugins/build/auth) documents OAuth 2.1 discovery, PKCE, audience binding, and token validation.
- [OpenAI Codex MCP configuration](https://developers.openai.com/codex/mcp) documents remote Streamable HTTP configuration and OAuth login.
- [ChatGPT developer mode and MCP apps](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt) documents private app creation, tool scanning, plan limitations, and use in ChatGPT web chats.
