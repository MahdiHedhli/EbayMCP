# Phase 0 API discovery and permission ledger

**As of 2026-09-27.** Cloudflare Worker/D1 foundation is deployed; no authenticated eBay seller API probe, consent request, subscription, listing, or production seller action has been performed. A documented method is not proof of production entitlement or permission to expose its results through MCP.

## Critical gates

The published API License Agreement restricts eBay-content-based price suggestions without written consent (section 9.5). Its Restricted API provisions additionally constrain external-AI ingestion, API redistribution and pricing tools (section 8.5). Treat these as separate rights gates, not solved by OAuth or disabling model training. Ask eBay to confirm the proposed private seller-assistant data flow; do not route around restrictions with scraping, manual imports or server-side aggregation. [E1]

The research path must distinguish ACTIVE_ASK, VERIFIED_SALE and SELLER_SUPPLIED evidence. Browse search is not a general completed-sales feed. Finding is retired, and Marketplace Insights documentation currently leads to a protected area; no usable general-access sold-comparables integration was established. Product Research's seller UI must not be represented as a callable public API. Production Buy API eligibility must also be established for this application's use case. [E2-E4, E19]

## Supported operations and limitations

| Need | Documented route | Proposed boundary / caveat |
|---|---|---|
| Physical inventory and local drafts | Our service | UUIDs and local state do not require eBay publication |
| Current item search | Browse `item_summary/search` | Application token; production access and permitted data use required; asking prices are not sale prices [E2-E3] |
| Category, specifics, conditions | Taxonomy plus Sell Metadata; Catalog for product matches | Current market/category requirements; avoid retired GetCategories/GetCategoryFeatures and old Product API [E4, E7] |
| Local-draft verification and publication | Trading `VerifyAddFixedPriceItem`, then approved `AddFixedPriceItem` | Verification does not publish; fee estimates can differ from final fees [E6, E8] |
| Alternative listing model | Inventory inventory items and unpublished offers, then publish | Not a Seller Hub draft; Inventory-created listings cannot be edited in Seller Hub; both fixed-price and auctions are documented [E5] |
| Live revise/end/relist | Trading `ReviseFixedPriceItem`, `EndFixedPriceItem`, `RelistFixedPriceItem` | Later ACT tools; rules and current listing state constrain changes; relist retains physical UUID [E20-E22] |
| Public listing images | Media `createImageFromFile`, `getImage` | Uses `sell.inventory` even with a Trading listing backend; actual private originals stay local [E9] |
| Buyer Best Offers | Trading `GetBestOffers`, `RespondToBestOffer` | Incoming offers, and accept/decline/counter actions; not Inventory offer objects [E10-E11] |
| Offers sent to interested buyers | Sell Negotiation | Different use case from responding to buyer offers; defer [E12] |
| Buyer conversations | Commerce Message `getConversations`, `getConversation`, `sendMessage` | Documented REST API; scope is broad enough for reads and writes, so enforce tool-level roles; defer sending [E13] |
| Views/impressions and engagement | Sell Analytics `getTrafficReport`; seller `GetItem` with `IncludeWatchCount` | Snapshot/interval metrics, not guaranteed live or universally available; missing is not zero; data rights still apply [E14-E15] |
| Sales and fulfillment | Fulfillment `getOrders`, `getOrder`, shipment reads and `createShippingFulfillment` | `shipByDate` supports deadlines; posting tracking/marking shipped is ACT, not a passive observation or proof of delivery [E18] |
| Shipping quotes and labels | Sell Logistics | Limited release; approved developers only. Published schema documents USPS rates/labels; not a general unrestricted multi-carrier solution [E23] |
| Proceeds and refunds | Finances reads; Fulfillment `issueRefund` | Reporting and money movement must be separated; refund endpoint requires `sell.finances`, not merely fulfillment scope [E18, E24] |
| Notifications | REST Commerce Notification plus supported legacy Platform Notifications | Discover REST topics for the actual app. Legacy `BestOffer` and `ItemSold` are documented seller signals; no invented all-events webhook [E12, E25-E26] |

Do not implement `UploadSiteHostedPictures`: scheduled retirement is September 30, 2026. The deprecation ledger also marks the legacy `ItemMarkedPaid` notification retired June 22, 2026; do not copy that event from an older general guide. [E4]

## OAuth and scopes

Use eBay authorization-code user tokens for seller operations, application tokens where documented, and refresh tokens exclusively inside the service. Client-to-MCP credentials are a different security boundary. eBay documents refresh, introspection and revocation; implement expiry/revocation handling and fresh consent for scope expansion. [E16]

All scope suffixes below refer to `https://api.ebay.com/oauth/api_scope`; append `/suffix` where shown. Confirm every selected method against its current schema and the application's granted keyset before activation.

| Module | Scope / consent planning |
|---|---|
| Browse and general metadata; Trading OAuth | Base scope in the appropriate application/user flow; Trading's broad authorization is not a read-only boundary [E2, E16] |
| Media image operations | `sell.inventory` is explicitly required by the Media schema; not optional merely because publication uses Trading [E9] |
| Seller business-policy reads | Plan `sell.account.readonly`; exact enabled methods/keyset checked in readiness, no autonomous opt-in or policy creation |
| Traffic metrics | Plan `sell.analytics.readonly`; readiness must verify method access, marketplace and permitted data use |
| Order reads | `sell.fulfillment.readonly`; shipping-fulfillment creation uses `sell.fulfillment` [E18] |
| REST notifications | Base application scope for app topics; `commerce.notification.subscription` for user subscriptions [E12] |
| Conversations | `commerce.message`; read/write separation must be local [E13] |
| Proceeds | `sell.finances.earnings.read` for the documented earnings resources, or `sell.finances` for transaction/payout resources [E24] |
| Refunds | `sell.finances`; do not activate a refund tool just because reporting has that scope [E18] |
| Logistics | `sell.logistics` plus separate limited-release entitlement [E23] |

Additional modules, including disputes and seller-initiated negotiation, get their own method-specific scope review later. Do not request all available scopes up front. Sandbox success does not establish production access, traffic fidelity or contractual permission.

## Events, retention and transport

REST notifications require a reachable HTTPS destination, challenge verification, and payload signature verification. Discover topics and filter support rather than assuming every listed event is supported for this account. Legacy notifications require their own protocol validation. Persist the event before acknowledgment; deduplicate and reconcile authoritative state rather than trusting arrival order. [E12]

Use a minimal public event receiver separate from the private MCP service. The receiver cannot execute seller actions or access eBay OAuth tokens. Authenticated outbound consumption into the private service can connect the two. Missed or delayed notifications still require bounded reconciliation. Public eBay ingress and OpenAI's private MCP tunnel solve different problems.

Plan marketplace-account deletion processing and data minimization before production. Keep necessary buyer data in a deletable store rather than an immutable log. Confirm applicable retention and deletion requirements for the actual app; do not assume an exemption. [E17]

## ChatGPT and Codex

The deployed Worker rejects requests without its private upstream bearer. A Cloudflare MCP Portal with Managed OAuth is configured in front of it; ChatGPT and Codex use the same Portal `/mcp` endpoint. Portal OAuth and protected-resource discovery have been verified, and the upstream MCP server is Ready with the reviewed tool set. The local Codex server entry exists but is not authenticated yet; no end-user authenticated MCP handshake or production-D1 synthetic create/retrieve test has completed. Secure MCP Tunnel is an alternative for a private/on-premises server, not needed for this Cloudflare-hosted Worker. [O1, O4, O5]

OpenAI's current Help Center says Pro users can connect custom MCP apps with read/fetch permissions in developer mode; full MCP write/modify is available for Business and Enterprise/Edu. Treat ChatGPT-side writes as plan-gated and test the actual workspace before relying on them. MCP apps are web-only. Ordinary photo attachments must not be assumed to reach the server automatically. [O3]

Codex supports remote Streamable HTTP MCP and OAuth login. The same private Portal endpoint used by ChatGPT is registered locally as `ebay_manager`; its concrete URL and identity policy stay in local account configuration, not Git. Run `codex mcp login ebay_manager` and complete Cloudflare's browser-based OAuth flow to finish user authorization. [O4]

```toml
[mcp_servers.ebay_manager]
url = "https://<private-portal-host>/mcp"
```

Use `codex mcp login ebay_manager` to authorize with Cloudflare Managed OAuth. Do not give Codex the Worker's upstream bearer. Test scheduled custom-tool availability separately; do not equate conversational tool support with unattended task support.

## Primary sources

All sources below were reviewed or retrieved during this discovery. E19 records a protected documentation boundary, not an established feature entitlement. Some HTML method pages could not be retrieved; official OpenAPI files supplied the method/scope evidence where available. No protected payloads are copied into this repository.

- [E1: API License Agreement](https://developer.ebay.com/join/api-license-agreement)
- [E2: Browse OpenAPI](https://developer.ebay.com/api-docs/master/buy/browse/openapi/3/buy_browse_v1_oas3.json)
- [E3: Buy API production requirements](https://developer.ebay.com/api-docs/buy/static/buy-requirements.html)
- [E4: API deprecation status](https://developer.ebay.com/develop/get-started/api-deprecation-status)
- [E5: Inventory overview and restrictions](https://developer.ebay.com/api-docs/sell/inventory/overview.html)
- [E6: Listing creation guide](https://developer.ebay.com/develop/guides/sell/listing-creation)
- [E7: Category and metadata guide](https://developer.ebay.com/api-docs/sell/static/metadata/getting-metadata.html)
- [E8: VerifyAddFixedPriceItem](https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/VerifyAddFixedPriceItem.html)
- [E9: Media OpenAPI](https://developer.ebay.com/api-docs/master/commerce/media/openapi/3/commerce_media_v1_beta_oas3.json)
- [E10: GetBestOffers](https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/GetBestOffers.html)
- [E11: RespondToBestOffer](https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/RespondToBestOffer.html)
- [E12: Sell communications and notifications guide](https://developer.ebay.com/develop/guides/sell/sell-communications-guide)
- [E13: Commerce Message OpenAPI](https://developer.ebay.com/api-docs/master/commerce/message/openapi/3/commerce_message_v1_oas3.json)
- [E14: Traffic report guide](https://developer.ebay.com/api-docs/sell/static/performance/traffic-report.html)
- [E15: GetItem, including seller watch count](https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/GetItem.html)
- [E16: OAuth authorization guide](https://developer.ebay.com/develop/guides/sell/authorization)
- [E17: Marketplace user account deletion](https://developer.ebay.com/develop/guides/sell/marketplace-user-account-deletion)
- [E18: Fulfillment OpenAPI](https://developer.ebay.com/api-docs/master/sell/fulfillment/openapi/3/sell_fulfillment_v1_oas3.json)
- [E19: Marketplace Insights documentation entry](https://developer.ebay.com/api-docs/buy/marketplace-insights/overview.html)
- [E20: ReviseFixedPriceItem](https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/ReviseFixedPriceItem.html)
- [E21: EndFixedPriceItem](https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/EndFixedPriceItem.html)
- [E22: RelistFixedPriceItem](https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/RelistFixedPriceItem.html)
- [E23: Logistics OpenAPI](https://developer.ebay.com/api-docs/master/sell/logistics/openapi/3/sell_logistics_v1_oas3.json)
- [E24: Finances OpenAPI](https://developer.ebay.com/api-docs/master/sell/finances/openapi/3/sell_finances_v1_oas3.json)
- [E25: BestOffer notification](https://developer.ebay.com/api-docs/static/pn_best-offer.html)
- [E26: ItemSold notification](https://developer.ebay.com/api-docs/static/pn_item-sold.html)
- [O1: Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [O2: ChatGPT developer-mode guide](https://developers.openai.com/api/docs/guides/developer-mode)
- [O3: Developer-mode Help Center requirements](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt)
- [O4: Codex MCP configuration](https://developers.openai.com/codex/mcp)
- [O5: Cloudflare MCP server portals](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/mcp-portals/)
