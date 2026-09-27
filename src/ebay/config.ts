export type EbayEnvironment = "sandbox" | "production";

export interface EbayConfig {
  environment: EbayEnvironment;
  clientId?: string;
  clientSecret?: string;
  runame?: string;
  tokenEncryptionKey?: string;
  callbackUrl?: string;
}

export function loadEbayConfig(env: {
  EBAY_ENVIRONMENT?: string;
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  EBAY_RUNAME?: string;
  EBAY_TOKEN_KEY_SANDBOX?: string;
  EBAY_TOKEN_KEY_PRODUCTION?: string;
  EBAY_CALLBACK_URL?: string;
} = {}): EbayConfig {
  const environment = (env.EBAY_ENVIRONMENT ?? "sandbox") as EbayEnvironment;
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error("EBAY_ENVIRONMENT must be sandbox or production");
  }
  return {
    environment,
    ...(env.EBAY_CLIENT_ID === undefined ? {} : { clientId: env.EBAY_CLIENT_ID }),
    ...(env.EBAY_CLIENT_SECRET === undefined ? {} : { clientSecret: env.EBAY_CLIENT_SECRET }),
    ...(env.EBAY_RUNAME === undefined ? {} : { runame: env.EBAY_RUNAME }),
    ...(environment === "sandbox" && env.EBAY_TOKEN_KEY_SANDBOX ? { tokenEncryptionKey: env.EBAY_TOKEN_KEY_SANDBOX } : {}),
    ...(environment === "production" && env.EBAY_TOKEN_KEY_PRODUCTION ? { tokenEncryptionKey: env.EBAY_TOKEN_KEY_PRODUCTION } : {}),
    ...(env.EBAY_CALLBACK_URL ? { callbackUrl: env.EBAY_CALLBACK_URL } : {}),
  };
}

export function ebayApiBaseUrl(environment: EbayEnvironment): string {
  return environment === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
}

export function ebayAuthBaseUrl(environment: EbayEnvironment): string {
  return environment === "sandbox" ? "https://auth.sandbox.ebay.com" : "https://auth.ebay.com";
}
