import { ebayAuthBaseUrl, type EbayConfig } from "./config.js";

export interface OAuthConnectPlan {
  status: "NOT_CONFIGURED" | "READY_FOR_USER_AUTHORIZATION";
  environment: "sandbox" | "production";
  authorizationEndpoint?: string;
  requiredServerSecretsPresent: boolean;
}

export function buildOAuthConnectPlan(config: EbayConfig): OAuthConnectPlan {
  const configured = Boolean(config.clientId && config.clientSecret && config.runame && config.tokenEncryptionKey && config.callbackUrl);
  if (!configured) {
    return {
      status: "NOT_CONFIGURED",
      environment: config.environment,
      requiredServerSecretsPresent: false,
    };
  }

  return {
    status: "READY_FOR_USER_AUTHORIZATION",
    environment: config.environment,
    authorizationEndpoint: `${ebayAuthBaseUrl(config.environment)}/oauth2/authorize`,
    requiredServerSecretsPresent: true,
  };
}
