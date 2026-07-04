function base64url(bytes: Uint8Array): string {
  let str = "";
  bytes.forEach((b) => { str += String.fromCharCode(b); });
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 7636 code_verifier: a random 43-128 char base64url string. */
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/** RFC 7636 S256 code_challenge: base64url(SHA-256(ascii(code_verifier))). */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** Random string for OAuth2 `state` / CSRF protection. */
export function generateState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}
