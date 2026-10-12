import { ebayApiBaseUrl, type EbayEnvironment } from "./config.js";
import type { D1Binding } from "../storage/d1.js";

const PATH = "/ebay/account-deletion";
const SCOPE = "https://api.ebay.com/oauth/api_scope";
const MAX_BODY_BYTES = 16 * 1024;
const encoder = new TextEncoder();
const keyCache = new Map<string, { key: CryptoKey; expires: number }>();
const tokenCache = new Map<string, { token: string; expires: number }>();

export interface DeletionEnv {
  DB: D1Binding;
  EBAY_ENVIRONMENT?: string;
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  EBAY_DELETION_ENDPOINT?: string;
  EBAY_DELETION_VERIFICATION_TOKEN?: string;
  EBAY_DELETION_HASH_KEY?: string;
}

interface Settings {
  environment: EbayEnvironment;
  endpoint: string;
  verificationToken: string;
  hashKey: CryptoKey;
  clientId: string;
  clientSecret: string;
}

interface DeletionNotice {
  notificationId: string;
  userId: string;
  username?: string;
  eiasToken?: string;
}

function base64(value: string, maxLength: number): Uint8Array<ArrayBuffer> {
  if (!value || value.length > maxLength || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("INVALID_BASE64");
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  if (btoa(String.fromCharCode(...bytes)) !== value) throw new Error("INVALID_BASE64");
  return bytes;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function settings(env: DeletionEnv): Promise<Settings> {
  if (env.EBAY_ENVIRONMENT !== "sandbox" && env.EBAY_ENVIRONMENT !== "production") throw new Error("DELETION_NOT_CONFIGURED");
  const endpoint = env.EBAY_DELETION_ENDPOINT;
  const token = env.EBAY_DELETION_VERIFICATION_TOKEN;
  if (!endpoint || !token || !/^[A-Za-z0-9_-]{32,80}$/.test(token) || !env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
    throw new Error("DELETION_NOT_CONFIGURED");
  }
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.pathname !== PATH || url.search || url.hash || url.href !== endpoint || url.username || url.password) {
    throw new Error("DELETION_NOT_CONFIGURED");
  }
  const rawKey = base64(env.EBAY_DELETION_HASH_KEY ?? "", 44);
  if (rawKey.length !== 32) throw new Error("DELETION_NOT_CONFIGURED");
  return {
    environment: env.EBAY_ENVIRONMENT,
    endpoint,
    verificationToken: token,
    hashKey: await crypto.subtle.importKey("raw", rawKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
    clientId: env.EBAY_CLIENT_ID,
    clientSecret: env.EBAY_CLIENT_SECRET,
  };
}

/** Stable, private lookup key for a subject association. Never store raw eBay identifiers. */
export async function subjectHash(hashKey: CryptoKey, environment: EbayEnvironment, kind: "userId" | "username" | "eiasToken", value: string): Promise<string> {
  return hex(await crypto.subtle.sign("HMAC", hashKey, encoder.encode(`${environment}:${kind}:${value}`)));
}

async function privateHash(hashKey: CryptoKey, environment: EbayEnvironment, kind: string, value: string): Promise<string> {
  return hex(await crypto.subtle.sign("HMAC", hashKey, encoder.encode(`${environment}:${kind}:${value}`)));
}

async function challenge(requestUrl: URL, config: Settings): Promise<Response> {
  const codes = requestUrl.searchParams.getAll("challenge_code");
  if (codes.length !== 1 || !codes[0] || codes[0].length > 512 || [...requestUrl.searchParams.keys()].some((key) => key !== "challenge_code")) {
    return new Response("Bad request", { status: 400 });
  }
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(codes[0] + config.verificationToken + config.endpoint));
  return new Response(JSON.stringify({ challengeResponse: hex(digest) }), {
    status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function bodyText(request: Request): Promise<string> {
  const length = request.headers.get("Content-Length");
  if (length && Number(length) > MAX_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("EMPTY_BODY");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new Error("BODY_TOO_LARGE"); }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function optionalIdentifier(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 512 ? value : undefined;
}

function notice(value: unknown): DeletionNotice | null {
  const payload = record(value);
  const metadata = record(payload?.metadata);
  const notification = record(payload?.notification);
  const data = record(notification?.data);
  if (metadata?.topic !== "MARKETPLACE_ACCOUNT_DELETION" || metadata.schemaVersion !== "1.0" || !notification || !data) return null;
  const notificationId = optionalIdentifier(notification.notificationId);
  const userId = optionalIdentifier(data.userId);
  if (!notificationId || !userId) return null;
  if ((data.username !== undefined && !optionalIdentifier(data.username)) ||
      (data.eiasToken !== undefined && !optionalIdentifier(data.eiasToken))) return null;
  const username = optionalIdentifier(data.username);
  const eiasToken = optionalIdentifier(data.eiasToken);
  return {
    notificationId, userId,
    ...(username ? { username } : {}),
    ...(eiasToken ? { eiasToken } : {}),
  };
}

async function appToken(config: Settings): Promise<string> {
  const cacheId = `${config.environment}:${config.clientId}`;
  const cached = tokenCache.get(cacheId);
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const response = await fetch(`${ebayApiBaseUrl(config.environment)}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: SCOPE }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("TOKEN_UNAVAILABLE");
  const value = record(await response.json());
  if (typeof value?.access_token !== "string" || !value.access_token || typeof value.expires_in !== "number" || value.expires_in <= 0) {
    throw new Error("TOKEN_UNAVAILABLE");
  }
  tokenCache.set(cacheId, { token: value.access_token, expires: Date.now() + Math.min(value.expires_in, 3600) * 1000 });
  return value.access_token;
}

function pemBytes(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || value.length > 4096) throw new Error("KEY_UNAVAILABLE");
  const match = /^-----BEGIN PUBLIC KEY-----\s*([A-Za-z0-9+/=\s]+)\s*-----END PUBLIC KEY-----\s*$/.exec(value);
  if (!match?.[1]) throw new Error("KEY_UNAVAILABLE");
  return base64(match[1].replace(/\s/g, ""), 4096);
}

async function publicKey(config: Settings, kid: string): Promise<CryptoKey> {
  const cacheId = `${config.environment}:${config.clientId}:${kid}`;
  const cached = keyCache.get(cacheId);
  if (cached && cached.expires > Date.now()) return cached.key;
  const response = await fetch(`${ebayApiBaseUrl(config.environment)}/commerce/notification/v1/public_key/${encodeURIComponent(kid)}`, {
    headers: { Authorization: `Bearer ${await appToken(config)}`, Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("KEY_UNAVAILABLE");
  const key = await crypto.subtle.importKey("spki", pemBytes(record(await response.json())?.key), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  keyCache.set(cacheId, { key, expires: Date.now() + 60 * 60_000 });
  return key;
}

// eBay's Node SDK verifies DER ECDSA signatures. WebCrypto expects P1363 (r || s).
function derToP1363(der: Uint8Array): Uint8Array<ArrayBuffer> {
  let pos = 0;
  function length(): number {
    const first = der[pos++];
    if (first === undefined) throw new Error("BAD_SIGNATURE");
    if (first < 128) return first;
    if (first !== 0x81 || der[pos] === undefined || der[pos]! < 128) throw new Error("BAD_SIGNATURE");
    return der[pos++]!;
  }
  if (der[pos++] !== 0x30 || length() !== der.length - pos) throw new Error("BAD_SIGNATURE");
  function integer(): Uint8Array {
    if (der[pos++] !== 0x02) throw new Error("BAD_SIGNATURE");
    const count = length();
    if (count < 1 || count > 33 || pos + count > der.length) throw new Error("BAD_SIGNATURE");
    let part = der.subarray(pos, pos + count);
    pos += count;
    if (part.length === 33) {
      if (part[0] !== 0 || (part[1]! & 0x80) === 0) throw new Error("BAD_SIGNATURE");
      part = part.subarray(1);
    } else if ((part[0]! & 0x80) !== 0 || (part.length > 1 && part[0] === 0 && (part[1]! & 0x80) === 0)) {
      throw new Error("BAD_SIGNATURE");
    }
    const output = new Uint8Array(32);
    output.set(part, 32 - part.length);
    return output;
  }
  const r = integer();
  const s = integer();
  if (pos !== der.length) throw new Error("BAD_SIGNATURE");
  const result = new Uint8Array(64);
  result.set(r);
  result.set(s, 32);
  return result;
}

async function validSignature(message: unknown, signatureHeader: string | null, config: Settings): Promise<boolean> {
  if (!signatureHeader || signatureHeader.length > 2048) return false;
  let signature: Record<string, unknown> | null;
  try { signature = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(base64(signatureHeader, 2048)))); }
  catch { return false; }
  if (!signature || typeof signature.kid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(signature.kid) || typeof signature.signature !== "string") return false;
  try {
    const bytes = derToP1363(base64(signature.signature, 256));
    const key = await publicKey(config, signature.kid);
    // Match the official Node SDK's JSON.stringify(message) verification input.
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-1" }, key, bytes, encoder.encode(JSON.stringify(message)));
  } catch (error) {
    if (error instanceof Error && (error.message === "TOKEN_UNAVAILABLE" || error.message === "KEY_UNAVAILABLE")) throw error;
    return false;
  }
}

async function processNotice(db: D1Binding, config: Settings, item: DeletionNotice): Promise<void> {
  const environment = config.environment;
  // A seller connection is real account data. Refuse to acknowledge any event until
  // the connected seller's immutable identity has been linked for this environment.
  const unlinkedSeller = await db.prepare(`SELECT c.environment FROM ebay_seller_connections c
    WHERE c.environment = ? AND NOT EXISTS (SELECT 1 FROM ebay_subject_links l
      WHERE l.environment = c.environment AND l.target_type = 'seller_connection'
        AND l.target_id = c.environment AND l.identifier_kind = 'userId')`)
    .bind(environment).first<{ environment: string }>();
  if (unlinkedSeller) throw new Error("DELETION_COVERAGE_INCOMPLETE");
  const [notificationHash, userHash, usernameHash, eiasHash] = await Promise.all([
    privateHash(config.hashKey, environment, "notificationId", item.notificationId),
    subjectHash(config.hashKey, environment, "userId", item.userId),
    item.username ? subjectHash(config.hashKey, environment, "username", item.username) : Promise.resolve(null),
    item.eiasToken ? subjectHash(config.hashKey, environment, "eiasToken", item.eiasToken) : Promise.resolve(null),
  ]);
  const existing = await db.prepare("SELECT user_hash FROM ebay_deletion_inbox WHERE environment = ? AND notification_hash = ?")
    .bind(environment, notificationHash).first<{ user_hash: string }>();
  if (existing) {
    if (existing.user_hash !== userHash) throw new Error("NOTIFICATION_CONFLICT");
    return;
  }
  const match = `environment = ? AND ((identifier_kind = 'userId' AND identifier_hash = ?) OR
    (identifier_kind = 'username' AND identifier_hash = ?) OR (identifier_kind = 'eiasToken' AND identifier_hash = ?))`;
  const subject = [environment, userHash, usernameHash, eiasHash, environment, notificationHash, userHash];
  const permitted = "EXISTS (SELECT 1 FROM ebay_deletion_inbox WHERE environment = ? AND notification_hash = ? AND user_hash = ?)";
  const itemIds = `SELECT target_id FROM ebay_subject_links WHERE target_type = 'sale_item' AND ${match} AND ${permitted}`;
  const sellerIds = `SELECT target_id FROM ebay_subject_links WHERE target_type = 'seller_connection' AND ${match} AND ${permitted}`;
  // D1 batch executes as one transaction: a failure rolls back both the inbox and deletion.
  const results = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO ebay_deletion_inbox (environment, notification_hash, user_hash, processed_at)
      SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM ebay_seller_connections c WHERE c.environment = ?
        AND NOT EXISTS (SELECT 1 FROM ebay_subject_links l WHERE l.environment = c.environment
          AND l.target_type = 'seller_connection' AND l.target_id = c.environment AND l.identifier_kind = 'userId'))`)
      .bind(environment, notificationHash, userHash, new Date().toISOString(), environment),
    db.prepare(`DELETE FROM listing_drafts WHERE item_id IN (${itemIds})`).bind(...subject),
    db.prepare(`DELETE FROM sale_items WHERE id IN (${itemIds})`).bind(...subject),
    db.prepare(`DELETE FROM ebay_seller_connections WHERE environment IN (${sellerIds})`).bind(...subject),
    db.prepare(`DELETE FROM ebay_subject_links WHERE environment = ? AND (
      (target_type = 'sale_item' AND NOT EXISTS (SELECT 1 FROM sale_items WHERE id = target_id)) OR
      (target_type = 'seller_connection' AND NOT EXISTS (SELECT 1 FROM ebay_seller_connections WHERE environment = target_id)))`).bind(environment),
  ]);
  const inserted = results[0] as { meta?: { changes?: number } } | undefined;
  if (inserted?.meta?.changes !== 1) {
    const row = await db.prepare("SELECT user_hash FROM ebay_deletion_inbox WHERE environment = ? AND notification_hash = ?")
      .bind(environment, notificationHash).first<{ user_hash: string }>();
    if (row?.user_hash !== userHash) throw new Error("NOTIFICATION_CONFLICT");
  }
}

export async function handleAccountDeletion(request: Request, env: DeletionEnv): Promise<Response> {
  const noStore = { "Cache-Control": "no-store" };
  if (request.method !== "GET" && request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: noStore });
  let config: Settings;
  try { config = await settings(env); } catch { return new Response("Unavailable", { status: 503, headers: noStore }); }
  const url = new URL(request.url);
  if (url.origin + url.pathname !== config.endpoint) return new Response("Misdirected request", { status: 421, headers: noStore });
  if (request.method === "GET") return challenge(url, config);
  if (url.search) return new Response("Bad request", { status: 400, headers: noStore });
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return new Response("Unsupported media type", { status: 415, headers: noStore });
  }
  let payload: unknown;
  try { payload = JSON.parse(await bodyText(request)); } catch { return new Response("Bad request", { status: 400, headers: noStore }); }
  let verified: boolean;
  try { verified = await validSignature(payload, request.headers.get("x-ebay-signature"), config); }
  catch { return new Response("Unavailable", { status: 503, headers: noStore }); }
  if (!verified) return new Response("Invalid signature", { status: 412, headers: noStore });
  const item = notice(payload);
  if (!item) return new Response("Unsupported notification", { status: 422, headers: noStore });
  try { await processNotice(env.DB, config, item); }
  catch { return new Response("Unavailable", { status: 503, headers: noStore }); }
  return new Response(null, { status: 204, headers: noStore });
}
