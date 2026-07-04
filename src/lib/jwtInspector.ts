import { JWT_PATTERN } from "@/lib/securityAnalysis";
import type { SecurityFinding } from "@/lib/securityAnalysis";

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}

const SENSITIVE_CLAIM_KEY_PATTERN = /(password|secret|ssn|ccnum|card[_-]?number|pin)/i;

function base64UrlDecode(segment: string): string {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(segment.length + ((4 - (segment.length % 4)) % 4), "=");
  return typeof atob === "function" ? atob(padded) : Buffer.from(padded, "base64").toString("utf-8");
}

/** No signature verification attempted — a client has no way to verify it anyway. Decode-only. */
export function decodeJwtUnsafe(token: string): DecodedJwt | null {
  const parts = token.trim().split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    if (typeof header !== "object" || typeof payload !== "object" || !header || !payload) return null;
    return { header, payload };
  } catch {
    return null;
  }
}

let findingCounter = 0;
const nextId = () => `jwt_finding_${Date.now()}_${(findingCounter++).toString(36)}`;

function redactToken(token: string): string {
  if (token.length <= 16) return "•".repeat(token.length);
  return `${token.slice(0, 8)}…${token.slice(-8)}`;
}

const MAX_REASONABLE_LIFETIME_SECONDS = 24 * 60 * 60;

/** Decodes and evaluates a single JWT string. `source` names where it was found, for the finding title. */
export function analyzeJwt(token: string, source: string): SecurityFinding[] {
  const decoded = decodeJwtUnsafe(token);
  if (!decoded) return [];

  const findings: SecurityFinding[] = [];
  const { header, payload } = decoded;
  const evidence = redactToken(token);

  if (typeof header.alg === "string" && header.alg.toLowerCase() === "none") {
    findings.push({
      id: nextId(),
      category: "jwt-issue",
      severity: "high",
      title: `JWT (${source}) uses alg: none`,
      description: "A token with alg:none has no integrity protection at all — anyone can craft an arbitrary payload and the signature check will trivially pass.",
      evidence,
      recommendation: "Reject tokens with `alg: none` server-side and require a specific signing algorithm (e.g. RS256/HS256) — never trust the `alg` a client-supplied token claims.",
    });
  }

  const exp = typeof payload.exp === "number" ? payload.exp : undefined;
  const iat = typeof payload.iat === "number" ? payload.iat : undefined;

  if (exp === undefined) {
    findings.push({
      id: nextId(),
      category: "jwt-issue",
      severity: "medium",
      title: `JWT (${source}) has no exp claim`,
      description: "Without an expiration claim, this token is valid forever once issued — there's no built-in limit on how long a stolen token stays useful.",
      evidence,
      recommendation: "Add an `exp` claim when issuing this token, with a lifetime proportional to its privilege (minutes for access tokens, longer only for refresh tokens).",
    });
  } else if (exp * 1000 < Date.now()) {
    findings.push({
      id: nextId(),
      category: "jwt-issue",
      severity: "low",
      title: `JWT (${source}) is expired`,
      description: `This token's exp claim (${new Date(exp * 1000).toISOString()}) is in the past — a compliant server should already be rejecting it.`,
      evidence,
      recommendation: "Fetch/paste a fresh token before testing — this specific finding is about the token you supplied, not the API's expiration handling.",
    });
  }

  if (exp !== undefined && iat !== undefined && exp - iat > MAX_REASONABLE_LIFETIME_SECONDS) {
    findings.push({
      id: nextId(),
      category: "jwt-issue",
      severity: "low",
      title: `JWT (${source}) has an unusually long lifetime`,
      description: `This token is valid for ${Math.round((exp - iat) / 3600)} hours. Long-lived access tokens increase the damage window if one is ever stolen — consider a shorter lifetime plus refresh tokens.`,
      evidence,
      recommendation: "Shorten this token's lifetime (aim for minutes-to-hours for access tokens) and use a separate longer-lived refresh token for renewing it.",
    });
  }

  if (payload.iss === undefined || payload.aud === undefined) {
    findings.push({
      id: nextId(),
      category: "jwt-issue",
      severity: "info",
      title: `JWT (${source}) is missing iss/aud claims`,
      description: "Without issuer/audience claims, a token intended for one service can potentially be replayed against another that trusts the same signing key.",
      evidence,
      recommendation: "Add `iss` (issuer) and `aud` (audience) claims when issuing tokens, and validate both server-side on every request.",
    });
  }

  const sensitiveKeys = Object.keys(payload).filter((k) => SENSITIVE_CLAIM_KEY_PATTERN.test(k));
  if (sensitiveKeys.length > 0) {
    findings.push({
      id: nextId(),
      category: "jwt-issue",
      severity: "high",
      title: `JWT (${source}) payload contains sensitive-looking claims`,
      description: `JWT payloads are base64-encoded, not encrypted — anyone holding the token can read them. Found claim key(s): ${sensitiveKeys.join(", ")}.`,
      evidence,
      recommendation: `Remove ${sensitiveKeys.join(", ")} from the token payload — store it server-side and look it up by a non-sensitive identifier (e.g. user ID) instead.`,
    });
  }

  return findings;
}

/** Scans free text (e.g. a response body) for embedded JWTs and analyzes each one found. */
export function findAndAnalyzeJwts(text: string, source: string): SecurityFinding[] {
  const matches = text.match(JWT_PATTERN);
  if (!matches) return [];
  const seen = new Set<string>();
  const findings: SecurityFinding[] = [];
  for (const token of matches) {
    if (seen.has(token)) continue;
    seen.add(token);
    findings.push(...analyzeJwt(token, source));
  }
  return findings;
}
