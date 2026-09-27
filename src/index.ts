import { createServer } from "node:http";
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { buildMcpServer } from "./mcp/server.js";
import { loadEbayConfig } from "./ebay/config.js";
import { PolicyService } from "./service/policy-service.js";
import { SaleService } from "./service/sale-service.js";
import { InMemorySaleItemStore, InMemorySellerPolicyStore } from "./storage/memory.js";
import { InMemoryDraftStore } from "./storage/drafts-memory.js";
import { DraftService } from "./service/draft-service.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error("v0.1 foundation intentionally binds only to loopback; add reviewed auth/host policy before remote binding");
}

const policyService = new PolicyService(new InMemorySellerPolicyStore());
const service = new SaleService(new InMemorySaleItemStore(), policyService);
const draftService = new DraftService(new InMemoryDraftStore());
const ebayConfig = loadEbayConfig();
const handler = createMcpHandler(() => buildMcpServer(service, policyService, draftService, ebayConfig));
const nodeHandler = toNodeHandler(handler);
const validateHost = localhostHostValidation();
const validateOrigin = localhostOriginValidation();

const httpServer = createServer((req, res) => {
  if (!validateHost(req, res) || !validateOrigin(req, res)) return;
  void nodeHandler(req, res);
});

httpServer.listen(port, host, () => {
  console.error(`Ebay Manager MCP listening on http://${host}:${port}/mcp`);
});

process.on("SIGINT", async () => {
  httpServer.close();
  await handler.close();
  process.exit(0);
});
