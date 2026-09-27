import { createMcpHandler } from "@modelcontextprotocol/server";
import { loadEbayConfig } from "./ebay/config.js";
import { buildMcpServer } from "./mcp/server.js";
import { DraftService } from "./service/draft-service.js";
import { PolicyService } from "./service/policy-service.js";
import { SaleService } from "./service/sale-service.js";
import { D1DraftStore, D1SaleItemStore, D1SellerPolicyStore, type D1Binding } from "./storage/d1.js";

export interface WorkerEnv {
  DB: D1Binding;
  MCP_BEARER_TOKEN?: string;
  EBAY_ENVIRONMENT?: string;
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  EBAY_REDIRECT_URI?: string;
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
    if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 });
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return new Response("Forbidden", { status: 403 });
    if (!(await validToken(request.headers.get("Authorization"), env.MCP_BEARER_TOKEN))) {
      return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store", "WWW-Authenticate": "Bearer" } });
    }
    const policyService = new PolicyService(new D1SellerPolicyStore(env.DB));
    const saleService = new SaleService(new D1SaleItemStore(env.DB), policyService);
    const draftService = new DraftService(new D1DraftStore(env.DB));
    const ebayConfig = loadEbayConfig(env);
    const handler = createMcpHandler(() => buildMcpServer(saleService, policyService, draftService, ebayConfig, "d1"));
    const response = await handler.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(response.body, { status: response.status, headers });
  },
};
