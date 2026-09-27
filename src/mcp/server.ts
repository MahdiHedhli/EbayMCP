import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { PolicyService } from "../service/policy-service.js";
import { getEbayCapabilityStatus } from "../ebay/capabilities.js";
import { buildOAuthConnectPlan } from "../ebay/oauth.js";
import type { EbayConfig } from "../ebay/config.js";
import type { EbaySellerAuth } from "../ebay/seller-auth.js";
import type { ActiveListingsService } from "../ebay/active-listings.js";
import { DraftService } from "../service/draft-service.js";
import { recommendSaleFormat } from "../service/recommendation-service.js";
import { SaleService } from "../service/sale-service.js";

const factsSchema = z.record(z.string(), z.string()).default({});

function result(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: { data },
  };
}

export function buildMcpServer(service: SaleService, policyService: PolicyService, draftService: DraftService, ebayConfig: EbayConfig, persistence: "memory" | "d1" = "memory", ebay?: { sellerAuth: EbaySellerAuth; listings: ActiveListingsService }): McpServer {
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
      const capabilities = getEbayCapabilityStatus(ebayConfig);
      const connection = ebay ? await ebay.sellerAuth.status() : null;
      return result({
        version: "0.1.0",
        persistence,
        ebayConnected: connection?.status === "CONNECTED" || capabilities.sellerConnected,
        ebayEnvironment: capabilities.environment,
        ebayOauthConfigured: capabilities.oauthConfigured,
        publicationEnabled: capabilities.publicationEnabled,
        chatgptTarget: "streamable_http_private_app_requires_oauth",
        codexTarget: "same_mcp_service",
        defaultShippingSafetyMarginBps: policy.shippingSafetyMarginBps,
      });
    },
  );

  server.registerTool(
    "get_ebay_connection_readiness",
    {
      description:
        "Report whether server-side eBay OAuth configuration is ready for a seller authorization flow. Never returns OAuth credentials or tokens.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => result({ capabilities: getEbayCapabilityStatus(ebayConfig),
      connectPlan: buildOAuthConnectPlan(ebayConfig),
      connection: ebay ? await ebay.sellerAuth.status() : { status: "DISCONNECTED" } }),
  );

  if (ebay) {
    server.registerTool("get_ebay_seller_connection_status", {
      description: "OBSERVE the eBay seller connection state without returning credentials or account identifiers.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    }, async () => result(await ebay.sellerAuth.status()));

    server.registerTool("begin_ebay_seller_connection", {
      description: "Create a short-lived connection link that redirects to eBay consent. The seller must open it and perform eBay login and consent personally.",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    }, async () => result(await ebay.sellerAuth.begin()));

    server.registerTool("get_active_listings", {
      description: "OBSERVE the authenticated seller's active eBay listings. Read-only eBay Trading API call. Missing counts are unknown, not zero.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional(), cursor: z.string().regex(/^[0-9]{1,3}$/).optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    }, async ({ limit, cursor }) => {
      try { return result(await ebay.listings.get(limit, cursor)); }
      catch (error) { return { isError: true, content: [{ type: "text" as const,
        text: error instanceof Error && error.message === "EBAY_RECONNECT_REQUIRED" ? "EBAY_RECONNECT_REQUIRED" : "EBAY_LISTINGS_UNAVAILABLE" }] }; }
    });

    server.registerTool("disconnect_ebay_seller", {
      description: "Disconnect the seller locally and request eBay refresh-token revocation. This removes access to active listings.",
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    }, async () => result(await ebay.sellerAuth.disconnect()));
  }

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
    "recommend_sale_format",
    {
      description:
        "Recommend fixed-price versus auction from explicit market signals. This is advisory only and never publishes a listing.",
      inputSchema: z.object({
        knownValueConfidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
        demand: z.enum(["LOW", "MEDIUM", "HIGH"]),
        priceDispersion: z.enum(["LOW", "MEDIUM", "HIGH"]),
        rarity: z.enum(["COMMON", "UNCOMMON", "RARE"]),
        evidenceRefs: z.array(z.string()).default([]),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (input) => result(recommendSaleFormat(input)),
  );

  server.registerTool(
    "create_listing_draft",
    {
      description:
        "Create a local eBay listing draft. This does not create or modify any listing on eBay.",
      inputSchema: z.object({
        itemId: z.string().uuid(),
        title: z.string().min(1).max(80),
        description: z.string().min(1),
        condition: z.string().min(1),
        saleFormat: z.enum(["FIXED_PRICE", "AUCTION"]),
        currency: z.string().length(3).optional(),
        priceMinorUnits: z.number().int().nonnegative().optional(),
        categoryId: z.string().optional(),
        itemSpecifics: z.record(z.string(), z.string()).default({}),
      }).refine(
        (v) => (v.currency === undefined) === (v.priceMinorUnits === undefined),
        "currency and priceMinorUnits must be supplied together",
      ),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ currency, priceMinorUnits, categoryId, ...input }) =>
      result(await draftService.createDraft({
        ...input,
        ...(categoryId === undefined ? {} : { categoryId }),
        ...(currency !== undefined && priceMinorUnits !== undefined
          ? { price: { currency: currency.toUpperCase(), minorUnits: priceMinorUnits } }
          : {}),
      })),
  );

  server.registerTool(
    "get_listing_draft",
    {
      description: "Retrieve a local listing draft by UUID. No eBay request is made.",
      inputSchema: z.object({ draftId: z.string().uuid() }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ draftId }) => {
      const draft = await draftService.getDraft(draftId);
      if (!draft) {
        return { isError: true, content: [{ type: "text" as const, text: "Listing draft not found" }] };
      }
      return result(draft);
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
