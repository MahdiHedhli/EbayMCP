export type EbayEnvironment = "sandbox" | "production";

export interface EbayConfig {
  environment: EbayEnvironment;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
}

export function loadEbayConfig(env: NodeJS.ProcessEnv = process.env): EbayConfig {
  const environment = (env.EBAY_ENVIRONMENT ?? "sandbox") as EbayEnvironment;
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error("EBAY_ENVIRONMENT must be sandbox or production");
  }
  return {
    environment,
    clientId: env.EBAY_CLIENT_ID,
    clientSecret: env.EBAY_CLIENT_SECRET,
    redirectUri: env.EBAY_REDIRECT_URI,
  };
}

export function ebayApiBaseUrl(environment: EbayEnvironment): string {
  return environment === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
}

export function ebayAuthBaseUrl(environment: EbayEnvironment): string {
  return environment === "sandbox" ? "https://auth.sandbox.ebay.com" : "https://auth.ebay.com";
}
