import { ebayApiBaseUrl, ebayAuthBaseUrl, type EbayConfig } from "./config.js";
import type { D1Binding } from "../storage/d1.js";

const SCOPE = "https://api.ebay.com/oauth/api_scope";
const STATE_LIFETIME_MS = 5 * 60_000;
const encoder = new TextEncoder();

interface TokenBundle { accessToken: string; refreshToken: string }
interface ConnectionRow {
  encrypted_tokens: string;
  access_expires_at: string;
  refresh_expires_at: string;
  version: number;
  connected_at: string;
}

function configured(config: EbayConfig): asserts config is EbayConfig & {
  clientId: string; clientSecret: string; runame: string; tokenEncryptionKey: string; callbackUrl: string;
} {
  if (!config.clientId || !config.clientSecret || !config.runame || !config.tokenEncryptionKey || !config.callbackUrl) {
    throw new Error("EBAY_NOT_CONFIGURED");
  }
  const callback = new URL(config.callbackUrl);
  if (callback.protocol !== "https:" || callback.pathname !== "/ebay/oauth/callback" || callback.search || callback.hash) throw new Error("EBAY_NOT_CONFIGURED");
}

function base64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)); }
function unbase64(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error("EBAY_KEY_INVALID");
  const bytes = new Uint8Array(32);
  bytes.set(Uint8Array.from(atob(value), (char) => char.charCodeAt(0)));
  return bytes;
}
async function digest(value: string): Promise<string> {
  return base64(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}
async function key(config: EbayConfig): Promise<CryptoKey> {
  configured(config);
  return crypto.subtle.importKey("raw", unbase64(config.tokenEncryptionKey), "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(config: EbayConfig, tokens: TokenBundle): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(`ebay-seller:${config.environment}:v1`) },
    await key(config), encoder.encode(JSON.stringify(tokens)));
  return JSON.stringify({ v: 1, iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)) });
}
async function open(config: EbayConfig, sealed: string): Promise<TokenBundle> {
  const payload = JSON.parse(sealed) as { v: number; iv: string; ciphertext: string };
  if (payload.v !== 1) throw new Error("EBAY_CREDENTIAL_UNAVAILABLE");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unbase64Iv(payload.iv), additionalData: encoder.encode(`ebay-seller:${config.environment}:v1`) },
    await key(config), Uint8Array.from(atob(payload.ciphertext), (char) => char.charCodeAt(0)));
  const value = JSON.parse(new TextDecoder().decode(plain)) as TokenBundle;
  if (!value.accessToken || !value.refreshToken) throw new Error("EBAY_CREDENTIAL_UNAVAILABLE");
  return value;
}
function unbase64Iv(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]{16}$/.test(value)) throw new Error("EBAY_CREDENTIAL_UNAVAILABLE");
  const bytes = new Uint8Array(12);
  bytes.set(Uint8Array.from(atob(value), (char) => char.charCodeAt(0)));
  return bytes;
}
function validSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > 5 * 366 * 86400) throw new Error("EBAY_TOKEN_RESPONSE_INVALID");
  return value;
}
function tokenAuth(config: EbayConfig): string {
  configured(config);
  return `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`;
}
async function tokenRequest(config: EbayConfig, body: URLSearchParams): Promise<Response> {
  return fetch(`${ebayApiBaseUrl(config.environment)}/identity/v1/oauth2/token`, {
    method: "POST", headers: { Authorization: tokenAuth(config), "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
}
function parseTokenResponse(raw: unknown, requireRefresh: boolean): { accessToken: string; refreshToken?: string; accessSeconds: number; refreshSeconds?: number } {
  if (!raw || typeof raw !== "object") throw new Error("EBAY_TOKEN_RESPONSE_INVALID");
  const value = raw as Record<string, unknown>;
  if (typeof value.access_token !== "string" || !value.access_token ||
      (requireRefresh && (typeof value.refresh_token !== "string" || !value.refresh_token))) throw new Error("EBAY_TOKEN_RESPONSE_INVALID");
  return {
    accessToken: value.access_token,
    ...(typeof value.refresh_token === "string" && value.refresh_token ? { refreshToken: value.refresh_token } : {}),
    accessSeconds: validSeconds(value.expires_in),
    ...(value.refresh_token_expires_in === undefined ? {} : { refreshSeconds: validSeconds(value.refresh_token_expires_in) }),
  };
}

export class EbaySellerAuth {
  constructor(private readonly db: D1Binding, private readonly config: EbayConfig) {}

  async status() {
    const row = await this.connection();
    const now = Date.now();
    const ready = this.isConfigured();
    return { environment: this.config.environment, configured: ready,
      status: !ready ? "NOT_CONFIGURED" : !row ? "DISCONNECTED" : Date.parse(row.refresh_expires_at) <= now ? "RECONNECT_REQUIRED" : "CONNECTED",
      ...(row ? { connectedAt: row.connected_at } : {}) };
  }

  private isConfigured(): boolean {
    try { configured(this.config); unbase64(this.config.tokenEncryptionKey); return true; } catch { return false; }
  }

  private connection(): Promise<ConnectionRow | null> {
    return this.db.prepare("SELECT encrypted_tokens, access_expires_at, refresh_expires_at, version, connected_at FROM ebay_seller_connections WHERE environment = ?")
      .bind(this.config.environment).first<ConnectionRow>();
  }

  async begin(): Promise<{ connectUrl: string; expiresAt: string }> {
    configured(this.config);
    await key(this.config);
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const state = base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const expiresAt = new Date(Date.now() + STATE_LIFETIME_MS).toISOString();
    await this.db.prepare("INSERT INTO ebay_oauth_states (environment, state_hash, expires_at) VALUES (?, ?, ?)")
      .bind(this.config.environment, await digest(state), expiresAt).run();
    const connectUrl = new URL("/ebay/oauth/start", this.config.callbackUrl);
    connectUrl.searchParams.set("state", state);
    return { connectUrl: connectUrl.href, expiresAt };
  }

  async authorize(url: URL): Promise<string> {
    configured(this.config);
    if (url.origin !== new URL(this.config.callbackUrl).origin || url.pathname !== "/ebay/oauth/start") throw new Error("EBAY_CALLBACK_INVALID");
    const states = url.searchParams.getAll("state");
    const state = states[0];
    if (states.length !== 1 || !state || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new Error("EBAY_CALLBACK_INVALID");
    const pending = await this.db.prepare("SELECT state_hash FROM ebay_oauth_states WHERE environment = ? AND state_hash = ? AND expires_at > ?")
      .bind(this.config.environment, await digest(state), new Date().toISOString()).first<{ state_hash: string }>();
    if (!pending) throw new Error("EBAY_CALLBACK_INVALID");
    const consent = new URL(`${ebayAuthBaseUrl(this.config.environment)}/oauth2/authorize`);
    consent.search = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: this.config.runame,
      response_type: "code", scope: SCOPE, state }).toString();
    return consent.href;
  }

  async callback(url: URL): Promise<void> {
    configured(this.config);
    if (url.origin + url.pathname !== this.config.callbackUrl) throw new Error("EBAY_CALLBACK_INVALID");
    const states = url.searchParams.getAll("state");
    const codes = url.searchParams.getAll("code");
    const state = states[0];
    if (states.length !== 1 || !state || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new Error("EBAY_CALLBACK_INVALID");
    const consumed = await this.db.prepare("DELETE FROM ebay_oauth_states WHERE environment = ? AND state_hash = ? AND expires_at > ?")
      .bind(this.config.environment, await digest(state), new Date().toISOString()).run() as { meta?: { changes?: number } };
    if (consumed.meta?.changes !== 1) throw new Error("EBAY_CALLBACK_INVALID");
    if (url.searchParams.has("error") || codes.length !== 1 || !codes[0] || codes[0].length > 4096) throw new Error("EBAY_CALLBACK_DENIED");
    const response = await tokenRequest(this.config, new URLSearchParams({ grant_type: "authorization_code", code: codes[0], redirect_uri: this.config.runame }));
    if (!response.ok) throw new Error("EBAY_TOKEN_EXCHANGE_FAILED");
    const tokens = parseTokenResponse(await response.json(), true);
    if (!tokens.refreshToken || !tokens.refreshSeconds) throw new Error("EBAY_TOKEN_RESPONSE_INVALID");
    const now = Date.now();
    await this.db.prepare(`INSERT INTO ebay_seller_connections (environment, encrypted_tokens, access_expires_at, refresh_expires_at, version, connected_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(environment) DO UPDATE SET encrypted_tokens = excluded.encrypted_tokens, access_expires_at = excluded.access_expires_at,
      refresh_expires_at = excluded.refresh_expires_at, version = ebay_seller_connections.version + 1,
      connected_at = excluded.connected_at, updated_at = excluded.updated_at`)
      .bind(this.config.environment, await seal(this.config, { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }),
        new Date(now + tokens.accessSeconds * 1000).toISOString(), new Date(now + tokens.refreshSeconds * 1000).toISOString(),
        new Date(now).toISOString(), new Date(now).toISOString()).run();
  }

  async accessToken(): Promise<string> {
    configured(this.config);
    for (let attempt = 0; attempt < 2; attempt++) {
      const row = await this.connection();
      if (!row || Date.parse(row.refresh_expires_at) <= Date.now()) throw new Error("EBAY_RECONNECT_REQUIRED");
      const tokens = await open(this.config, row.encrypted_tokens);
      if (Date.parse(row.access_expires_at) > Date.now() + 60_000) return tokens.accessToken;
      const response = await tokenRequest(this.config, new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refreshToken, scope: SCOPE }));
      if (!response.ok) {
        if (response.status === 400 || response.status === 401) {
          await this.db.prepare("UPDATE ebay_seller_connections SET refresh_expires_at = ?, version = version + 1 WHERE environment = ? AND version = ?")
            .bind(new Date(0).toISOString(), this.config.environment, row.version).run();
          throw new Error("EBAY_RECONNECT_REQUIRED");
        }
        throw new Error("EBAY_REFRESH_FAILED");
      }
      const next = parseTokenResponse(await response.json(), false);
      const updated = await this.db.prepare(`UPDATE ebay_seller_connections SET encrypted_tokens = ?, access_expires_at = ?,
        refresh_expires_at = ?, version = version + 1, updated_at = ? WHERE environment = ? AND version = ?`)
        .bind(await seal(this.config, { accessToken: next.accessToken, refreshToken: next.refreshToken ?? tokens.refreshToken }),
          new Date(Date.now() + next.accessSeconds * 1000).toISOString(),
          next.refreshSeconds ? new Date(Date.now() + next.refreshSeconds * 1000).toISOString() : row.refresh_expires_at,
          new Date().toISOString(), this.config.environment, row.version).run() as { meta?: { changes?: number } };
      if (updated.meta?.changes === 1) return next.accessToken;
    }
    throw new Error("EBAY_REFRESH_CONFLICT");
  }

  async disconnect(): Promise<{ status: "DISCONNECTED"; revocation: "SUCCEEDED" | "FAILED" | "NOT_CONNECTED" }> {
    const row = await this.connection();
    if (!row) return { status: "DISCONNECTED", revocation: "NOT_CONNECTED" };
    let revocation: "SUCCEEDED" | "FAILED" = "FAILED";
    try {
      const tokens = await open(this.config, row.encrypted_tokens);
      const response = await fetch(`${ebayApiBaseUrl(this.config.environment)}/identity/v1/oauth2/token/revoke`, {
        method: "POST", headers: { Authorization: tokenAuth(this.config), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: tokens.refreshToken, token_type_hint: "refresh_token" }),
      });
      if (response.ok) revocation = "SUCCEEDED";
    } catch { /* Local disconnect still removes the credential. */ }
    const deleted = await this.db.prepare("DELETE FROM ebay_seller_connections WHERE environment = ? AND version = ?")
      .bind(this.config.environment, row.version).run() as { meta?: { changes?: number } };
    if (deleted.meta?.changes !== 1) throw new Error("EBAY_DISCONNECT_CONFLICT");
    return { status: "DISCONNECTED", revocation };
  }
}
