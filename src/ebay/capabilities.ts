import type { EbayConfig } from "./config.js";

export interface EbayCapabilityStatus {
  environment: "sandbox" | "production";
  oauthConfigured: boolean;
  sellerConnected: boolean;
  researchEnabled: boolean;
  draftVerificationEnabled: boolean;
  publicationEnabled: boolean;
}

export function getEbayCapabilityStatus(config: EbayConfig): EbayCapabilityStatus {
  const oauthConfigured = Boolean(config.clientId && config.clientSecret && config.runame && config.tokenEncryptionKey && config.callbackUrl);
  return {
    environment: config.environment,
    oauthConfigured,
    sellerConnected: false,
    researchEnabled: false,
    draftVerificationEnabled: false,
    publicationEnabled: false,
  };
}
