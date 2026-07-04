import type { ProxyResponse } from "@/lib/assertions";
import type { ApiRequest } from "@/store/collectionStore";

export type SecurityFindingCategory =
  | "missing-header"
  | "cors-misconfig"
  | "server-info"
  | "secret-leak"
  | "error-leak"
  | "active-probe"
  | "auth-helper"
  | "jwt-issue"
  | "request-hygiene"
  | "resource-consumption";

export interface SecurityFinding {
  id: string;
  category: SecurityFindingCategory;
  severity: "info" | "low" | "medium" | "high";
  title: string;
  description: string;
  evidence?: string;
  /** Concrete, actionable fix guidance for a developer — omitted for findings that are already the good/expected outcome. */
  recommendation?: string;
}

let findingCounter = 0;
const nextId = () => `finding_${Date.now()}_${(findingCounter++).toString(36)}`;

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

const RECOMMENDED_HEADERS: { name: string; description: string; recommendation: string }[] = [
  {
    name: "Strict-Transport-Security",
    description: "Forces browsers to use HTTPS, preventing protocol-downgrade attacks.",
    recommendation: "Add `Strict-Transport-Security: max-age=31536000; includeSubDomains` to every response.",
  },
  {
    name: "Content-Security-Policy",
    description: "Restricts what content the browser can load, mitigating XSS.",
    recommendation: "Add a `Content-Security-Policy` header scoped to what this API actually serves (start with `default-src 'none'` for a pure JSON API).",
  },
  {
    name: "X-Content-Type-Options",
    description: "Prevents MIME-type sniffing that can lead to XSS.",
    recommendation: "Add `X-Content-Type-Options: nosniff` to every response.",
  },
  {
    name: "Referrer-Policy",
    description: "Controls how much referrer information is leaked on cross-origin requests.",
    recommendation: "Add `Referrer-Policy: same-origin` (or `no-referrer` for maximum privacy).",
  },
];

function checkMissingHeaders(headers: Record<string, string>): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const { name, description, recommendation } of RECOMMENDED_HEADERS) {
    if (!getHeader(headers, name)) {
      findings.push({
        id: nextId(),
        category: "missing-header",
        severity: "low",
        title: `Missing ${name} header`,
        description,
        recommendation,
      });
    }
  }
  // X-Frame-Options or an equivalent CSP frame-ancestors directive protects against clickjacking.
  const csp = getHeader(headers, "Content-Security-Policy");
  if (!getHeader(headers, "X-Frame-Options") && !csp?.includes("frame-ancestors")) {
    findings.push({
      id: nextId(),
      category: "missing-header",
      severity: "low",
      title: "Missing X-Frame-Options (or CSP frame-ancestors)",
      description: "Without this, the response can be embedded in a hidden iframe for clickjacking attacks.",
      recommendation: "Add `X-Frame-Options: DENY` (or a CSP `frame-ancestors 'none'` directive) to every response.",
    });
  }
  return findings;
}

function checkCors(headers: Record<string, string>): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const allowOrigin = getHeader(headers, "Access-Control-Allow-Origin");
  const allowCredentials = getHeader(headers, "Access-Control-Allow-Credentials");

  if (allowOrigin === "*" && allowCredentials?.toLowerCase() === "true") {
    findings.push({
      id: nextId(),
      category: "cors-misconfig",
      severity: "high",
      title: "CORS wildcard origin combined with credentials",
      description: "Access-Control-Allow-Origin: * with Access-Control-Allow-Credentials: true lets any site read authenticated responses on behalf of a logged-in user.",
      evidence: `Access-Control-Allow-Origin: ${allowOrigin}; Access-Control-Allow-Credentials: ${allowCredentials}`,
      recommendation: "Replace the wildcard with an explicit allowlist of trusted origins, or drop `Access-Control-Allow-Credentials` if credentialed cross-origin access isn't actually needed.",
    });
  } else if (allowOrigin === "*") {
    findings.push({
      id: nextId(),
      category: "cors-misconfig",
      severity: "info",
      title: "CORS allows any origin",
      description: "Access-Control-Allow-Origin: * means any website can read this response (fine for public APIs, worth confirming intent otherwise).",
      recommendation: "If this endpoint isn't meant to be public, scope `Access-Control-Allow-Origin` to specific trusted origins instead of `*`.",
    });
  }
  return findings;
}

function checkCacheControl(headers: Record<string, string>): SecurityFinding[] {
  const cacheControl = getHeader(headers, "Cache-Control");
  if (!cacheControl?.toLowerCase().includes("no-store")) {
    return [{
      id: nextId(),
      category: "missing-header",
      severity: "info",
      title: "Missing Cache-Control: no-store",
      description: "If this response can contain sensitive or per-user data, add an explicit no-store directive so it isn't cached by browsers or intermediate proxies.",
      recommendation: "Add `Cache-Control: no-store` to responses containing sensitive or per-user data.",
    }];
  }
  return [];
}

const RATE_LIMIT_HEADER_NAMES = ["RateLimit-Limit", "X-RateLimit-Limit", "Retry-After"];

function checkRateLimitHygiene(headers: Record<string, string>): SecurityFinding[] {
  const hasEvidence = RATE_LIMIT_HEADER_NAMES.some((name) => getHeader(headers, name) !== undefined);
  if (!hasEvidence) {
    return [{
      id: nextId(),
      category: "resource-consumption",
      severity: "info",
      title: "No rate-limiting evidence in this response",
      description: "None of RateLimit-Limit / X-RateLimit-Limit / Retry-After were present. This is only a hygiene signal, not proof of a missing limiter — many APIs only send these headers once a limit is close or exceeded.",
      recommendation: "If this endpoint doesn't already rate-limit, add one and surface it via `RateLimit-*`/`Retry-After` headers so clients can back off correctly.",
    }];
  }
  return [];
}

function checkServerInfo(headers: Record<string, string>): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const server = getHeader(headers, "Server");
  const poweredBy = getHeader(headers, "X-Powered-By");
  if (server && /[\d.]+/.test(server)) {
    findings.push({
      id: nextId(),
      category: "server-info",
      severity: "info",
      title: "Server header reveals version info",
      description: "Exposing exact server software/version helps attackers target known vulnerabilities.",
      evidence: server,
      recommendation: "Strip or genericize the `Server` header at the proxy/framework level so it doesn't reveal an exact version.",
    });
  }
  if (poweredBy) {
    findings.push({
      id: nextId(),
      category: "server-info",
      severity: "info",
      title: "X-Powered-By header exposes backend technology",
      description: "Consider disabling this header — it's not required and gives attackers a head start.",
      evidence: poweredBy,
      recommendation: "Disable `X-Powered-By` (e.g. `app.disable('x-powered-by')` in Express) — it serves no functional purpose.",
    });
  }
  return findings;
}

// Detection-only patterns for common secret/credential shapes. Matches are
// redacted in the finding (see redactMatch) — this tool shouldn't itself
// become a place secrets get pasted into logs or screenshots.
// Exported so jwtInspector.ts can locate embedded tokens without duplicating the pattern.
export const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "AWS Access Key ID", pattern: /AKIA[0-9A-Z]{16}/g },
  { name: "JWT", pattern: JWT_PATTERN },
  { name: "PEM private key", pattern: /-----BEGIN (RSA |EC |)PRIVATE KEY-----/g },
  { name: "Generic API key/secret field", pattern: /"(api[_-]?key|secret|password|access[_-]?token)"\s*:\s*"([^"\s]{4,})"/gi },
];

function redactMatch(value: string): string {
  if (value.length <= 8) return "•".repeat(value.length);
  return `${value.slice(0, 4)}${"•".repeat(Math.max(value.length - 8, 4))}${value.slice(-4)}`;
}

function checkSecretLeakage(bodyText: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const { name, pattern } of SECRET_PATTERNS) {
    const matches = bodyText.match(pattern);
    if (matches && matches.length > 0) {
      findings.push({
        id: nextId(),
        category: "secret-leak",
        severity: "high",
        title: `Possible ${name} exposed in response body`,
        description: "The response body appears to contain credential-shaped data. Verify this isn't a real secret being leaked.",
        evidence: redactMatch(matches[0]),
        recommendation: "Remove this field from the response payload (or mask it server-side) and rotate the credential if it's real and was ever exposed.",
      });
    }
  }
  return findings;
}

const ERROR_LEAK_PATTERNS: RegExp[] = [
  /at Object\.<anonymous>/,
  /Traceback \(most recent call last\)/,
  /\.java:\d+\)/,
  /"stack"\s*:\s*"/,
  /System\.[A-Za-z]+Exception/,
];

function checkErrorLeakage(bodyText: string): SecurityFinding[] {
  for (const pattern of ERROR_LEAK_PATTERNS) {
    if (pattern.test(bodyText)) {
      return [{
        id: nextId(),
        category: "error-leak",
        severity: "medium",
        title: "Verbose error/stack trace in response",
        description: "Stack traces can reveal internal file paths, framework versions, and logic — strip them from production error responses.",
        recommendation: "Catch this error server-side and return a generic error message/code; log the full stack trace server-side only.",
      }];
    }
  }
  return [];
}

/** Passive analysis only — never sends a request, just inspects a response already received. */
export function analyzeResponseSecurity(response: ProxyResponse): SecurityFinding[] {
  const bodyText = typeof response.data === "string" ? response.data : JSON.stringify(response.data ?? "");
  return [
    ...checkMissingHeaders(response.headers),
    ...checkCors(response.headers),
    ...checkCacheControl(response.headers),
    ...checkRateLimitHygiene(response.headers),
    ...checkServerInfo(response.headers),
    ...checkSecretLeakage(bodyText),
    ...checkErrorLeakage(bodyText),
  ];
}

const SENSITIVE_QUERY_KEY_PATTERN = /^(token|api[_-]?key|password|secret|access[_-]?token)$/i;

/**
 * Static check of the request's own configuration — no network call. Looks for
 * credentials sitting in the URL query string (logged by proxies/browser
 * history, unlike headers) and API keys configured to travel as query params.
 */
export function analyzeRequestHygiene(req: ApiRequest): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  for (const param of req.params) {
    if (param.enabled && param.value.trim() && SENSITIVE_QUERY_KEY_PATTERN.test(param.key.trim())) {
      findings.push({
        id: nextId(),
        category: "request-hygiene",
        severity: "high",
        title: `Sensitive-looking value in query param "${param.key}"`,
        description: "Passwords, tokens, and API keys shouldn't travel in the URL — they end up in server logs, browser history, and proxy caches. Use a header instead.",
        recommendation: `Move "${param.key}" from a query parameter to a request header (e.g. Authorization).`,
      });
    }
  }

  if (req.auth.type === "apikey" && req.auth.apiKeyLocation === "query") {
    findings.push({
      id: nextId(),
      category: "request-hygiene",
      severity: "info",
      title: "API key sent as a query parameter",
      description: "This request's Auth tab sends the API key via the URL rather than a header. Prefer a header (e.g. Authorization or a custom X-API-Key) where possible.",
      recommendation: "Switch this request's Auth tab to send the API key via a header instead of a query parameter, if the API supports it.",
    });
  }

  return findings;
}
