# Marketplace account deletion notifications

Verified against the official eBay documentation on 2026-10-11. This repository implements the endpoint; it does **not** establish that eBay has verified a production subscription.

## Protocol and evidence

- [Marketplace User Account Deletion](https://developer.ebay.com/develop/guides/sell/marketplace-user-account-deletion): endpoint challenge, notification shape, retries, exemption, and deletion obligation. eBay requires either a subscription or a valid exemption. This application stores eBay seller credentials, so the “not persisting eBay data” exemption is not appropriate.
- [Notification API overview](https://developer.ebay.com/api-docs/commerce/notification/overview.html): Base64 JSON `X-EBAY-SIGNATURE` header, `kid`, `getPublicKey`, and ECDSA verification. The current overview shows SHA1 with ECDSA; the [eBay notification presentation](https://developer.ebay.com/cms/files/connect-2021/notificaions_shekhar.pdf) also shows SHA256. The handler accepts only these two declared digests.
- [eBay Event Notification Node.js SDK](https://github.com/eBay/event-notification-nodejs-sdk): official reference for the `key` field in the public key response, EC signature encoding, and application token use.
- [Identity API](https://developer.ebay.com/develop/api/buy/identity_api): user identity lookup with a user access token. New seller connections store only the immutable `userId` needed for deletion matching. Access to this method is still an account-specific probe, not an assumed entitlement.
- [Notification topics](https://developer.ebay.com/develop/api/sell/notification_events): `MARKETPLACE_ACCOUNT_DELETION` schema version 1.0, including `notificationId`, `userId`, `username`, and `eiasToken`. The handler processes only this topic and version.

eBay sends a GET with one `challenge_code`. The response is JSON `{ "challengeResponse": "<lowercase SHA-256 hex>" }` for the UTF-8 concatenation of challenge code, verification token, then the **exact configured endpoint URL**. The route is `/ebay/marketplace-account-deletion`. It is independent of `/mcp` and seller OAuth.

POST accepts at most 16 KiB of `application/json` with no content encoding or query string. It verifies the ECDSA signature over the original bytes using an eBay public key fetched by `kid` and cached for up to one hour. It never treats an unsigned body as a deletion instruction. Unknown schema versions, invalid signatures, key lookup failures, missing configuration, D1 failures, and unbound legacy seller credentials fail closed. A successful response is `204` only after a D1 transaction records the notification ID and removes a matching seller connection. eBay retries unacknowledged notifications; the guide warns that repeated failures can mark the endpoint down and trigger a failure email. The [topic reference](https://developer.ebay.com/develop/api/sell/notification_events) currently lists three delivery attempts; the deletion guide describes additional resend behavior and a 24-hour down threshold. Operations must investigate every non-204 result promptly.

## D1 data inventory

The code and migrations currently define:

| Table | eBay personal data or reference | Deletion treatment |
| --- | --- | --- |
| `ebay_seller_connections` | Encrypted user OAuth tokens and immutable seller `userId` | Delete only the row whose `ebay_user_id` matches the signed notification. Existing pre-migration rows have no subject binding and block acknowledgement until resolved. |
| `ebay_oauth_states` | Short-lived opaque hashes for seller consent | No eBay user identifier; expire after five minutes. |
| `sale_items` | Local synthetic/user-entered item facts, with no eBay subject reference | No blind deletion. Do not put eBay buyer/seller personal data in free-form facts. A future ingestion path needs an explicit subject reference and erasure handler. |
| `listing_drafts` | Local user-authored drafts, with no eBay subject reference | No blind deletion. The same restriction on eBay personal data applies. |
| `seller_policy` | Shipping margin only | No personal data. |
| `ebay_account_deletion_receipts` | Notification ID, keyed subject digest, processing time, and count of erased connections | No raw user ID, username, EIAS token, body, or signature. The digest blocks a deleted seller from reconnecting; daily cleanup prunes receipts after 90 days. |

`src/ebay/privacy-registry.ts` classifies every application table and names every column. The migration coverage test fails when a new table or column lacks an explicit classification. Future eBay data stores must also implement precise deletion/anonymization and add matching tests before deployment. This repository does not store active listing API responses in D1.

[Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) can restore a database to a state before a DELETE for 7 or 30 days, depending on plan. A deletion receipt in the same D1 can also be rolled back. This is an unresolved irreversible-erasure risk requiring an operator-approved backup/restore control or a separate non-restorable key/erasure design before claiming compliance or enabling production acknowledgement. External logs and backups require the same review. The code never logs a notification payload, signature, key, token, or user identifier. Production data and secrets must stay outside coding-agent shell access.

## Private rollout checklist

1. In private deployment configuration, bind the existing production D1 database and preserve the existing exact-identity Cloudflare Access policy for `/mcp`. Expose only the deletion path publicly through HTTPS. Do not remove the Worker's `/mcp` bearer/OAuth checks. Do not place the production database ID, hostname, or account identifiers in this repository.
2. Apply migration `004_marketplace_account_deletion.sql`. In an operator-controlled D1 session, check `SELECT COUNT(*) FROM ebay_seller_connections WHERE ebay_user_id IS NULL;` before enabling the endpoint. A nonzero result blocks acknowledgement. Have the seller reconnect through the existing consent flow so Identity API binds the immutable user ID, or resolve each legacy credential through an independently verified operator process. Do not guess its owner or delete an unrelated connection.
3. In the Cloudflare Worker’s encrypted secrets, set `EBAY_DELETION_ENDPOINT` to the exact public HTTPS URL ending in `/ebay/marketplace-account-deletion`. Set `EBAY_DELETION_VERIFICATION_TOKEN` to a newly generated 32–80 character value using only letters, digits, underscore, or hyphen. Keep the token outside Git, logs, tickets, and chat. Existing `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_TOKEN_KEY_PRODUCTION`, and `EBAY_ENVIRONMENT=production` must be set for the same production keyset used in the eBay Developer Portal. The token key also protects the 90-day subject marker, so rotate it only with a migration plan for retained markers. Confirm the Worker can obtain an application token and call `getPublicKey` in a controlled test.
4. Deploy the tested Worker with the private config and migration. Test the public GET challenge with a synthetic challenge code by computing the expected hash inside the operator environment; do not paste the verification token into chat. Confirm the public path reaches the Worker while `/mcp` remains protected.
5. A human with eBay Developer Portal access opens **Application Keys → Production keyset → Marketplace Account Deletion / Alerts & Notifications**. Enter a monitored failure-notification email, the exact public endpoint URL, and the same verification token held in the Worker secret; click **Save**. eBay immediately sends the GET challenge. After eBay accepts it, click **Send Test Notification** and confirm a signed POST receives `204` and a receipt is recorded. Do not select the exemption toggle. Investigate any non-204 response and confirm eBay marks delivery healthy.

These steps are a human gate because the endpoint URL, token, email, Cloudflare production configuration, and eBay Portal access are private and must not enter the public repository or agent output. Do not claim compliance until eBay confirms endpoint verification and successful notification processing, and the backup/retention review is complete.
