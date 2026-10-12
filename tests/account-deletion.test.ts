import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import worker, { type WorkerEnv } from "../src/worker.js";
import { EBAY_D1_PRIVACY_REGISTRY } from "../src/ebay/privacy-registry.js";
import type { D1Binding } from "../src/storage/d1.js";

const endpoint = "https://worker.example.invalid/ebay/marketplace-account-deletion";
const verificationToken = "synthetic_verification_token_0123456789";
const tokenEncryptionKey = btoa("01234567890123456789012345678901");
const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const payload = (userId = "synthetic-user-one", notificationId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee") => JSON.stringify({
  metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION", schemaVersion: "1.0", deprecated: false },
  notification: { notificationId, eventDate: "2026-01-01T00:00:00.000Z", publishDate: "2026-01-01T00:00:01.000Z",
    publishAttemptCount: 1, data: { username: "synthetic-name", userId, eiasToken: "synthetic-eias" } },
});
function request(body: string, signBody = body, digest: "SHA1" | "SHA256" = "SHA1"): Request {
  const signature = createSign(digest).update(signBody).sign(keys.privateKey).toString("base64");
  const header = Buffer.from(JSON.stringify({ alg: "ecdsa", kid: "synthetic-key", digest, signature })).toString("base64");
  return new Request(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "X-EBAY-SIGNATURE": header }, body });
}

describe("eBay marketplace account deletion", () => {
  const runtime = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "account-deletion-test-db" } });
  let db: D1Binding;
  let rawDb: Awaited<ReturnType<typeof runtime.getD1Database>>;
  let env: WorkerEnv;

  beforeAll(async () => {
    rawDb = await runtime.getD1Database("DB");
    for (const file of ["001_initial.sql", "002_listing_drafts.sql", "003_ebay_seller_auth.sql", "004_marketplace_account_deletion.sql"]) {
      const sql = readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8");
      for (const statement of sql.split(/;\s*\n/).map((part) => part.trim()).filter(Boolean)) await rawDb.prepare(statement).run();
    }
    db = rawDb as unknown as D1Binding;
    env = { DB: db, EBAY_ENVIRONMENT: "production", EBAY_CLIENT_ID: "synthetic-client", EBAY_CLIENT_SECRET: "synthetic-secret",
      EBAY_TOKEN_KEY_PRODUCTION: tokenEncryptionKey, EBAY_DELETION_ENDPOINT: endpoint, EBAY_DELETION_VERIFICATION_TOKEN: verificationToken };
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await db.prepare("DELETE FROM ebay_account_deletion_receipts").bind().run();
    await db.prepare("DELETE FROM ebay_seller_connections").bind().run();
    await db.prepare("DELETE FROM listing_drafts").bind().run();
    await db.prepare("DELETE FROM sale_items").bind().run();
  });
  afterAll(async () => { await runtime.dispose(); });

  function mockEbay() {
    const fetcher = vi.fn(async (url: string) => url.includes("/oauth2/token")
      ? new Response(JSON.stringify({ access_token: "synthetic-app-token" }), { status: 200 })
      : new Response(JSON.stringify({ key: publicPem }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
  }

  async function connection(environment: string, userId: string | null) {
    await db.prepare(`INSERT INTO ebay_seller_connections(environment, encrypted_tokens, access_expires_at,
      refresh_expires_at, version, connected_at, updated_at, ebay_user_id) VALUES (?, ?, ?, ?, 1, ?, ?, ?)`)
      .bind(environment, "synthetic-encrypted-credential", "2099-01-01", "2099-01-01", "2026-01-01", "2026-01-01", userId).run();
  }

  it("computes the exact eBay SHA-256 challenge and rejects ambiguous requests", async () => {
    const code = "synthetic-challenge";
    const response = await worker.fetch(new Request(`${endpoint}?challenge_code=${code}`), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await response.json()).toEqual({ challengeResponse: createHash("sha256")
      .update(code + verificationToken + endpoint).digest("hex") });
    expect((await worker.fetch(new Request(`${endpoint}?challenge_code=x&challenge_code=y`), env)).status).toBe(400);
    expect((await worker.fetch(new Request(`${endpoint}?challenge_code=x&other=y`), env)).status).toBe(400);
    expect((await worker.fetch(new Request(`${endpoint}?challenge_code=x`), { ...env, EBAY_DELETION_VERIFICATION_TOKEN: "" })).status).toBe(400);
    expect((await worker.fetch(new Request(`${endpoint}?challenge_code=x`), { ...env, EBAY_DELETION_ENDPOINT: "" })).status).toBe(404);
  });

  it("verifies a signed POST, erases only a matching connection, and keeps minimal deduplicated audit", async () => {
    mockEbay();
    await connection("production", "synthetic-user-one");
    await connection("sandbox", "synthetic-user-one");
    await db.prepare("INSERT INTO sale_items(id, sku, stage, facts_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind("local-item", "local-sku", "ACQUIRED", "{}", 1, "2026-01-01", "2026-01-01").run();
    expect((await worker.fetch(request(payload()), env)).status).toBe(204);
    expect((await worker.fetch(request(payload()), env)).status).toBe(204);
    expect(await db.prepare("SELECT ebay_user_id FROM ebay_seller_connections WHERE environment = ?").bind("production").first()).toBeNull();
    expect(await db.prepare("SELECT ebay_user_id FROM ebay_seller_connections WHERE environment = ?").bind("sandbox").first()).toEqual({ ebay_user_id: "synthetic-user-one" });
    expect(await db.prepare("SELECT id FROM sale_items WHERE id = ?").bind("local-item").first()).toEqual({ id: "local-item" });
    const receipts = await rawDb.prepare("SELECT * FROM ebay_account_deletion_receipts").all();
    expect(receipts.results).toHaveLength(1);
    expect(receipts.results[0]).toMatchObject({ notification_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", erased_connections: 1 });
    expect(JSON.stringify(receipts)).not.toContain("synthetic-user-one");
    expect((receipts.results[0] as { subject_digest: string }).subject_digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects unsigned, tampered, wrong-type, and oversized requests without recording or deleting", async () => {
    mockEbay();
    await connection("production", "synthetic-user-one");
    const unsigned = new Request(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload() });
    expect((await worker.fetch(unsigned, env)).status).toBe(412);
    expect((await worker.fetch(request(payload("synthetic-user-one"), payload("another-user")), env)).status).toBe(412);
    expect((await worker.fetch(new Request(endpoint, { method: "POST", headers: { "Content-Type": "text/plain" }, body: payload() }), env)).status).toBe(415);
    expect((await worker.fetch(request("x".repeat(16_385)), env)).status).toBe(413);
    expect(await db.prepare("SELECT ebay_user_id FROM ebay_seller_connections WHERE environment = ?").bind("production").first()).toEqual({ ebay_user_id: "synthetic-user-one" });
    expect((await rawDb.prepare("SELECT notification_id FROM ebay_account_deletion_receipts").all()).results).toHaveLength(0);
  });

  it("does not erase a second subject when a notification ID is reused", async () => {
    mockEbay();
    expect((await worker.fetch(request(payload("synthetic-user-one")), env)).status).toBe(204);
    await connection("production", "synthetic-user-two");
    expect((await worker.fetch(request(payload("synthetic-user-two")), env)).status).toBe(503);
    expect(await db.prepare("SELECT ebay_user_id FROM ebay_seller_connections WHERE environment = ?").bind("production").first())
      .toEqual({ ebay_user_id: "synthetic-user-two" });
  });

  it("accepts eBay's documented SHA256 signature variant and rejects an unknown schema", async () => {
    mockEbay();
    expect((await worker.fetch(request(payload("synthetic-user-three", "bbbbbbbb-cccc-dddd-eeee-ffffffffffff"),
      payload("synthetic-user-three", "bbbbbbbb-cccc-dddd-eeee-ffffffffffff"), "SHA256"), env)).status).toBe(204);
    const unknown = payload("synthetic-user-four", "cccccccc-dddd-eeee-ffff-aaaaaaaaaaaa").replace('"schemaVersion":"1.0"', '"schemaVersion":"2.0"');
    expect((await worker.fetch(request(unknown), env)).status).toBe(503);
    expect((await rawDb.prepare("SELECT notification_id FROM ebay_account_deletion_receipts").all()).results).toHaveLength(1);
  });

  it("fails closed on an unbound legacy connection", async () => {
    mockEbay();
    await db.prepare("DROP TRIGGER ebay_connection_subject_insert").bind().run();
    await connection("production", null);
    expect((await worker.fetch(request(payload()), env)).status).toBe(503);
    expect((await rawDb.prepare("SELECT notification_id FROM ebay_account_deletion_receipts").all()).results).toHaveLength(0);
  });

  it("requires an explicit privacy classification for every application D1 table", async () => {
    const tables = await rawDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_cf_METADATA' ORDER BY name").all<{ name: string }>();
    expect(tables.results.map((row: { name: string }) => row.name).sort()).toEqual(Object.keys(EBAY_D1_PRIVACY_REGISTRY).sort());
    for (const table of tables.results) {
      const columns = await rawDb.prepare(`PRAGMA table_info(${table.name})`).all<{ name: string }>();
      expect(columns.results.map((column: { name: string }) => column.name)).toEqual(
        EBAY_D1_PRIVACY_REGISTRY[table.name as keyof typeof EBAY_D1_PRIVACY_REGISTRY].columns,
      );
    }
  });

  it("prunes old audit receipts on the scheduled Worker path", async () => {
    await db.prepare("INSERT INTO ebay_account_deletion_receipts(notification_id, subject_digest, processed_at, erased_connections) VALUES (?, ?, ?, 0)")
      .bind("old-synthetic-notification", "synthetic-digest", "2020-01-01T00:00:00.000Z").run();
    await worker.scheduled({}, env);
    expect(await db.prepare("SELECT notification_id FROM ebay_account_deletion_receipts WHERE notification_id = ?")
      .bind("old-synthetic-notification").first()).toBeNull();
  });
});
