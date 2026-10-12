import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { subjectHash } from "../src/ebay/account-deletion.js";
import type { D1Binding } from "../src/storage/d1.js";
import worker, { type WorkerEnv } from "../src/worker.js";

const endpoint = "https://worker.example.invalid/ebay/account-deletion";
const verificationToken = "synthetic_verification_token_32_chars_long";
const hashKeyBytes = randomBytes(32);
const hashKeyBase64 = hashKeyBytes.toString("base64");
const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const runtime = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok') } }", d1Databases: { DB: "deletion-test" } });
let db: D1Binding;
let env: WorkerEnv;
let hashKey: CryptoKey;
let keyCalls = 0;

function notification(id: string, userId = "synthetic-user-123", publishAttemptCount = 1) {
  return { metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION", schemaVersion: "1.0", deprecated: false },
    notification: { notificationId: id, eventDate: "2026-10-01T00:00:00.000Z", publishDate: "2026-10-01T00:00:01.000Z",
      publishAttemptCount, data: { userId, username: "synthetic-handle", eiasToken: "synthetic-eias" } } };
}

function signedRequest(value: object, valid = true): Request {
  const body = JSON.stringify(value);
  const signature = createSign("sha1").update(valid ? body : body + "tampered").sign(privateKey).toString("base64");
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: "synthetic-key", signature })).toString("base64");
  return new Request(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "x-ebay-signature": header }, body });
}

async function scalar<T>(sql: string, ...values: (string | number | null)[]): Promise<T | null> {
  return db.prepare(sql).bind(...values).first<T>();
}

beforeAll(async () => {
  const d1 = await runtime.getD1Database("DB");
  for (const file of ["001_initial.sql", "002_listing_drafts.sql", "003_ebay_seller_auth.sql", "004_ebay_account_deletion.sql"]) {
    const sql = readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8");
    for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) await d1.prepare(statement).run();
  }
  db = d1 as unknown as D1Binding;
  hashKey = await crypto.subtle.importKey("raw", hashKeyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  env = { DB: db, EBAY_ENVIRONMENT: "sandbox", EBAY_CLIENT_ID: "synthetic-client", EBAY_CLIENT_SECRET: "synthetic-secret",
    EBAY_DELETION_ENDPOINT: endpoint, EBAY_DELETION_VERIFICATION_TOKEN: verificationToken, EBAY_DELETION_HASH_KEY: hashKeyBase64 };
});

afterAll(async () => { await runtime.dispose(); });
beforeEach(() => {
  keyCalls = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/identity/v1/oauth2/token")) return Response.json({ access_token: "synthetic-app-token", expires_in: 3600 });
    if (url.endsWith("/commerce/notification/v1/public_key/synthetic-key")) {
      keyCalls++;
      return Response.json({ key: publicPem });
    }
    throw new Error("Unexpected outbound request");
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Marketplace Account Deletion callback", () => {
  it("returns the exact challenge digest as JSON and fails closed without a secret", async () => {
    const response = await worker.fetch(new Request(`${endpoint}?challenge_code=abc%2B123`), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await response.json()).toEqual({ challengeResponse: createHash("sha256").update(`abc+123${verificationToken}${endpoint}`).digest("hex") });
    expect((await worker.fetch(new Request(`${endpoint}?challenge_code=a&challenge_code=b`), env)).status).toBe(400);
    expect((await worker.fetch(new Request(`${endpoint}?challenge_code=a`), { ...env, EBAY_DELETION_VERIFICATION_TOKEN: "" })).status).toBe(503);
  });

  it("verifies the SDK-style signature, deletes mapped rows atomically, and deduplicates retries", async () => {
    const userHash = await subjectHash(hashKey, "sandbox", "userId", "synthetic-user-123");
    await db.prepare("INSERT INTO sale_items VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind("matched-item", "sku-matched", "CAPTURED", "Synthetic", "{}", 1, "2026-01-01", "2026-01-01").run();
    await db.prepare("INSERT INTO sale_items VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind("unmatched-item", "sku-other", "CAPTURED", "Synthetic", "{}", 1, "2026-01-01", "2026-01-01").run();
    await db.prepare("INSERT INTO listing_drafts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("matched-draft", "matched-item", 1, "Synthetic title", "Synthetic description", "Used", "FIXED_PRICE", null, null, null, "{}", "2026-01-01", "2026-01-01").run();
    await db.prepare("INSERT INTO ebay_seller_connections VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind("sandbox", "synthetic-ciphertext", "2026-01-01", "2026-01-01", 1, "2026-01-01", "2026-01-01").run();
    await db.prepare("INSERT INTO ebay_subject_links VALUES (?, ?, ?, ?, ?)")
      .bind("sandbox", "userId", userHash, "sale_item", "matched-item").run();
    await db.prepare("INSERT INTO ebay_subject_links VALUES (?, ?, ?, ?, ?)")
      .bind("sandbox", "userId", userHash, "seller_connection", "sandbox").run();

    const first = await worker.fetch(signedRequest(notification("synthetic-notification-1")), env);
    expect(keyCalls).toBe(1);
    expect(first.status).toBe(204);
    expect(await scalar("SELECT id FROM sale_items WHERE id = ?", "matched-item")).toBeNull();
    expect(await scalar("SELECT id FROM listing_drafts WHERE id = ?", "matched-draft")).toBeNull();
    expect(await scalar("SELECT environment FROM ebay_seller_connections WHERE environment = ?", "sandbox")).toBeNull();
    expect(await scalar("SELECT id FROM sale_items WHERE id = ?", "unmatched-item")).not.toBeNull();
    expect(await scalar("SELECT identifier_hash FROM ebay_subject_links WHERE target_id = ?", "matched-item")).toBeNull();
    expect(await scalar("SELECT COUNT(*) AS count FROM ebay_deletion_inbox") as { count: number }).toEqual({ count: 1 });

    const replay = await worker.fetch(signedRequest(notification("synthetic-notification-1", "synthetic-user-123", 2)), env);
    expect(replay.status).toBe(204);
    expect(await scalar("SELECT COUNT(*) AS count FROM ebay_deletion_inbox")).toEqual({ count: 1 });
    expect(keyCalls).toBeLessThanOrEqual(1);
  });

  it("rejects invalid signatures, conflicting replays, and never logs subject data", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const invalid = await worker.fetch(signedRequest(notification("synthetic-notification-2"), false), env);
    expect(invalid.status).toBe(412);
    expect((await worker.fetch(new Request(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(notification("synthetic-notification-2")) }), env)).status).toBe(412);
    expect((await worker.fetch(signedRequest(notification("synthetic-notification-2")), env)).status).toBe(204);
    expect((await worker.fetch(signedRequest(notification("synthetic-notification-2", "different-synthetic-user")), env)).status).toBe(503);
    expect(await scalar("SELECT COUNT(*) AS count FROM ebay_deletion_inbox")).toEqual({ count: 2 });
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("does not acknowledge a valid notification when D1 is unavailable", async () => {
    const failure = await worker.fetch(signedRequest(notification("synthetic-notification-3")), { ...env, DB: {} as D1Binding });
    expect(failure.status).toBe(503);
  });

  it("fails closed while a seller connection lacks an immutable subject link", async () => {
    await db.prepare("INSERT INTO ebay_seller_connections VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind("sandbox", "synthetic-ciphertext", "2026-01-01", "2026-01-01", 1, "2026-01-01", "2026-01-01").run();
    expect((await worker.fetch(signedRequest(notification("synthetic-notification-unlinked")), env)).status).toBe(503);
    expect(await scalar("SELECT COUNT(*) AS count FROM ebay_deletion_inbox")).toEqual({ count: 2 });
    await db.prepare("DELETE FROM ebay_seller_connections WHERE environment = ?").bind("sandbox").run();
  });

  it("rolls back the inbox when deletion fails, then accepts a retry", async () => {
    const userHash = await subjectHash(hashKey, "sandbox", "userId", "synthetic-rollback-user");
    await db.prepare("INSERT INTO sale_items VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("rollback-item", "sku-rollback", "CAPTURED", "Synthetic", "{}", 1, "2026-01-01", "2026-01-01").run();
    await db.prepare("INSERT INTO ebay_subject_links VALUES (?, ?, ?, ?, ?)")
      .bind("sandbox", "userId", userHash, "sale_item", "rollback-item").run();
    await db.prepare("CREATE TRIGGER reject_deletion BEFORE DELETE ON sale_items WHEN OLD.id = 'rollback-item' BEGIN SELECT RAISE(ABORT, 'test failure'); END").bind().run();
    const payload = notification("synthetic-notification-rollback", "synthetic-rollback-user");
    expect((await worker.fetch(signedRequest(payload), env)).status).toBe(503);
    expect(await scalar("SELECT id FROM sale_items WHERE id = ?", "rollback-item")).not.toBeNull();
    expect(await scalar("SELECT COUNT(*) AS count FROM ebay_deletion_inbox")).toEqual({ count: 2 });
    await db.prepare("DROP TRIGGER reject_deletion").bind().run();
    expect((await worker.fetch(signedRequest(payload), env)).status).toBe(204);
    expect(await scalar("SELECT id FROM sale_items WHERE id = ?", "rollback-item")).toBeNull();
  });
});
