export interface OAuthEnv {
  MCP_PUBLIC_ORIGIN?: string;
  MCP_OAUTH_ISSUER?: string;
  MCP_OAUTH_JWKS_URI?: string;
  MCP_OAUTH_ALLOWED_SUBJECT?: string;
}

export const MCP_SCOPE = "mcp:use";

function httpsUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

export function oauthConfig(env: OAuthEnv): { resource: string; issuer: string; jwksUri: string; subject: string } | undefined {
  const resource = httpsUrl(env.MCP_PUBLIC_ORIGIN);
  const issuer = httpsUrl(env.MCP_OAUTH_ISSUER);
  const jwks = httpsUrl(env.MCP_OAUTH_JWKS_URI);
  if (!resource || !issuer || !jwks || resource.pathname !== "/" || !env.MCP_PUBLIC_ORIGIN || env.MCP_PUBLIC_ORIGIN !== resource.origin || !env.MCP_OAUTH_ALLOWED_SUBJECT?.trim()) return undefined;
  return { resource: resource.origin, issuer: env.MCP_OAUTH_ISSUER!, jwksUri: jwks.href, subject: env.MCP_OAUTH_ALLOWED_SUBJECT };
}

export function resourceMetadata(config: NonNullable<ReturnType<typeof oauthConfig>>) {
  return { resource: config.resource, authorization_servers: [config.issuer], scopes_supported: [MCP_SCOPE], bearer_methods_supported: ["header"] };
}

export function authChallenge(config: ReturnType<typeof oauthConfig>, error?: "invalid_token" | "insufficient_scope"): string {
  if (!config) return "Bearer";
  const parts = [`resource_metadata="${config.resource}/.well-known/oauth-protected-resource"`, `scope="${MCP_SCOPE}"`];
  if (error) parts.push(`error="${error}"`, `error_description="${error === "insufficient_scope" ? "Required MCP scope missing" : "Access token invalid"}"`);
  return `Bearer ${parts.join(", ")}`;
}

function decodeBase64Url(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
}

function decodeJson(value: string): Record<string, unknown> | undefined {
  const bytes = decodeBase64Url(value);
  if (!bytes) return undefined;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

type Jwk = JsonWebKey & { kid?: string; alg?: string; use?: string; key_ops?: string[] };
let cachedKeys: { uri: string; keys: Jwk[]; until: number } | undefined;

async function getKeys(uri: string): Promise<Jwk[] | undefined> {
  if (cachedKeys?.uri === uri && cachedKeys.until > Date.now()) return cachedKeys.keys;
  try {
    const response = await fetch(uri, { signal: AbortSignal.timeout(3000), redirect: "error", headers: { Accept: "application/json" } });
    if (!response.ok || Number(response.headers.get("Content-Length") || 0) > 65536) return undefined;
    const body = await response.text();
    if (body.length > 65536) return undefined;
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || !("keys" in parsed) || !Array.isArray(parsed.keys) || parsed.keys.length > 32) return undefined;
    const keys = parsed.keys as Jwk[];
    cachedKeys = { uri, keys, until: Date.now() + 300000 };
    return keys;
  } catch {
    return undefined;
  }
}

export async function verifyOAuthToken(token: string, config: NonNullable<ReturnType<typeof oauthConfig>>): Promise<"valid" | "invalid_token" | "insufficient_scope"> {
  if (token.length > 8192) return "invalid_token";
  const parts = token.split(".");
  if (parts.length !== 3) return "invalid_token";
  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  if (!encodedHeader || !encodedClaims || !encodedSignature) return "invalid_token";
  const header = decodeJson(encodedHeader);
  const claims = decodeJson(encodedClaims);
  const signature = decodeBase64Url(encodedSignature);
  if (!header || !claims || !signature || header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid || header.crit || header.jku || header.x5u) return "invalid_token";
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== config.issuer || claims.sub !== config.subject ||
    !(claims.aud === config.resource || (Array.isArray(claims.aud) && claims.aud.includes(config.resource))) ||
    typeof claims.exp !== "number" || !Number.isInteger(claims.exp) || claims.exp <= now ||
    (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > now)) ||
    (claims.iat !== undefined && (typeof claims.iat !== "number" || claims.iat > now + 60))) return "invalid_token";
  const keys = await getKeys(config.jwksUri);
  const matching = keys?.filter((key) => key.kid === header.kid && key.kty === "RSA" && !key.d && (!key.alg || key.alg === "RS256") && (!key.use || key.use === "sig") && (!key.key_ops || key.key_ops.includes("verify")));
  if (matching?.length !== 1) return "invalid_token";
  try {
    const key = await crypto.subtle.importKey("jwk", matching[0]!, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, new Uint8Array(signature), new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`));
    if (!valid) return "invalid_token";
  } catch {
    return "invalid_token";
  }
  const scopes = typeof claims.scope === "string" ? claims.scope.split(" ") : Array.isArray(claims.scp) ? claims.scp : [];
  return scopes.includes(MCP_SCOPE) ? "valid" : "insufficient_scope";
}
