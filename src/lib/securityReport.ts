import type { ApiRequest, OwaspChecklistItem } from "@/store/collectionStore";
import type { SecurityFinding } from "@/lib/securityAnalysis";
import type { MatrixResultSummary } from "@/components/AuthMatrixSection";
import { OWASP_CATEGORIES } from "@/lib/owaspChecklist";

export interface SecurityReportSections {
  responseAnalysis: SecurityFinding[];
  hygieneHelpers: SecurityFinding[];
  activeProbes: SecurityFinding[];
  fileUploadProbes: SecurityFinding[];
}

const STATUS_LABEL: Record<OwaspChecklistItem["status"], string> = {
  not_tested: "Not tested",
  pass: "Pass",
  fail: "Fail",
  n_a: "N/A",
};

function findingsTable(findings: SecurityFinding[]): string {
  if (findings.length === 0) return "_No findings in this section._\n";
  return findings
    .map((f) => {
      const evidence = f.evidence ? `\n  Evidence: \`${f.evidence}\`` : "";
      const fix = f.recommendation ? `\n  **How to fix:** ${f.recommendation}` : "";
      return `- **[${f.severity.toUpperCase()}]** ${f.title}\n  ${f.description}${evidence}${fix}`;
    })
    .join("\n\n") + "\n";
}

/**
 * Builds a self-contained, human-readable Markdown report from whatever
 * findings/checklist/matrix state the Security panel currently holds — the
 * client never sends this data anywhere, it's assembled entirely locally.
 */
export function buildSecurityReportMarkdown(
  request: ApiRequest,
  checklist: OwaspChecklistItem[],
  sections: SecurityReportSections,
  matrixResults: MatrixResultSummary[]
): string {
  const allFindings = [
    ...sections.responseAnalysis,
    ...sections.hygieneHelpers,
    ...sections.activeProbes,
    ...sections.fileUploadProbes,
  ];
  const matrixIssueCount = matrixResults.filter((r) => r.isMismatch || r.isRegression).length;

  const severityCounts = allFindings.reduce(
    (acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] ?? 0) + 1 }),
    { high: 0, medium: 0, low: 0, info: 0 } as Record<SecurityFinding["severity"], number>
  );
  // Matrix mismatches/regressions represent a real access-control problem —
  // count them alongside "high" in the aggregate even though they're not
  // stored as SecurityFinding objects.
  const totalHigh = severityCounts.high + matrixIssueCount;

  const lines: string[] = [];
  lines.push(`# Security Report — ${request.name}`);
  lines.push("");
  lines.push(`- **Method / URL:** ${request.method} ${request.baseUrl}${request.endpoint ? `/${request.endpoint}` : ""}`);
  lines.push(`- **Generated:** ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`| High | Medium | Low | Info |`);
  lines.push(`|------|--------|-----|------|`);
  lines.push(`| ${totalHigh} | ${severityCounts.medium} | ${severityCounts.low} | ${severityCounts.info} |`);
  lines.push("");
  lines.push(
    "_Severity reflects what these specific checks detected — not a full audit. \"Not tested\" checklist rows still need manual review._"
  );
  lines.push("");

  lines.push("## OWASP API Top 10 Checklist");
  lines.push("");
  lines.push("| Category | Status | Notes | How to Fix |");
  lines.push("|----------|--------|-------|------------|");
  for (const meta of OWASP_CATEGORIES) {
    const item = checklist.find((c) => c.category === meta.category);
    const status = STATUS_LABEL[item?.status ?? "not_tested"];
    const notes = (item?.notes ?? "").replace(/\|/g, "\\|") || "—";
    const fix = item?.status === "fail" ? meta.guidance.replace(/\|/g, "\\|") : "—";
    lines.push(`| ${meta.code} — ${meta.name} | ${status} | ${notes} | ${fix} |`);
  }
  lines.push("");

  lines.push("## Response Analysis");
  lines.push("");
  lines.push(findingsTable(sections.responseAnalysis));

  lines.push("## Hygiene & Auth Helpers");
  lines.push("");
  lines.push(findingsTable(sections.hygieneHelpers));

  lines.push("## Active Probes");
  lines.push("");
  lines.push(findingsTable(sections.activeProbes));

  lines.push("## File Upload Probes");
  lines.push("");
  lines.push(findingsTable(sections.fileUploadProbes));

  lines.push("## Authorization Matrix");
  lines.push("");
  if (matrixResults.length === 0) {
    lines.push("_Matrix not run._");
  } else {
    lines.push("| Role | Status | Expected | Result | How to Fix |");
    lines.push("|------|--------|----------|--------|------------|");
    for (const r of matrixResults) {
      const hasIssue = r.isMismatch || r.isRegression;
      const result = r.isRegression
        ? `Regression (was ${r.baselineStatus})`
        : r.isMismatch
          ? `Mismatch (expected ${r.expectedStatus})`
          : "Pass";
      const fix = hasIssue ? `Review this endpoint's authorization logic for the "${r.profileName}" role.` : "—";
      lines.push(`| ${r.profileName} | ${r.status} | ${r.expectedStatus ?? "—"} | ${result} | ${fix} |`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

export function downloadSecurityReport(
  request: ApiRequest,
  checklist: OwaspChecklistItem[],
  sections: SecurityReportSections,
  matrixResults: MatrixResultSummary[]
) {
  const markdown = buildSecurityReportMarkdown(request, checklist, sections, matrixResults);
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${request.name.replace(/[^a-z0-9-_]+/gi, "_") || "request"}-security-report.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
