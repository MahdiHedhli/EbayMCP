import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { SaleService } from "../service/sale-service.js";

const factsSchema = z.record(z.string(), z.string()).default({});

function result(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: { data },
  };
}

export function buildMcpServer(service: SaleService): McpServer {
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
    async () =>
      result({
        version: "0.1.0",
        persistence: "foundation_in_memory_only",
        ebayConnected: false,
        publicationEnabled: false,
        chatgptTarget: "streamable_http_secure_mcp_tunnel",
        codexTarget: "same_mcp_service",
        defaultShippingSafetyMarginBps: service.policy.shippingSafetyMarginBps,
      }),
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
      result(service.estimateProtectedShipping({ currency, minorUnits: baseMinorUnits })),
  );

  return server;
}
