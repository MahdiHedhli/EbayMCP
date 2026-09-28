import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ActiveListingsService, normalizeActiveListings } from "../src/ebay/active-listings.js";
import { EbaySellerAuth } from "../src/ebay/seller-auth.js";
import { loadEbayConfig } from "../src/ebay/config.js";
import type { D1Binding } from "../src/storage/d1.js";
import worker, { type WorkerEnv } from "../src/worker.js";

const sandboxKey = btoa("01234567890123456789012345678901");
const productionKey = btoa("abcdefghijabcdefghijabcdefghij12");
const config = loadEbayConfig({ EBAY_ENVIRONMENT: "sandbox", EBAY_CLIENT_ID: "synthetic-client",
  EBAY_CLIENT_SECRET: "synthetic-secret", EBAY_RUNAME: "synthetic-runame",
  EBAY_CALLBACK_URL: "https://worker.example.invalid/ebay/oauth/callback", EBAY_TOKEN_KEY_SANDBOX: sandboxKey });
const production = loadEbayConfig({ EBAY_ENVIRONMENT: "production", EBAY_CLIENT_ID: "synthetic-production-client",
  EBAY_CLIENT_SECRET: "synthetic-production-secret", EBAY_RUNAME: "synthetic-production-runame",
  EBAY_CALLBACK_URL: "https://worker.example.invalid/ebay/oauth/callback", EBAY_TOKEN_KEY_PRODUCTION: productionKey });

const fixture = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents">
<Ack>Success</Ack><ActiveList><ItemArray>
<Item><ItemID>123456789012</ItemID><Title>Synthetic &amp; safe</Title><ListingType>FixedPriceItem</ListingType>
<SellingStatus><CurrentPrice currencyID="USD">12.50</CurrentPrice><QuantitySold>0</QuantitySold></SellingStatus>
<QuantityAvailable>3</QuantityAvailable><ListingDetails><StartTime>2026-01-01T00:00:00.000Z</StartTime><EndTime>2026-02-01T00:00:00.000Z</EndTime><ViewItemURL>https://www.ebay.com/itm/123456789012?tracking=synthetic</ViewItemURL></ListingDetails>
<PrimaryCategory><CategoryID>123</CategoryID><CategoryName>Synthetic category</CategoryName></PrimaryCategory>
<Seller><UserID>private-seller-id</UserID></Seller><Buyer><Email>buyer@example.invalid</Email></Buyer>
</Item><Item><ItemID>123456789013</ItemID><Title>Second item</Title><WatchCount>2</WatchCount>
<ListingDetails><ViewItemURL>https://evil.invalid/path</ViewItemURL></ListingDetails></Item>
</ItemArray><PaginationResult><TotalNumberOfEntries>3</TotalNumberOfEntries><TotalNumberOfPages>2</TotalNumberOfPages></PaginationResult></ActiveList></GetMyeBaySellingResponse>`;

describe("seller OAuth and active listing retrieval", () => {
  const runtime = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok') } }", d1Databases: { DB: "seller-test-db" } });
  let db: D1Binding;
  let auth: EbaySellerAuth;

  beforeAll(async () => {
    const d1 = await runtime.getD1Database("DB");
    const sql = readFileSync(new URL("../migrations/003_ebay_seller_auth.sql", import.meta.url), "utf8");
    for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) await d1.prepare(statement).run();
    db = d1 as unknown as D1Binding;
    auth = new EbaySellerAuth(db, config);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await db.prepare("DELETE FROM ebay_oauth_states").bind().run();
    await db.prepare("DELETE FROM ebay_seller_connections").bind().run();
  });
  afterAll(async () => { await runtime.dispose(); });

  async function connect() {
    const begin = await auth.begin();
    expect(begin.connectUrl).not.toContain(config.runame);
    expect(begin.connectUrl).not.toContain(config.clientSecret);
    const start = new URL(begin.connectUrl);
    const consent = new URL(await auth.authorize(start));
    expect(consent.hostname).toBe("auth.sandbox.ebay.com");
    expect(consent.searchParams.get("redirect_uri")).toBe(config.runame);
    const callback = new URL(config.callbackUrl!);
    callback.searchParams.set("state", consent.searchParams.get("state")!);
    callback.searchParams.set("code", "synthetic-code");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ access_token: "synthetic-access", refresh_token: "synthetic-refresh",
      expires_in: 7200, refresh_token_expires_in: 100000 }), { status: 200 })));
    await auth.callback(callback);
    return { callback, begin };
  }

  it("validates, expires, and consumes state; keeps eBay credentials out of D1 plaintext", async () => {
    const { callback } = await connect();
    expect((await auth.status()).status).toBe("CONNECTED");
    await expect(auth.callback(callback)).rejects.toThrow("EBAY_CALLBACK_INVALID");
    const row = await db.prepare("SELECT encrypted_tokens FROM ebay_seller_connections WHERE environment = ?").bind("sandbox").first<{ encrypted_tokens: string }>();
    expect(row?.encrypted_tokens).not.toContain("synthetic-access");
    expect(row?.encrypted_tokens).not.toContain("synthetic-refresh");
    expect(JSON.stringify(await auth.status())).not.toContain("synthetic-");
    expect((await new EbaySellerAuth(db, production).status()).status).toBe("DISCONNECTED");
    await expect(new EbaySellerAuth(db, production).accessToken()).rejects.toThrow("EBAY_RECONNECT_REQUIRED");

    const second = await auth.begin();
    const invalid = new URL(config.callbackUrl!);
    invalid.searchParams.set("state", "x".repeat(43));
    invalid.searchParams.set("code", "synthetic-code");
    await expect(auth.callback(invalid)).rejects.toThrow("EBAY_CALLBACK_INVALID");
    await db.prepare("UPDATE ebay_oauth_states SET expires_at = ? WHERE environment = ?").bind(new Date(0).toISOString(), "sandbox").run();
    await expect(auth.authorize(new URL(second.connectUrl))).rejects.toThrow("EBAY_CALLBACK_INVALID");
  });

  it("refreshes an expired access token and marks revoked credentials for reconnect", async () => {
    await connect();
    await db.prepare("UPDATE ebay_seller_connections SET access_expires_at = ? WHERE environment = ?").bind(new Date(0).toISOString(), "sandbox").run();
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(String(init.body));
      return new Response(JSON.stringify({ access_token: "new-synthetic-access", expires_in: 7200 }), { status: 200 });
    }));
    expect(await auth.accessToken()).toBe("new-synthetic-access");
    expect(calls[0]).toContain("grant_type=refresh_token");
    expect(calls[0]).toContain("synthetic-refresh");
    expect(await auth.accessToken()).toBe("new-synthetic-access");
    expect(calls).toHaveLength(1);

    await db.prepare("UPDATE ebay_seller_connections SET access_expires_at = ? WHERE environment = ?").bind(new Date(0).toISOString(), "sandbox").run();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("invalid_grant", { status: 400 })));
    await expect(auth.accessToken()).rejects.toThrow("EBAY_RECONNECT_REQUIRED");
    expect((await auth.status()).status).toBe("RECONNECT_REQUIRED");
  });

  it("revokes then deletes the local connection without leaking remote errors", async () => {
    await connect();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    expect(await auth.disconnect()).toEqual({ status: "DISCONNECTED", revocation: "SUCCEEDED" });
    expect((await auth.status()).status).toBe("DISCONNECTED");
  });

  it("normalizes only allowlisted fields, pagination, and unknown metrics", async () => {
    const result = normalizeActiveListings(fixture, 2, 1, "2026-09-27T00:00:00.000Z");
    expect(result.listings).toHaveLength(2);
    expect(result.listings[0]).toMatchObject({ itemId: "123456789012", title: "Synthetic & safe", currentPrice: { amount: "12.50", currency: "USD" },
      quantityAvailable: 3, quantitySold: 0, watchCount: null, viewCount: null, url: "https://www.ebay.com/itm/123456789012" });
    expect(result.listings[1]).toMatchObject({ watchCount: 2, quantitySold: null, url: null });
    expect(result.pagination).toMatchObject({ page: 1, nextCursor: "2", totalEntries: 3 });
    expect(JSON.stringify(result)).not.toContain("private-seller-id");
    expect(JSON.stringify(result)).not.toContain("buyer@example.invalid");
    expect(() => normalizeActiveListings("<!DOCTYPE x [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><x/>", 2, 1)).toThrow("EBAY_XML_INVALID");
    expect(() => normalizeActiveListings(fixture.replace("<Ack>Success</Ack>", "<Ack>Failure</Ack>"), 2, 1)).toThrow("EBAY_LISTINGS_UNAVAILABLE");
  });

  it("uses only GetMyeBaySelling and bounds pagination", async () => {
    await connect();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(fixture, { status: 200 });
    }));
    const listings = new ActiveListingsService(config, auth);
    expect((await listings.get(2, "2")).pagination.page).toBe(2);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.sandbox.ebay.com/ws/api.dll");
    expect(String(calls[0]?.init.body)).toContain("<PageNumber>2</PageNumber>");
    expect(String(calls[0]?.init.body)).toContain("<Include>true</Include>");
    await expect(listings.get(51)).rejects.toThrow("EBAY_PAGINATION_INVALID");
    await expect(listings.get(2, "126")).rejects.toThrow("EBAY_PAGINATION_INVALID");
    expect(calls).toHaveLength(1);
  });

  it("exposes normalized listings through the authenticated MCP tool", async () => {
    await connect();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(fixture, { status: 200 })));
    const response = await worker.fetch(new Request("https://worker.example.invalid/mcp", {
      method: "POST", headers: { Authorization: "Bearer synthetic-worker-token-at-least-32-characters",
        Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_active_listings", arguments: { limit: 2 } } }),
    }), { DB: db, MCP_BEARER_TOKEN: "synthetic-worker-token-at-least-32-characters",
      EBAY_ENVIRONMENT: "sandbox", EBAY_CLIENT_ID: config.clientId, EBAY_CLIENT_SECRET: config.clientSecret,
      EBAY_RUNAME: config.runame, EBAY_CALLBACK_URL: config.callbackUrl, EBAY_TOKEN_KEY_SANDBOX: sandboxKey } as WorkerEnv);
    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(body).toContain("123456789012");
    expect(body).not.toContain("private-seller-id");
    expect(body).not.toContain("buyer@example.invalid");
    expect(body).not.toContain("synthetic-refresh");
  });
});
