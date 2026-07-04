import { describe, it, expect } from "vitest";
import { buildSecurityReportMarkdown, SecurityReportSections } from "@/lib/securityReport";
import { createDefaultRequest, defaultOwaspChecklist, ApiRequest } from "@/store/collectionStore";
import type { SecurityFinding } from "@/lib/securityAnalysis";
import type { MatrixResultSummary } from "@/components/AuthMatrixSection";

function makeRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return { ...createDefaultRequest("req_test", "Test Request"), ...overrides };
}

function makeFinding(overrides: Partial<SecurityFinding> = {}): SecurityFinding {
  return {
    id: "f1",
    category: "missing-header",
    severity: "high",
    title: "Missing X",
    description: "Description of X",
    ...overrides,
  };
}

const emptySections: SecurityReportSections = {
  responseAnalysis: [],
  hygieneHelpers: [],
  activeProbes: [],
  fileUploadProbes: [],
};

describe("buildSecurityReportMarkdown", () => {
  it("includes the request name, method, and URL in the header", () => {
    const req = makeRequest({ name: "start_batch_test", method: "POST", baseUrl: "https://api.example.com", endpoint: "v1/batch" });
    const md = buildSecurityReportMarkdown(req, defaultOwaspChecklist(), emptySections, []);
    expect(md).toContain("# Security Report — start_batch_test");
    expect(md).toContain("POST https://api.example.com/v1/batch");
  });

  it("lists all 10 OWASP checklist categories with their status", () => {
    const req = makeRequest();
    const checklist = defaultOwaspChecklist().map((c) =>
      c.category === "API2_BROKEN_AUTH" ? { ...c, status: "fail" as const, notes: "token issue" } : c
    );
    const md = buildSecurityReportMarkdown(req, checklist, emptySections, []);
    for (const code of ["API1:2023", "API5:2023", "API10:2023"]) {
      expect(md).toContain(code);
    }
    expect(md).toContain("API2:2023 — Broken Authentication | Fail | token issue |");
  });

  it("aggregates severity counts across every section, not just one", () => {
    const req = makeRequest();
    const sections: SecurityReportSections = {
      responseAnalysis: [makeFinding({ severity: "high" })],
      hygieneHelpers: [makeFinding({ severity: "medium" })],
      activeProbes: [makeFinding({ severity: "low" })],
      fileUploadProbes: [makeFinding({ severity: "info" })],
    };
    const md = buildSecurityReportMarkdown(req, defaultOwaspChecklist(), sections, []);
    expect(md).toContain("| 1 | 1 | 1 | 1 |");
  });

  it("folds authorization matrix mismatches into the high count", () => {
    const req = makeRequest();
    const matrixResults: MatrixResultSummary[] = [
      { profileName: "Anonymous", status: 200, expectedStatus: 401, isMismatch: true, isRegression: false },
    ];
    const md = buildSecurityReportMarkdown(req, defaultOwaspChecklist(), emptySections, matrixResults);
    expect(md).toContain("| 1 | 0 | 0 | 0 |");
    expect(md).toContain("| Anonymous | 200 | 401 | Mismatch (expected 401) |");
  });

  it("reports 'Matrix not run' when there are no matrix results", () => {
    const req = makeRequest();
    const md = buildSecurityReportMarkdown(req, defaultOwaspChecklist(), emptySections, []);
    expect(md).toContain("_Matrix not run._");
  });

  it("includes finding title, description, evidence, and fix guidance in its section", () => {
    const req = makeRequest();
    const sections: SecurityReportSections = {
      ...emptySections,
      responseAnalysis: [
        makeFinding({ title: "Secret leaked", description: "Found a key", evidence: "sk_l...cdef", recommendation: "Remove it from the response." }),
      ],
    };
    const md = buildSecurityReportMarkdown(req, defaultOwaspChecklist(), sections, []);
    expect(md).toContain("Secret leaked");
    expect(md).toContain("Found a key");
    expect(md).toContain("sk_l...cdef");
    expect(md).toContain("**How to fix:** Remove it from the response.");
  });

  it("includes the OWASP guidance text as fix instructions only for failed categories", () => {
    const req = makeRequest();
    const checklist = defaultOwaspChecklist().map((c) =>
      c.category === "API2_BROKEN_AUTH" ? { ...c, status: "fail" as const } : c
    );
    const md = buildSecurityReportMarkdown(req, checklist, emptySections, []);
    const rows = md.split("\n").filter((l) => l.startsWith("| API"));
    const api2Row = rows.find((r) => r.includes("API2:2023"))!;
    const api1Row = rows.find((r) => r.includes("API1:2023"))!;
    expect(api2Row.endsWith("— |")).toBe(false);
    expect(api1Row.endsWith("— |")).toBe(true);
  });

  it("includes fix guidance for authorization matrix mismatches but not for passes", () => {
    const req = makeRequest();
    const matrixResults: MatrixResultSummary[] = [
      { profileName: "Anonymous", status: 200, expectedStatus: 401, isMismatch: true, isRegression: false },
      { profileName: "Admin", status: 200, expectedStatus: 200, isMismatch: false, isRegression: false },
    ];
    const md = buildSecurityReportMarkdown(req, defaultOwaspChecklist(), emptySections, matrixResults);
    const rows = md.split("\n").filter((l) => l.startsWith("| Anonymous") || l.startsWith("| Admin"));
    expect(rows.find((r) => r.startsWith("| Anonymous"))).toContain("Review this endpoint's authorization logic");
    expect(rows.find((r) => r.startsWith("| Admin"))?.endsWith("— |")).toBe(true);
  });
});
