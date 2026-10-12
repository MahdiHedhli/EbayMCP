import { ebayApiBaseUrl } from "./config.js";
import { deletionSubjectDigest } from "./subject-digest.js";
import type { WorkerEnv } from "../worker.js";

const PATH = "/ebay/marketplace-account-deletion";
const MAX_BODY = 16_384;
const MAX_HEADER = 2_048;
const keyCache = new Map<string, { key: CryptoKey; expires: number }>();
const encoder = new TextEncoder();

type SignatureHeader = { alg: string; kid: string; signature: string; digest: string };
type DeletionMessage = {
  metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION"; schemaVersion: "1.0"; deprecated: false };
  notification: { notificationId: string; data: { userId: string; username?: string; eiasToken?: string } };
};

function plain(status: number): Response {
  return new Response(null, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

function endpoint(env: WorkerEnv): string | null {
  try {
    if (!env.EBAY_DELETION_ENDPOINT) return null;
    const value = new URL(env.EBAY_DELETION_ENDPOINT);
    if (value.protocol !== "https:" || value.pathname !== PATH || value.search || value.hash ||
      value.username || value.password || value.href !== env.EBAY_DELETION_ENDPOINT) return null;
    return value.href;
  } catch { return null; }
}

function decodeBase64(value: string, max: number): Uint8Array<ArrayBuffer> {
  if (value.length > max || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error("INVALID_BASE64");
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  if (btoa(String.fromCharCode(...bytes)) !== value) throw new Error("INVALID_BASE64");
  return bytes;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_OBJECT");
  return value as Record<string, unknown>;
}

function parseHeader(value: string | null): SignatureHeader {
  if (!value || value.length > MAX_HEADER) throw new Error("INVALID_SIGNATURE");
  const parsed = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64(value, MAX_HEADER))));
  if (typeof parsed.alg !== "string" || parsed.alg.toLowerCase() !== "ecdsa" ||
    (parsed.digest !== "SHA1" && parsed.digest !== "SHA256") ||
    typeof parsed.kid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(parsed.kid) ||
    typeof parsed.signature !== "string") throw new Error("INVALID_SIGNATURE");
  decodeBase64(parsed.signature, 256);
  return parsed as SignatureHeader;
}

// eBay sends ASN.1 DER ECDSA signatures; WebCrypto expects fixed-width r || s.
function derToRaw(der: Uint8Array): Uint8Array<ArrayBuffer> {
  if (der.length < 8 || der.length > 80 || der[0] !== 0x30 || der[1] !== der.length - 2) throw new Error("INVALID_SIGNATURE");
  let offset = 2;
  const parts: Uint8Array[] = [];
  for (let n = 0; n < 2; n++) {
    if (der[offset++] !== 0x02) throw new Error("INVALID_SIGNATURE");
    const size = der[offset++];
    if (!size || size > 33 || offset + size > der.length) throw new Error("INVALID_SIGNATURE");
    let part = der.slice(offset, offset + size);
    offset += size;
    if (part[0]! & 0x80 || (part.length > 1 && part[0] === 0 && !(part[1]! & 0x80))) throw new Error("INVALID_SIGNATURE");
    if (part.length === 33) {
      if (part[0] !== 0) throw new Error("INVALID_SIGNATURE");
      part = part.slice(1);
    }
    const padded = new Uint8Array(32);
    padded.set(part, 32 - part.length);
    parts.push(padded);
  }
  if (offset !== der.length) throw new Error("INVALID_SIGNATURE");
  const raw = new Uint8Array(64);
  raw.set(parts[0]!, 0); raw.set(parts[1]!, 32);
  return raw;
}

async function appToken(env: WorkerEnv): Promise<string> {
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET ||
    (env.EBAY_ENVIRONMENT !== "production" && env.EBAY_ENVIRONMENT !== "sandbox")) throw new Error("NOT_CONFIGURED");
  const response = await fetch(`${ebayApiBaseUrl(env.EBAY_ENVIRONMENT)}/identity/v1/oauth2/token`, {
    method: "POST", headers: { Authorization: `Basic ${btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }),
  });
  if (!response.ok) throw new Error("TOKEN_UNAVAILABLE");
  const data = object(await response.json());
  if (typeof data.access_token !== "string" || !data.access_token || data.access_token.length > 4096) throw new Error("TOKEN_INVALID");
  return data.access_token;
}

async function publicKey(env: WorkerEnv, kid: string): Promise<CryptoKey> {
  const environment = env.EBAY_ENVIRONMENT;
  if (environment !== "sandbox" && environment !== "production") throw new Error("NOT_CONFIGURED");
  const cacheId = `${environment}:${kid}`;
  const cached = keyCache.get(cacheId);
  if (cached && cached.expires > Date.now()) return cached.key;
  const response = await fetch(`${ebayApiBaseUrl(environment)}/commerce/notification/v1/public_key/${encodeURIComponent(kid)}`, {
    headers: { Authorization: `Bearer ${await appToken(env)}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error("KEY_UNAVAILABLE");
  const value = object(await response.json());
  if (typeof value.key !== "string" || value.key.length > 4096) throw new Error("KEY_INVALID");
  const encoded = value.key.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, "");
  const spki = decodeBase64(encoded, 4096);
  const key = await crypto.subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  if (key.algorithm.name !== "ECDSA") throw new Error("KEY_INVALID");
  if (keyCache.size >= 100) keyCache.delete(keyCache.keys().next().value!);
  keyCache.set(cacheId, { key, expires: Date.now() + 3_600_000 });
  return key;
}

async function bodyBytes(request: Request): Promise<Uint8Array<ArrayBuffer>> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("EMPTY_BODY");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > MAX_BODY) { await reader.cancel(); throw new Error("BODY_TOO_LARGE"); }
    chunks.push(part.value);
  }
  if (!size) throw new Error("EMPTY_BODY");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

function parseMessage(raw: Uint8Array): DeletionMessage {
  const message = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)));
  const metadata = object(message.metadata);
  const notification = object(message.notification);
  const data = object(notification.data);
  if (metadata.topic !== "MARKETPLACE_ACCOUNT_DELETION" || metadata.schemaVersion !== "1.0" ||
    metadata.deprecated !== false || typeof notification.notificationId !== "string" ||
    !/^[A-Za-z0-9-]{16,80}$/.test(notification.notificationId) ||
    typeof data.userId !== "string" || !data.userId || data.userId.length > 128 ||
    (data.username !== undefined && typeof data.username !== "string") ||
    (data.eiasToken !== undefined && typeof data.eiasToken !== "string")) throw new Error("INVALID_MESSAGE");
  return message as DeletionMessage;
}

async function challenge(request: Request, env: WorkerEnv, configuredEndpoint: string): Promise<Response> {
  const url = new URL(request.url);
  const codes = url.searchParams.getAll("challenge_code");
  const token = env.EBAY_DELETION_VERIFICATION_TOKEN;
  if (codes.length !== 1 || [...url.searchParams.keys()].some((key) => key !== "challenge_code") ||
    !codes[0] || codes[0].length > 256 || !token || !/^[A-Za-z0-9_-]{32,80}$/.test(token)) return plain(400);
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(codes[0] + token + configuredEndpoint));
  const hex = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return new Response(JSON.stringify({ challengeResponse: hex }), { status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

export async function accountDeletionRoute(request: Request, env: WorkerEnv): Promise<Response> {
  const configuredEndpoint = endpoint(env);
  const url = new URL(request.url);
  if (!configuredEndpoint || url.origin + url.pathname !== configuredEndpoint) return plain(404);
  if (request.method === "GET") return challenge(request, env, configuredEndpoint);
  if (request.method !== "POST") return plain(405);
  if (url.search || request.headers.get("Content-Type")?.toLowerCase() !== "application/json" ||
    (request.headers.has("Content-Encoding") && request.headers.get("Content-Encoding") !== "identity")) return plain(415);
  const length = request.headers.get("Content-Length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) return plain(413);
  let signature: SignatureHeader;
  try { signature = parseHeader(request.headers.get("X-EBAY-SIGNATURE")); }
  catch { return plain(412); }
  let raw: Uint8Array<ArrayBuffer>;
  try { raw = await bodyBytes(request); }
  catch { return plain(413); }
  try {
    const verified = await crypto.subtle.verify({ name: "ECDSA", hash: signature.digest === "SHA1" ? "SHA-1" : "SHA-256" },
      await publicKey(env, signature.kid), derToRaw(decodeBase64(signature.signature, 256)), raw);
    if (!verified) return plain(412);
    const message = parseMessage(raw);
    // A legacy connection with no immutable identity could belong to this user.
    // No notification is acknowledged while such a connection exists.
    const unbound = await env.DB.prepare("SELECT environment FROM ebay_seller_connections WHERE environment = ? AND ebay_user_id IS NULL LIMIT 1")
      .bind(env.EBAY_ENVIRONMENT ?? "").first();
    if (unbound) return plain(503);
    const now = new Date().toISOString();
    const encryptionKey = env.EBAY_ENVIRONMENT === "production" ? env.EBAY_TOKEN_KEY_PRODUCTION : env.EBAY_TOKEN_KEY_SANDBOX;
    if (!encryptionKey || (env.EBAY_ENVIRONMENT !== "sandbox" && env.EBAY_ENVIRONMENT !== "production")) throw new Error("KEY_UNAVAILABLE");
    const subjectDigest = await deletionSubjectDigest(message.notification.data.userId, encryptionKey, env.EBAY_ENVIRONMENT);
    const statements = [
      env.DB.prepare("DELETE FROM ebay_account_deletion_receipts WHERE processed_at < ?")
        .bind(new Date(Date.now() - 90 * 86_400_000).toISOString()),
      env.DB.prepare("INSERT OR IGNORE INTO ebay_account_deletion_receipts(notification_id, subject_digest, processed_at, erased_connections) VALUES (?, ?, ?, 0)")
        .bind(message.notification.notificationId, subjectDigest, now),
      env.DB.prepare(`DELETE FROM ebay_seller_connections WHERE environment = ? AND ebay_user_id = ?
        AND EXISTS (SELECT 1 FROM ebay_account_deletion_receipts WHERE notification_id = ? AND subject_digest = ?)`)
        .bind(env.EBAY_ENVIRONMENT, message.notification.data.userId, message.notification.notificationId, subjectDigest),
      env.DB.prepare("UPDATE ebay_account_deletion_receipts SET erased_connections = MAX(erased_connections, changes()) WHERE notification_id = ?")
        .bind(message.notification.notificationId),
    ];
    const results = await env.DB.batch(statements) as Array<{ meta?: { changes?: number } }>;
    const erased = results[2]?.meta?.changes;
    if (!Number.isInteger(erased) || erased! < 0) throw new Error("D1_RESULT_INVALID");
    const receipt = await env.DB.prepare("SELECT subject_digest FROM ebay_account_deletion_receipts WHERE notification_id = ?")
      .bind(message.notification.notificationId).first<{ subject_digest: string }>();
    if (receipt?.subject_digest !== subjectDigest) throw new Error("NOTIFICATION_ID_CONFLICT");
    return plain(204);
  } catch {
    // No request body, signature, identifier, or upstream error is logged or returned.
    return plain(503);
  }
}
