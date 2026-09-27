import { describe, expect, it } from "vitest";
import { getEbayCapabilityStatus } from "../src/ebay/capabilities.js";
import { loadEbayConfig } from "../src/ebay/config.js";
import { buildOAuthConnectPlan } from "../src/ebay/oauth.js";

describe("eBay configuration boundary", () => {
  it("defaults to sandbox with all external capabilities disabled", () => {
    const config = loadEbayConfig({});
    expect(getEbayCapabilityStatus(config)).toEqual({
      environment: "sandbox",
      oauthConfigured: false,
      sellerConnected: false,
      researchEnabled: false,
      draftVerificationEnabled: false,
      publicationEnabled: false,
    });
  });

  it("never exposes client secrets through the connect plan", () => {
    const config = loadEbayConfig({
      EBAY_ENVIRONMENT: "sandbox",
      EBAY_CLIENT_ID: "id",
      EBAY_CLIENT_SECRET: "super-secret",
      EBAY_RUNAME: "synthetic-runame",
      EBAY_CALLBACK_URL: "https://example.invalid/ebay/oauth/callback",
      EBAY_TOKEN_KEY_SANDBOX: btoa("01234567890123456789012345678901"),
    });
    const plan = buildOAuthConnectPlan(config);
    expect(JSON.stringify(plan)).not.toContain("super-secret");
    expect(plan.status).toBe("READY_FOR_USER_AUTHORIZATION");
  });

  it("rejects unknown environments", () => {
    expect(() => loadEbayConfig({ EBAY_ENVIRONMENT: "oops" })).toThrow();
  });
});
