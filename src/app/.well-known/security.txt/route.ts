import { SECURITY_CONTACT, SECURITY_EXPIRES_IN_DAYS, SITE_URL } from "@/lib/site";

/**
 * RFC 9116 (https://www.rfc-editor.org/rfc/rfc9116) — the canonical location
 * a security researcher (or automated scanner) checks first for how to
 * report a vulnerability responsibly, before trying anything else.
 */
export async function GET() {
  const expires = new Date();
  expires.setDate(expires.getDate() + SECURITY_EXPIRES_IN_DAYS);

  const body = `Contact: mailto:${SECURITY_CONTACT}
Expires: ${expires.toISOString()}
Preferred-Languages: en
Canonical: ${SITE_URL}/.well-known/security.txt
`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
