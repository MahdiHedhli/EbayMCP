# Seller OAuth and active listings

Verified against official eBay documentation on 2026-09-27. No account-specific Sandbox or Production probe has been completed. The adapter calls only `GetMyeBaySelling` with `ActiveList.Include=true`. It does not expose any eBay write method.

## Trust boundaries

Cloudflare Managed OAuth protects the private MCP service for ChatGPT and Codex. eBay seller OAuth is a separate connection. An authenticated MCP call creates a random, five-minute, one-use connection link. Opening that link redirects the seller to eBay. The seller signs in and consents in eBay's own UI. The callback checks the exact configured URL, environment, expiration, and one-use state before exchanging the authorization code. The callback and start endpoints have no other capability and never return credentials.

The callback must use a publicly reachable HTTPS Worker route; configure the eBay Developer Portal RuName's **Auth Accepted URL** to that exact `/ebay/oauth/callback` URL. The MCP Portal URL and the eBay callback URL may differ. Do not expose the Worker MCP route without its existing bearer protection. Review and allowlist the new tools in the private MCP Portal before using them.

The link returned by `begin_ebay_seller_connection` is sensitive until it expires. Its URL contains only a random state value, not the eBay RuName or eBay credentials. Avoid putting it in logs or sharing it. `get_ebay_seller_connection_status` reports only the environment, configuration state, connection state, and connection time. `disconnect_ebay_seller` requests eBay refresh-token revocation and removes the local encrypted credential; a failed remote revocation is reported so the seller can revoke third-party app access in eBay.

## Configuration gate

Set these values in the target Cloudflare Worker environment, outside Git:

- `EBAY_ENVIRONMENT`: `sandbox` or `production`.
- `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET`: the matching environment's eBay App ID and Cert ID.
- `EBAY_RUNAME`: the matching environment's OAuth-enabled RuName, not the callback URL.
- `EBAY_CALLBACK_URL`: the exact public HTTPS callback URL registered as the RuName's Auth Accepted URL.
- `EBAY_TOKEN_KEY_SANDBOX` or `EBAY_TOKEN_KEY_PRODUCTION`: an independent random 32-byte key encoded as standard base64. Supply only the active environment's key. Preserve it securely; changing it requires reconnecting the seller.

Apply migration `003_ebay_seller_auth.sql` to the target D1 database before enabling the tools. D1 stores a SHA-256 digest of each pending OAuth state and AES-256-GCM encrypted access and refresh tokens. The key is a Cloudflare Worker secret. The authenticated environment is the storage partition and encryption associated data, so Sandbox cannot fall back to Production or vice versa. Tokens, client secrets, RuName, and account identifiers are absent from MCP results. The connection is a single-seller connection per environment. Do not deploy or point this build at Production until the matching production configuration and callback route have been reviewed.

After configuration, call `get_ebay_seller_connection_status`, then `begin_ebay_seller_connection`. The human opens the returned `connectUrl` and completes eBay consent. Call `get_active_listings` after the callback reports success. Expired or revoked refresh tokens move the connection to `RECONNECT_REQUIRED`; repeat the consent flow. The tool accepts 1–50 listings per page and a page-number cursor up to 125. eBay documents a 25,000-listing result cap for this call. The first slice uses eBay site ID `0` (eBay.com); coverage for other eBay sites is unverified.

The listing response is an allowlist of item ID, title, type, current asking price, available and sold quantity, times, primary category, watch count, safe eBay URL, pagination, and capture time. Missing values are `null`. In particular, eBay says `WatchCount` is returned only when greater than zero, so an absent watch count is unknown. View count is unknown unless a supported response field is established. Asking prices are not verified sales. Seller/buyer details, private notes, raw XML, and upstream errors are never returned.

## Source record

- [GetMyeBaySelling reference](https://developer.ebay.com/devzone/xml/docs/reference/ebay/getmyebayselling.html): ActiveList, pagination, watch count, and 25,000-item cap. No call deprecation was identified in the [current deprecation status](https://developer.ebay.com/develop/get-started/api-deprecation-status); specific historical fields are deprecated, so the adapter uses a narrow allowlist.
- [eBay authorization guide](https://developer.ebay.com/develop/guides/sell/authorization): authorization-code flow, RuName, state, refresh, and revocation.
- [Trading API XML call guide](https://developer.ebay.com/devzone/xml/docs/Concepts/MakingACall.html): `X-EBAY-API-IAF-TOKEN` and routing headers.
- [Trading XML gateways](https://developer.ebay.com/api-docs/user-guides/static/make-a-call/using-xml.html): Sandbox and Production `/ws/api.dll` hosts.
- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/): secret binding for the encryption key and client secret.

Open verification: exact eBay account entitlements, Production RuName/callback setup, and a real seller response remain unprobed. No data-use restriction may be bypassed to fill a gap.
