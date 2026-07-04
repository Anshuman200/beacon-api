import { describe, it, expect } from "vitest";
import {
  runSecurityProbes,
  testWithoutAuth,
  testWithMalformedToken,
  testUnexpectedMethod,
  testContentTypeHandling,
  classifyStatus,
  ProbeResponse,
  SendRequestFn,
} from "@/lib/securityProbes";
import { createDefaultRequest, ApiRequest } from "@/store/collectionStore";

function makeRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return { ...createDefaultRequest("req_test", "Test Request"), ...overrides };
}

function response(overrides: Partial<ProbeResponse> = {}): ProbeResponse {
  return { status: 200, statusText: "OK", headers: {}, data: {}, responseTime: 10, ...overrides };
}

describe("runSecurityProbes", () => {
  it("flags reflected XSS when the payload is echoed back unescaped", async () => {
    const req = makeRequest({ params: [{ key: "q", value: "x", enabled: true }] });
    const sendFn: SendRequestFn = async (r) => {
      const param = r.params.find((p) => p.key === "q");
      return response({ data: { echoed: param?.value } });
    };
    const findings = await runSecurityProbes(req, { location: "param", key: "q" }, ["xss"], sendFn);
    expect(findings.some((f) => f.title.includes("Reflected XSS"))).toBe(true);
  });

  it("produces no findings when nothing in the response changes", async () => {
    const req = makeRequest({ params: [{ key: "q", value: "x", enabled: true }] });
    const sendFn: SendRequestFn = async () => response({ data: { ok: true } });
    const findings = await runSecurityProbes(req, { location: "param", key: "q" }, ["sqli"], sendFn);
    expect(findings).toEqual([]);
  });
});

describe("testWithoutAuth", () => {
  it("flags a high-severity finding when a 2xx comes back with auth stripped, with fix guidance", async () => {
    const req = makeRequest({ auth: { ...createDefaultRequest("x").auth, type: "bearer", bearerToken: "abc" } });
    const findings = await testWithoutAuth(req, async () => response({ status: 200 }));
    expect(findings[0].severity).toBe("high");
    expect(findings[0].recommendation).toBeTruthy();
  });

  it("reports success info when the endpoint correctly rejects with 401", async () => {
    const req = makeRequest({ auth: { ...createDefaultRequest("x").auth, type: "bearer", bearerToken: "abc" } });
    const findings = await testWithoutAuth(req, async () => response({ status: 401 }));
    expect(findings[0].severity).toBe("info");
  });

  it("short-circuits with an info finding when auth is already None", async () => {
    const req = makeRequest({ auth: { ...createDefaultRequest("x").auth, type: "none" } });
    const findings = await testWithoutAuth(req, async () => response());
    expect(findings[0].description).toContain("already");
  });
});

describe("testWithMalformedToken", () => {
  it("flags when a garbage token isn't rejected with 401/403", async () => {
    const req = makeRequest();
    const findings = await testWithMalformedToken(req, async () => response({ status: 200 }));
    expect(findings[0].severity).toBe("high");
  });

  it("reports success info when a garbage token is rejected with 403", async () => {
    const req = makeRequest();
    const findings = await testWithMalformedToken(req, async () => response({ status: 403 }));
    expect(findings[0].severity).toBe("info");
  });

  it("treats a 400 as a low-severity 'rejected but non-standard' case, not a high-severity bypass", async () => {
    const req = makeRequest();
    const findings = await testWithMalformedToken(req, async () => response({ status: 400 }));
    expect(findings[0].severity).toBe("low");
    expect(findings[0].title.toLowerCase()).toContain("not with the typical");
  });
});

describe("classifyStatus", () => {
  it("classifies 2xx as accepted", () => {
    expect(classifyStatus(200, [404, 405])).toBe("accepted");
  });
  it("classifies a code in the expected list as rejected-expected", () => {
    expect(classifyStatus(405, [404, 405])).toBe("rejected-expected");
  });
  it("classifies 401/403 outside the expected list as rejected-auth-gated", () => {
    expect(classifyStatus(401, [404, 405])).toBe("rejected-auth-gated");
    expect(classifyStatus(403, [400, 406, 415])).toBe("rejected-auth-gated");
  });
  it("classifies 5xx as errored", () => {
    expect(classifyStatus(500, [401, 403])).toBe("errored");
  });
  it("classifies any other 4xx as rejected-other", () => {
    expect(classifyStatus(429, [401, 403])).toBe("rejected-other");
  });
});

describe("testUnexpectedMethod", () => {
  it("flags a high-severity finding when an arbitrary method returns 2xx", async () => {
    const req = makeRequest();
    let sentMethod: string | undefined;
    const findings = await testUnexpectedMethod(req, async (r) => {
      sentMethod = r.method;
      return response({ status: 200 });
    });
    expect(sentMethod).toBe("BEACONPROBE");
    expect(findings[0].severity).toBe("high");
  });

  it("reports success info when the method is rejected with 405", async () => {
    const req = makeRequest();
    const findings = await testUnexpectedMethod(req, async () => response({ status: 405 }));
    expect(findings[0].severity).toBe("info");
  });
});

describe("testContentTypeHandling", () => {
  it("flags a medium-severity finding when a bogus Content-Type returns 2xx", async () => {
    const req = makeRequest({ headers: [{ key: "Content-Type", value: "application/json", enabled: true }] });
    let sentContentType: string | undefined;
    const findings = await testContentTypeHandling(req, async (r) => {
      sentContentType = r.headers.find((h) => h.key.toLowerCase() === "content-type")?.value;
      return response({ status: 200 });
    });
    expect(sentContentType).toBe("application/x-beacon-probe");
    expect(findings[0].severity).toBe("medium");
  });

  it("does not duplicate an existing Content-Type header", async () => {
    const req = makeRequest({ headers: [{ key: "Content-Type", value: "application/json", enabled: true }] });
    let headerCount = 0;
    const findings = await testContentTypeHandling(req, async (r) => {
      headerCount = r.headers.filter((h) => h.key.toLowerCase() === "content-type").length;
      return response({ status: 415 });
    });
    expect(headerCount).toBe(1);
    expect(findings[0].severity).toBe("info");
  });

  it("reports inconclusive/auth-gated (not 'as expected') when a 401 blocks the check before it runs", async () => {
    const req = makeRequest();
    const findings = await testContentTypeHandling(req, async () => response({ status: 401 }));
    expect(findings[0].severity).toBe("info");
    expect(findings[0].title.toLowerCase()).toContain("inconclusive");
    expect(findings[0].description.toLowerCase()).not.toContain("as expected");
  });

  it("flags a 5xx as an error worth investigating, not a good outcome", async () => {
    const req = makeRequest();
    const findings = await testContentTypeHandling(req, async () => response({ status: 500 }));
    expect(findings[0].severity).toBe("medium");
    expect(findings[0].title.toLowerCase()).toContain("server error");
  });
});
