import { createMcpHandler } from "@modelcontextprotocol/server";
import { authChallenge, oauthConfig, resourceMetadata, verifyOAuthToken, type OAuthEnv } from "./auth/oauth.js";
import { loadEbayConfig } from "./ebay/config.js";
import { EbaySellerAuth } from "./ebay/seller-auth.js";
import { ActiveListingsService } from "./ebay/active-listings.js";
import { buildMcpServer } from "./mcp/server.js";
import { DraftService } from "./service/draft-service.js";
import { PolicyService } from "./service/policy-service.js";
import { SaleService } from "./service/sale-service.js";
import { D1DraftStore, D1SaleItemStore, D1SellerPolicyStore, type D1Binding } from "./storage/d1.js";

export interface WorkerEnv extends OAuthEnv {
  DB: D1Binding;
  MCP_BEARER_TOKEN?: string;
  EBAY_ENVIRONMENT?: string;
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  EBAY_RUNAME?: string;
  EBAY_CALLBACK_URL?: string;
  EBAY_TOKEN_KEY_SANDBOX?: string;
  EBAY_TOKEN_KEY_PRODUCTION?: string;
}

async function validToken(provided: string | null, expected: string | undefined): Promise<boolean> {
  if (!expected || expected.length < 32 || !provided?.startsWith("Bearer ")) return false;
  const candidate = provided.slice(7);
  if (!candidate || candidate.length > 4096) return false;
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const actual = new Uint8Array(actualHash);
  const target = new Uint8Array(expectedHash);
  let mismatch = 0;
  for (let i = 0; i < actual.length; i++) mismatch |= actual[i]! ^ target[i]!;
  return mismatch === 0;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const config = oauthConfig(env);
    if (url.pathname === "/ebay/oauth/start") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
      try {
        const consentUrl = await new EbaySellerAuth(env.DB, loadEbayConfig(env)).authorize(url);
        return new Response(null, { status: 302, headers: { Location: consentUrl, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
      } catch {
        return new Response("eBay connection link invalid or expired.", { status: 400, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
      }
    }
    if (url.pathname === "/ebay/oauth/callback") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
      const seller = new EbaySellerAuth(env.DB, loadEbayConfig(env));
      try {
        await seller.callback(url);
        return new Response("eBay seller connected. You may close this page.", { headers: {
          "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Type": "text/plain; charset=utf-8",
        } });
      } catch {
        return new Response("eBay connection failed. Start a new connection from your MCP client.", { status: 400, headers: {
          "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Type": "text/plain; charset=utf-8",
        } });
      }
    }
    if (url.pathname === "/.well-known/oauth-protected-resource") {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
      if (!config || url.origin !== config.resource) return new Response("Not found", { status: 404 });
      return new Response(request.method === "HEAD" ? null : JSON.stringify(resourceMetadata(config)), {
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
      });
    }
    if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 });
    if (config && url.origin !== config.resource) return new Response("Misdirected request", { status: 421 });
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return new Response("Forbidden", { status: 403 });
    const authorization = request.headers.get("Authorization");
    if (!(await validToken(authorization, env.MCP_BEARER_TOKEN))) {
      const candidate = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
      const result = config && candidate ? await verifyOAuthToken(candidate, config) : "invalid_token";
      if (result !== "valid") {
        return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store", "WWW-Authenticate": authChallenge(config, candidate ? result : undefined) } });
      }
    }
    const policyService = new PolicyService(new D1SellerPolicyStore(env.DB));
    const saleService = new SaleService(new D1SaleItemStore(env.DB), policyService);
    const draftService = new DraftService(new D1DraftStore(env.DB));
    const ebayConfig = loadEbayConfig(env);
    const sellerAuth = new EbaySellerAuth(env.DB, ebayConfig);
    const listings = new ActiveListingsService(ebayConfig, sellerAuth);
    const handler = createMcpHandler(() => buildMcpServer(saleService, policyService, draftService, ebayConfig, "d1", { sellerAuth, listings }));
    const response = await handler.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(response.body, { status: response.status, headers });
  },
};
