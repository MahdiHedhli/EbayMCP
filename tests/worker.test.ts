import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/server";
import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type WorkerEnv } from "../src/worker.js";

const token = "synthetic-local-test-token-at-least-32-characters";
const env = { MCP_BEARER_TOKEN: token, DB: {} } as WorkerEnv;
const oauthEnv: WorkerEnv = {
  ...env,
  MCP_PUBLIC_ORIGIN: "https://example.invalid",
  MCP_OAUTH_ISSUER: "https://issuer.invalid",
  MCP_OAUTH_JWKS_URI: "https://issuer.invalid/keys",
  MCP_OAUTH_ALLOWED_SUBJECT: "synthetic-user",
};
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "synthetic-key", use: "sig", alg: "RS256" };
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
function signedToken(overrides: Record<string, unknown> = {}) {
  const header = encode({ alg: "RS256", kid: jwk.kid, typ: "JWT" });
  const claims = encode({ iss: oauthEnv.MCP_OAUTH_ISSUER, sub: "synthetic-user", aud: oauthEnv.MCP_PUBLIC_ORIGIN,
    exp: Math.floor(Date.now() / 1000) + 600, scope: "mcp:use", ...overrides });
  const input = `${header}.${claims}`;
  return `${input}.${createSign("RSA-SHA256").update(input).sign(privateKey).toString("base64url")}`;
}
function initialize(authorization: string) {
  return new Request("https://example.invalid/mcp", {
    method: "POST",
    headers: { Authorization: authorization, Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "synthetic-test-client", version: "0.1.0" },
    } }),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("Worker MCP route", () => {
  it("fails closed before any MCP or D1 work", async () => {
    const unauthorized = await worker.fetch(new Request("https://example.invalid/mcp"), env);
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect((await worker.fetch(new Request("https://example.invalid/other"), env)).status).toBe(404);
    expect((await worker.fetch(new Request("https://example.invalid/ebay/oauth/start"), env)).status).toBe(400);
    expect((await worker.fetch(new Request("https://example.invalid/ebay/oauth/callback"), env)).status).toBe(400);
    expect((await worker.fetch(new Request("https://example.invalid/mcp", {
      headers: { Authorization: `Bearer ${token}`, Origin: "https://evil.invalid" },
    }), env)).status).toBe(403);
  });

  it("initializes a Streamable HTTP MCP session on /mcp", async () => {
    const response = await worker.fetch(initialize(`Bearer ${token}`), env);
    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(body).toContain("ebay-manager");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("publishes OAuth protected-resource metadata only when configured", async () => {
    const path = "https://example.invalid/.well-known/oauth-protected-resource";
    expect((await worker.fetch(new Request(path), env)).status).toBe(404);
    expect((await worker.fetch(new Request(path), { ...env, MCP_PUBLIC_ORIGIN: "https://example.invalid",
      MCP_OAUTH_ISSUER: "https://issuer.invalid" })).status).toBe(404);
    expect((await worker.fetch(new Request(path), { ...env, MCP_PUBLIC_ORIGIN: "https://example.invalid",
      MCP_OAUTH_ISSUER: "https://issuer.invalid", MCP_OAUTH_JWKS_URI: "https://issuer.invalid/keys" })).status).toBe(404);
    const response = await worker.fetch(new Request(path), oauthEnv);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ resource: "https://example.invalid", authorization_servers: ["https://issuer.invalid"],
      scopes_supported: ["mcp:use"], bearer_methods_supported: ["header"] });
    expect((await worker.fetch(new Request(path, { method: "POST" }), oauthEnv)).status).toBe(405);
    expect((await worker.fetch(new Request("https://other.invalid/.well-known/oauth-protected-resource"), oauthEnv)).status).toBe(404);
  });

  it("challenges unauthenticated clients with resource metadata and preserves Codex bearer access", async () => {
    const response = await worker.fetch(new Request("https://example.invalid/mcp"), oauthEnv);
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain('resource_metadata="https://example.invalid/.well-known/oauth-protected-resource"');
    expect(response.headers.get("WWW-Authenticate")).not.toContain("error=");
    expect((await worker.fetch(initialize(`Bearer ${token}`), oauthEnv)).status).toBe(200);
  });

  it("accepts a valid resource-bound JWT and rejects wrong claims and signatures before MCP access", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { "Content-Type": "application/json" } })));
    expect((await worker.fetch(initialize(`Bearer ${signedToken()}`), oauthEnv)).status).toBe(200);
    for (const bad of [
      signedToken({ aud: "https://other.invalid" }), signedToken({ iss: "https://other.invalid" }),
      signedToken({ exp: 1 }), signedToken({ sub: "other-user" }), signedToken({ scope: "other:scope" }), `${signedToken().slice(0, -3)}abc`,
    ]) {
      const response = await worker.fetch(initialize(`Bearer ${bad}`), oauthEnv);
      expect(response.status).toBe(401);
    }
    const missingScope = await worker.fetch(initialize(`Bearer ${signedToken({ scope: "other:scope" })}`), oauthEnv);
    expect(missingScope.headers.get("WWW-Authenticate")).toContain('error="insufficient_scope"');
    expect((await worker.fetch(new Request("https://other.invalid/mcp", { headers: { Authorization: `Bearer ${signedToken()}` } }), oauthEnv)).status).toBe(421);
  });

  it("fails closed when the signing keys cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    const noKeysEnv = { ...oauthEnv, MCP_OAUTH_JWKS_URI: "https://issuer.invalid/unavailable-keys" };
    const response = await worker.fetch(initialize(`Bearer ${signedToken()}`), noKeysEnv);
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
  });
});
