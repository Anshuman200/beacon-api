import type { ApiRequest } from "@/store/collectionStore";
import type { SecurityFinding } from "@/lib/securityAnalysis";

export type ProbeCategory = "sqli" | "xss" | "cmdInjection" | "pathTraversal" | "noSqlInjection";

// Detection-only payloads — never destructive (no DROP/DELETE, no real RCE),
// one request per payload, only sent to fields the user explicitly selects.
export const PROBE_PAYLOADS: Record<ProbeCategory, string[]> = {
  sqli: ["' OR '1'='1", "' OR 1=1--", "1' AND '1'='2", "\"; SELECT 1--"],
  xss: ["<script>alert('beacon-probe')</script>", "\"><img src=x onerror=alert('beacon-probe')>"],
  cmdInjection: ["; echo beacon_probe_test", "| echo beacon_probe_test", "`echo beacon_probe_test`"],
  pathTraversal: ["../../../etc/passwd", "..%2f..%2f..%2fetc%2fpasswd"],
  noSqlInjection: ['{"$ne": null}', '{"$gt": ""}'],
};

const PROBE_CATEGORY_LABEL: Record<ProbeCategory, string> = {
  sqli: "SQL Injection",
  xss: "Cross-Site Scripting",
  cmdInjection: "Command Injection",
  pathTraversal: "Path Traversal",
  noSqlInjection: "NoSQL Injection",
};

export interface ProbeTarget {
  location: "param" | "header" | "body";
  key?: string; // required for param/header, ignored for body (replaces rawText wholesale)
}

export interface ProbeResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: unknown;
  responseTime: number;
}

export type SendRequestFn = (req: ApiRequest) => Promise<ProbeResponse>;

let findingCounter = 0;
const nextId = () => `probe_finding_${Date.now()}_${(findingCounter++).toString(36)}`;

function bodyText(data: unknown): string {
  return typeof data === "string" ? data : JSON.stringify(data ?? "");
}

function substitute(req: ApiRequest, target: ProbeTarget, payload: string): ApiRequest {
  if (target.location === "param" && target.key) {
    return { ...req, params: req.params.map((p) => (p.key === target.key ? { ...p, value: payload } : p)) };
  }
  if (target.location === "header" && target.key) {
    return { ...req, headers: req.headers.map((h) => (h.key === target.key ? { ...h, value: payload } : h)) };
  }
  // body: replace the raw body text wholesale — simplest, most predictable target for JSON/raw bodies.
  return { ...req, body: { ...req.body, rawText: payload } };
}

const SQL_ERROR_SIGNATURES = [
  /SQL syntax.*MySQL/i,
  /ORA-\d{5}/,
  /sqlite3\.OperationalError/,
  /PostgreSQL.*ERROR/,
  /pg_query\(\)/,
  /Microsoft OLE DB Provider for SQL Server/i,
  /unclosed quotation mark/i,
];

/**
 * Sends one payload against the given target and compares the result to a
 * pre-captured baseline response, looking for signs the payload had an
 * effect the API shouldn't allow.
 */
function evaluateProbeResponse(
  category: ProbeCategory,
  payload: string,
  baseline: ProbeResponse,
  result: ProbeResponse
): SecurityFinding | null {
  const text = bodyText(result.data);

  if (category === "xss" && text.includes(payload)) {
    return {
      id: nextId(),
      category: "active-probe",
      severity: "high",
      title: `Reflected XSS: payload echoed back unescaped`,
      description: `Sending "${payload}" resulted in the exact payload appearing in the response body — likely reflected without sanitization.`,
      evidence: payload,
      recommendation: "HTML-escape (or JSON-encode, if this is a JSON API) any user input before it's ever reflected back into a response that could be rendered as HTML.",
    };
  }

  if (category === "sqli" && SQL_ERROR_SIGNATURES.some((sig) => sig.test(text))) {
    return {
      id: nextId(),
      category: "active-probe",
      severity: "high",
      title: "Possible SQL injection: database error signature in response",
      description: `Sending "${payload}" produced a response containing a SQL error message — the input may be reaching a query unsanitized.`,
      evidence: payload,
      recommendation: "Use parameterized queries/prepared statements (never string-concatenate user input into SQL), and return a generic error instead of the raw database error.",
    };
  }

  if (category === "cmdInjection" && text.includes("beacon_probe_test")) {
    return {
      id: nextId(),
      category: "active-probe",
      severity: "high",
      title: "Possible command injection: probe marker echoed back",
      description: `Sending "${payload}" resulted in the command marker appearing in the response — the input may be reaching a shell.`,
      evidence: payload,
      recommendation: "Avoid passing user input to a shell entirely; if unavoidable, use an execution API that takes arguments as an array (no shell interpolation) and strictly allowlist input.",
    };
  }

  // Generic anomaly signal: distinct status vs. baseline, or a large size delta — lower confidence.
  if (result.status !== baseline.status) {
    return {
      id: nextId(),
      category: "active-probe",
      severity: "low",
      title: `${PROBE_CATEGORY_LABEL[category]} probe changed the response status`,
      description: `Baseline responded ${baseline.status}; "${payload}" produced ${result.status}. Worth a manual look — not conclusive on its own.`,
      evidence: payload,
      recommendation: "Manually replay this payload and inspect the full response/server logs to determine whether the status change reflects a real issue.",
    };
  }

  return null;
}

export async function runSecurityProbes(
  req: ApiRequest,
  target: ProbeTarget,
  categories: ProbeCategory[],
  sendFn: SendRequestFn
): Promise<SecurityFinding[]> {
  const baseline = await sendFn(req);
  const findings: SecurityFinding[] = [];

  for (const category of categories) {
    for (const payload of PROBE_PAYLOADS[category]) {
      const probeReq = substitute(req, target, payload);
      const result = await sendFn(probeReq);
      const finding = evaluateProbeResponse(category, payload, baseline, result);
      if (finding) findings.push(finding);
    }
  }

  return findings;
}

// ─────────────────────────────────────────────────────────────────────────
// Auth/session helpers
// ─────────────────────────────────────────────────────────────────────────

function stripAuth(req: ApiRequest): ApiRequest {
  return { ...req, auth: { ...req.auth, type: "none" } };
}

function withMalformedToken(req: ApiRequest): ApiRequest {
  return { ...req, auth: { ...req.auth, type: "bearer", bearerToken: "invalid.beacon.test" } };
}

/**
 * A plain "was it a 2xx or not" check conflates three very different outcomes:
 * properly rejected, blocked by an unrelated gate (e.g. auth firing before the
 * thing we actually meant to test), and a server error. Classifying explicitly
 * keeps every helper honest about which case it's actually looking at.
 */
export type RejectionVerdict = "accepted" | "rejected-expected" | "rejected-auth-gated" | "errored" | "rejected-other";

export function classifyStatus(status: number, expectedRejectionCodes: number[]): RejectionVerdict {
  if (status >= 200 && status < 300) return "accepted";
  if (expectedRejectionCodes.includes(status)) return "rejected-expected";
  if (status === 401 || status === 403) return "rejected-auth-gated";
  if (status >= 500) return "errored";
  return "rejected-other";
}

interface HelperCopy {
  acceptedTitle: string;
  acceptedDescription: (status: number) => string;
  acceptedSeverity: "high" | "medium";
  acceptedRecommendation: string;
  expectedTitle: string;
  expectedDescription: (status: number) => string;
  /** What was actually being tested, for the auth-gated/errored copy (e.g. "method enforcement", "token validation"). */
  subject: string;
  expectedCodesLabel: string;
}

function buildVerdictFindings(status: number, expectedRejectionCodes: number[], copy: HelperCopy): SecurityFinding[] {
  const verdict = classifyStatus(status, expectedRejectionCodes);

  switch (verdict) {
    case "accepted":
      return [{
        id: nextId(),
        category: "auth-helper",
        severity: copy.acceptedSeverity,
        title: copy.acceptedTitle,
        description: copy.acceptedDescription(status),
        recommendation: copy.acceptedRecommendation,
      }];
    case "rejected-expected":
      return [{
        id: nextId(),
        category: "auth-helper",
        severity: "info",
        title: copy.expectedTitle,
        description: copy.expectedDescription(status),
      }];
    case "rejected-auth-gated":
      return [{
        id: nextId(),
        category: "auth-helper",
        severity: "info",
        title: "Inconclusive — blocked by authentication before reaching this check",
        description: `Got ${status} instead of ${copy.expectedCodesLabel} — this endpoint requires authentication before it even reaches ${copy.subject}. Configure valid auth on this request to test ${copy.subject} in isolation.`,
        recommendation: "Set a valid token/credential on this request's Auth tab, then re-run this check to get a conclusive result.",
      }];
    case "errored":
      return [{
        id: nextId(),
        category: "auth-helper",
        severity: "medium",
        title: "Endpoint returned a server error instead of cleanly rejecting",
        description: `Got a ${status} response. This is a problem on its own (worth investigating independent of ${copy.subject}) and doesn't confirm ${copy.subject} either way.`,
        recommendation: `Check server-side logs for the exception behind this ${status} — a malformed/unexpected request should be rejected cleanly (4xx), not crash the handler.`,
      }];
    case "rejected-other":
      return [{
        id: nextId(),
        category: "auth-helper",
        severity: "low",
        title: `Rejected, but not with the typical ${copy.expectedCodesLabel}`,
        description: `Got ${status} instead of ${copy.expectedCodesLabel} — likely fine, but confirm this is an intentional design choice rather than an accident.`,
        recommendation: `If ${status} isn't intentional here, align this endpoint's response with the standard ${copy.expectedCodesLabel} for this case.`,
      }];
  }
}

export async function testWithoutAuth(req: ApiRequest, sendFn: SendRequestFn): Promise<SecurityFinding[]> {
  if (req.auth.type === "none") {
    return [{
      id: nextId(),
      category: "auth-helper",
      severity: "info",
      title: "Request has no auth configured to strip",
      description: "This request's Auth type is already \"None\" — nothing to test here.",
    }];
  }
  const result = await sendFn(stripAuth(req));
  return buildVerdictFindings(result.status, [401, 403], {
    acceptedTitle: "Endpoint responded successfully without any auth",
    acceptedDescription: (s) => `Removing the Authorization header/API key still returned ${s} — this endpoint may not be enforcing authentication.`,
    acceptedSeverity: "high",
    acceptedRecommendation: "Add authentication middleware that rejects requests missing valid credentials with 401 before any handler logic runs.",
    expectedTitle: "Endpoint correctly rejects requests without auth",
    expectedDescription: (s) => `Without auth, the endpoint responded ${s} as expected.`,
    subject: "authentication enforcement",
    expectedCodesLabel: "401/403",
  });
}

export async function testWithMalformedToken(req: ApiRequest, sendFn: SendRequestFn): Promise<SecurityFinding[]> {
  const result = await sendFn(withMalformedToken(req));
  return buildVerdictFindings(result.status, [401, 403], {
    acceptedTitle: "Endpoint accepted a malformed token",
    acceptedDescription: (s) => `Sending an obviously invalid bearer token got a ${s} response — token validation may be missing or too permissive.`,
    acceptedSeverity: "high",
    acceptedRecommendation: "Verify the token's signature and claims (issuer, audience, expiry) server-side on every request — don't just check that a token is present.",
    expectedTitle: "Endpoint correctly rejects a malformed token",
    expectedDescription: (s) => `A garbage bearer token was rejected with ${s} as expected.`,
    subject: "token validation",
    expectedCodesLabel: "401/403",
  });
}

// ─────────────────────────────────────────────────────────────────────────
// REST hygiene helpers (protocol-level, not payload injection — no
// authorization checkbox gate, same as the auth helpers above)
// ─────────────────────────────────────────────────────────────────────────

export async function testUnexpectedMethod(req: ApiRequest, sendFn: SendRequestFn): Promise<SecurityFinding[]> {
  const result = await sendFn({ ...req, method: "BEACONPROBE" });
  const findings = buildVerdictFindings(result.status, [404, 405], {
    acceptedTitle: "Endpoint accepted an arbitrary/unsupported HTTP method",
    acceptedDescription: (s) => `Sending method "BEACONPROBE" got a ${s} response — this endpoint may not be enforcing a method allowlist.`,
    acceptedSeverity: "high",
    acceptedRecommendation: "Explicitly allowlist supported HTTP methods per route and return 404/405 for anything else, at the framework/router level.",
    expectedTitle: "Endpoint rejects unsupported HTTP methods",
    expectedDescription: (s) => `An unrecognized method was rejected with ${s} as expected.`,
    subject: "method handling",
    expectedCodesLabel: "404/405",
  });
  return findings.map((f) => ({ ...f, category: "request-hygiene" }));
}

export async function testContentTypeHandling(req: ApiRequest, sendFn: SendRequestFn): Promise<SecurityFinding[]> {
  const bogusHeaders = [
    ...req.headers.filter((h) => h.key.toLowerCase() !== "content-type"),
    { key: "Content-Type", value: "application/x-beacon-probe", enabled: true },
  ];
  const result = await sendFn({ ...req, headers: bogusHeaders });
  const findings = buildVerdictFindings(result.status, [400, 406, 415], {
    acceptedTitle: "Endpoint didn't reject an unexpected Content-Type",
    acceptedDescription: (s) => `Sending Content-Type: application/x-beacon-probe got a ${s} response — the endpoint may be parsing bodies without validating the declared content type.`,
    acceptedSeverity: "medium",
    acceptedRecommendation: "Validate the Content-Type header server-side and return 415 Unsupported Media Type for anything unexpected, before parsing the body.",
    expectedTitle: "Endpoint rejects an unexpected Content-Type",
    expectedDescription: (s) => `An unrecognized Content-Type was rejected with ${s} as expected.`,
    subject: "Content-Type validation",
    expectedCodesLabel: "400/406/415",
  });
  return findings.map((f) => ({ ...f, category: "request-hygiene" }));
}
