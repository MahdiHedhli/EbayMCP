import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { PolicyService } from "../service/policy-service.js";
import { SaleService } from "../service/sale-service.js";

const factsSchema = z.record(z.string(), z.string()).default({});

function result(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: { data },
  };
}

export function buildMcpServer(service: SaleService, policyService: PolicyService): McpServer {
  const server = new McpServer(
    { name: "ebay-manager", version: "0.1.0" },
    {
      instructions:
        "Ebay Manager is a selling-lifecycle service. Use it for sale records, listing preparation, shipping protection, and lifecycle follow-up. It does not manage general household inventory. Never imply that a draft or recommendation is a live eBay action.",
    },
  );

  server.registerTool(
    "get_capabilities",
    {
      description: "Describe the current Ebay Manager build and safety boundaries.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      const policy = await policyService.getSellerPolicy();
      return result({
        version: "0.1.0",
        persistence: "storage_interface_ready_sqlite_schema_present_runtime_driver_pending",
        ebayConnected: false,
        publicationEnabled: false,
        chatgptTarget: "streamable_http_secure_mcp_tunnel",
        codexTarget: "same_mcp_service",
        defaultShippingSafetyMarginBps: policy.shippingSafetyMarginBps,
      });
    },
  );

  server.registerTool(
    "create_sale_item",
    {
      description:
        "Create the minimal durable record for an item that is being sold. Do not use this as a general declutter inventory tool.",
      inputSchema: z.object({ facts: factsSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ facts }) => result(await service.createSaleItem(facts)),
  );

  server.registerTool(
    "get_sale_item",
    {
      description: "Retrieve the current sale record by internal UUID.",
      inputSchema: z.object({ itemId: z.string().uuid() }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ itemId }) => {
      const item = await service.getSaleItem(itemId);
      if (!item) {
        return { isError: true, content: [{ type: "text" as const, text: "Sale item not found" }] };
      }
      return result(item);
    },
  );

  server.registerTool(
    "get_seller_policy",
    {
      description: "Read the current seller policy used by listing and shipping recommendations.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => result(await policyService.getSellerPolicy()),
  );

  server.registerTool(
    "set_shipping_safety_margin",
    {
      description:
        "Change the seller's shipping safety margin in basis points. This changes recommendation math only and does not modify a live eBay listing.",
      inputSchema: z.object({ shippingSafetyMarginBps: z.number().int().min(0).max(10000) }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ shippingSafetyMarginBps }) =>
      result(await policyService.setShippingSafetyMarginBps(shippingSafetyMarginBps)),
  );

  server.registerTool(
    "estimate_shipping",
    {
      description:
        "Apply the seller's configured shipping safety margin to a base shipping estimate. This does not purchase postage or quote a carrier.",
      inputSchema: z.object({
        currency: z.string().length(3).transform((v) => v.toUpperCase()),
        baseMinorUnits: z.number().int().nonnegative(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ currency, baseMinorUnits }) =>
      result(await service.estimateProtectedShipping({ currency, minorUnits: baseMinorUnits })),
  );

  return server;
}
