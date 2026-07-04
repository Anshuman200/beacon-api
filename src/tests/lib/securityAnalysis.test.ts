import { describe, it, expect } from "vitest";
import { analyzeResponseSecurity, analyzeRequestHygiene } from "@/lib/securityAnalysis";
import { createDefaultRequest, ApiRequest } from "@/store/collectionStore";
import type { ProxyResponse } from "@/lib/assertions";

function makeResponse(overrides: Partial<ProxyResponse> = {}): ProxyResponse {
  return { status: 200, statusText: "OK", headers: {}, data: {}, responseTime: 10, ...overrides };
}

function makeRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return { ...createDefaultRequest("req_test", "Test Request"), ...overrides };
}

describe("analyzeResponseSecurity", () => {
  it("flags all standard missing security headers on a bare response", () => {
    const findings = analyzeResponseSecurity(makeResponse());
    expect(findings.some((f) => f.title.includes("Strict-Transport-Security"))).toBe(true);
    expect(findings.some((f) => f.title.includes("Content-Security-Policy"))).toBe(true);
    expect(findings.some((f) => f.title.includes("X-Frame-Options"))).toBe(true);
  });

  it("flags CORS wildcard + credentials as high severity", () => {
    const findings = analyzeResponseSecurity(
      makeResponse({ headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Credentials": "true" } })
    );
    const finding = findings.find((f) => f.category === "cors-misconfig");
    expect(finding?.severity).toBe("high");
  });

  it("flags a missing Cache-Control: no-store as info", () => {
    const findings = analyzeResponseSecurity(makeResponse());
    const finding = findings.find((f) => f.title.includes("Cache-Control: no-store"));
    expect(finding?.severity).toBe("info");
  });

  it("does not flag Cache-Control when no-store is present", () => {
    const findings = analyzeResponseSecurity(makeResponse({ headers: { "Cache-Control": "no-store, max-age=0" } }));
    expect(findings.some((f) => f.title.includes("Cache-Control: no-store"))).toBe(false);
  });

  it("flags an absence of rate-limit headers as info", () => {
    const findings = analyzeResponseSecurity(makeResponse());
    expect(findings.some((f) => f.title.includes("No rate-limiting evidence"))).toBe(true);
  });

  it("does not flag rate-limit hygiene when a Retry-After header is present", () => {
    const findings = analyzeResponseSecurity(makeResponse({ headers: { "Retry-After": "30" } }));
    expect(findings.some((f) => f.title.includes("No rate-limiting evidence"))).toBe(false);
  });

  it("redacts secret matches in the evidence field", () => {
    const findings = analyzeResponseSecurity(makeResponse({ data: { api_key: "sk_live_1234567890abcdef" } }));
    const finding = findings.find((f) => f.category === "secret-leak");
    expect(finding?.evidence).not.toContain("1234567890abcdef");
  });

  it("includes concrete fix guidance on actionable findings", () => {
    const findings = analyzeResponseSecurity(
      makeResponse({
        headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Credentials": "true" },
        data: { api_key: "sk_live_1234567890abcdef" },
      })
    );
    const missingHeader = findings.find((f) => f.title.includes("Strict-Transport-Security"));
    const cors = findings.find((f) => f.category === "cors-misconfig");
    const secretLeak = findings.find((f) => f.category === "secret-leak");
    expect(missingHeader?.recommendation).toMatch(/Strict-Transport-Security/);
    expect(cors?.recommendation).toBeTruthy();
    expect(secretLeak?.recommendation).toBeTruthy();
  });
});

describe("analyzeRequestHygiene", () => {
  it("flags a sensitive-looking value sitting in a query param", () => {
    const req = makeRequest({ params: [{ key: "token", value: "abc123", enabled: true }] });
    const findings = analyzeRequestHygiene(req);
    expect(findings.some((f) => f.severity === "high" && f.title.includes("token"))).toBe(true);
  });

  it("ignores disabled params or empty values", () => {
    const req = makeRequest({
      params: [
        { key: "token", value: "abc123", enabled: false },
        { key: "password", value: "", enabled: true },
      ],
    });
    expect(analyzeRequestHygiene(req)).toEqual([]);
  });

  it("flags an API key configured to travel via query param", () => {
    const req = makeRequest({
      auth: { ...createDefaultRequest("x").auth, type: "apikey", apiKeyLocation: "query", apiKeyValue: "x" },
    });
    const findings = analyzeRequestHygiene(req);
    expect(findings.some((f) => f.severity === "info" && f.title.includes("query parameter"))).toBe(true);
  });

  it("produces no findings for a clean request", () => {
    const req = makeRequest({ params: [{ key: "page", value: "1", enabled: true }] });
    expect(analyzeRequestHygiene(req)).toEqual([]);
  });
});
