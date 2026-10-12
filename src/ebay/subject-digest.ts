// A keyed, environment-separated marker prevents a deleted subject from
// reconnecting while the deduplication/audit receipt is retained.
export async function deletionSubjectDigest(userId: string, base64Key: string, environment: "sandbox" | "production"): Promise<string> {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(base64Key)) throw new Error("EBAY_KEY_INVALID");
  const bytes = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  if (bytes.length !== 32) throw new Error("EBAY_KEY_INVALID");
  const material = await crypto.subtle.importKey("raw", bytes, "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256",
    salt: new TextEncoder().encode("ebay-account-deletion-subject-v1"), info: new TextEncoder().encode(environment) },
    material, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`ebay-deletion:${environment}:${userId}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
