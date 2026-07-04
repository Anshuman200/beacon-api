"use client";

import { useState, useMemo, useEffect } from "react";
import { Button, Select, Input, Checkbox, Tooltip, Collapse } from "antd";
import { FiShield, FiAlertTriangle, FiCheckCircle, FiInfo, FiPlay, FiLock, FiUnlock, FiZap, FiUploadCloud, FiUsers, FiGlobe, FiDownload } from "react-icons/fi";
import { ApiRequest, OwaspApiCategory, OwaspChecklistItem, AuthMatrixSnapshot } from "@/store/collectionStore";
import { analyzeResponseSecurity, analyzeRequestHygiene, SecurityFinding } from "@/lib/securityAnalysis";
import { analyzeJwt, findAndAnalyzeJwts } from "@/lib/jwtInspector";
import { OWASP_CATEGORIES, updateChecklistItem } from "@/lib/owaspChecklist";
import {
  runSecurityProbes,
  testWithoutAuth,
  testWithMalformedToken,
  testUnexpectedMethod,
  testContentTypeHandling,
  ProbeCategory,
  ProbeTarget,
  ProbeResponse,
  PROBE_PAYLOADS,
} from "@/lib/securityProbes";
import { runFileUploadProbes, FileProbeKind } from "@/lib/fileUploadProbes";
import AuthMatrixSection, { MatrixResultSummary } from "@/components/AuthMatrixSection";
import { downloadSecurityReport } from "@/lib/securityReport";
import SecurityScanResultsDrawer from "@/components/SecurityScanResultsDrawer";
import type { AssertionResult } from "@/lib/assertions";
import { toast } from "@/lib/toast";

const FILE_PROBE_OPTIONS: { value: FileProbeKind; label: string }[] = [
  { value: "doubleExtension", label: "Double Extension" },
  { value: "pathTraversalName", label: "Path Traversal Name" },
  { value: "spoofedContentType", label: "Spoofed Content-Type" },
  { value: "oversized", label: "Oversized File" },
];

const PROBE_CATEGORY_OPTIONS: { value: ProbeCategory; label: string }[] = [
  { value: "sqli", label: "SQL Injection" },
  { value: "xss", label: "XSS" },
  { value: "cmdInjection", label: "Command Injection" },
  { value: "pathTraversal", label: "Path Traversal" },
  { value: "noSqlInjection", label: "NoSQL Injection" },
];

const SEVERITY_STYLES: Record<SecurityFinding["severity"], { bg: string; text: string; icon: React.ReactNode }> = {
  high: { bg: "bg-rose-500/10 border-rose-500/20", text: "text-rose-500", icon: <FiAlertTriangle className="w-3.5 h-3.5" /> },
  medium: { bg: "bg-amber-500/10 border-amber-500/20", text: "text-amber-500", icon: <FiAlertTriangle className="w-3.5 h-3.5" /> },
  low: { bg: "bg-sky-500/10 border-sky-500/20", text: "text-sky-500", icon: <FiInfo className="w-3.5 h-3.5" /> },
  info: { bg: "bg-slate-500/10 border-slate-500/20", text: "text-slate-500", icon: <FiInfo className="w-3.5 h-3.5" /> },
};

function FindingList({ findings, emptyLabel }: { findings: SecurityFinding[]; emptyLabel: string }) {
  if (findings.length === 0) {
    return <p className="text-xs text-slate-500 py-3 text-center">{emptyLabel}</p>;
  }
  return (
    <div className="space-y-2">
      {findings.map((f) => {
        const style = SEVERITY_STYLES[f.severity];
        return (
          <div key={f.id} className={`rounded-lg border px-3 py-2 ${style.bg}`}>
            <div className={`flex items-center gap-1.5 text-xs font-bold ${style.text}`}>
              {style.icon}
              <span className="uppercase tracking-wider">{f.severity}</span>
              <span className="text-slate-700 dark:text-slate-300 font-semibold normal-case">{f.title}</span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">{f.description}</p>
            {f.evidence && (
              <p className="text-[10px] font-mono text-slate-500 mt-1 truncate">Evidence: {f.evidence}</p>
            )}
            {f.recommendation && (
              <p className="text-[11px] text-slate-700 dark:text-slate-300 mt-1.5 pt-1.5 border-t border-current/10">
                <span className="font-bold">How to fix:</span> {f.recommendation}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface Props {
  request: ApiRequest;
  lastResponse: {
    status: number;
    statusText: string;
    responseTime: number;
    headers: Record<string, string>;
    data: unknown;
    assertions?: AssertionResult[];
  } | null;
  onSend: (req: ApiRequest) => Promise<ProbeResponse>;
  onUpdateChecklist: (checklist: OwaspChecklistItem[]) => void;
  onUpdateAuthMatrixBaseline: (baseline: AuthMatrixSnapshot[]) => void;
  /** Controlled from SeederWorkspace so "View Results" can live in the always-visible metrics bar instead of inside this tab. */
  resultsDrawerOpen: boolean;
  onResultsDrawerOpenChange: (open: boolean) => void;
}

export default function SecurityPanel({
  request,
  lastResponse,
  onSend,
  onUpdateChecklist,
  onUpdateAuthMatrixBaseline,
  resultsDrawerOpen,
  onResultsDrawerOpenChange,
}: Props) {
  const [responseFindings, setResponseFindings] = useState<SecurityFinding[]>([]);
  const [analyzed, setAnalyzed] = useState(false);

  const [selectedCategories, setSelectedCategories] = useState<ProbeCategory[]>([]);
  const [probeTargetValue, setProbeTargetValue] = useState<string | undefined>(undefined);
  // Shared by both Active Probes (payload injection) and File Upload Probes —
  // both send real attack-shaped requests, so both sit behind one gate.
  const [authorizedForActiveTesting, setAuthorizedForActiveTesting] = useState(false);
  const [probeFindings, setProbeFindings] = useState<SecurityFinding[]>([]);
  const [probesRunning, setProbesRunning] = useState(false);

  const [selectedFileProbeKinds, setSelectedFileProbeKinds] = useState<FileProbeKind[]>([]);
  const [fileProbeTargetKey, setFileProbeTargetKey] = useState<string | undefined>(undefined);
  const [fileProbeFindings, setFileProbeFindings] = useState<SecurityFinding[]>([]);
  const [fileProbesRunning, setFileProbesRunning] = useState(false);

  // Kept as separate lists (rather than one shared list handlers append to) so
  // re-running one check replaces only its own prior result instead of runs
  // accumulating on top of each other forever.
  const [withoutAuthFindings, setWithoutAuthFindings] = useState<SecurityFinding[]>([]);
  const [malformedTokenFindings, setMalformedTokenFindings] = useState<SecurityFinding[]>([]);
  const [unexpectedMethodFindings, setUnexpectedMethodFindings] = useState<SecurityFinding[]>([]);
  const [contentTypeFindings, setContentTypeFindings] = useState<SecurityFinding[]>([]);
  const authFindings = useMemo(
    () => [...withoutAuthFindings, ...malformedTokenFindings, ...unexpectedMethodFindings, ...contentTypeFindings],
    [withoutAuthFindings, malformedTokenFindings, unexpectedMethodFindings, contentTypeFindings]
  );
  const [authHelperRunning, setAuthHelperRunning] = useState<"none" | "malformed" | "method" | "contentType" | null>(null);

  const [activeKeys, setActiveKeys] = useState<string[]>(["analysis", "checklist"]);
  const [fullScanRunning, setFullScanRunning] = useState(false);
  const [fullScanRan, setFullScanRan] = useState(false);
  // Gates the risky part of the full scan (active injection + file-upload
  // probes) — unchecked by default and never remembered across mounts, same
  // house rule as the granular Active Probes checkbox below. The safe checks
  // (analysis, auth/hygiene helpers, matrix) always run regardless.
  const [fullScanAuthorized, setFullScanAuthorized] = useState(false);
  // Bumped to trigger AuthMatrixSection's own run logic from here.
  const [matrixRunSignal, setMatrixRunSignal] = useState(0);

  // Full detail from the latest Authorization Matrix run — feeds both the API5
  // checklist hint (mismatch count) and the exportable report.
  const [matrixResults, setMatrixResults] = useState<MatrixResultSummary[]>([]);
  const matrixMismatchCount = matrixResults.filter((r) => r.isMismatch || r.isRegression).length;

  const targetOptions = useMemo(() => {
    const paramOpts = (request.params || [])
      .filter((p) => p.enabled && p.key.trim())
      .map((p) => ({ value: `param:${p.key}`, label: `Param: ${p.key}` }));
    const headerOpts = (request.headers || [])
      .filter((h) => h.enabled && h.key.trim())
      .map((h) => ({ value: `header:${h.key}`, label: `Header: ${h.key}` }));
    return [...paramOpts, ...headerOpts, { value: "body", label: "Body (replaces raw body)" }];
  }, [request.params, request.headers]);

  const fileFieldOptions = useMemo(
    () =>
      (request.body?.formdata || [])
        .filter((f) => f.type === "file" && f.key.trim())
        .map((f) => ({ value: f.key, label: `File: ${f.key}` })),
    [request.body?.formdata]
  );
  const hasFileField = fileFieldOptions.length > 0;

  /** Response analysis + static request-hygiene checks + any JWTs found in the auth config or response body. */
  const computeResponseFindings = (response: NonNullable<typeof lastResponse>): SecurityFinding[] => {
    const findings = [...analyzeResponseSecurity(response), ...analyzeRequestHygiene(request)];
    if (request.auth.type === "bearer" && request.auth.bearerToken) {
      findings.push(...analyzeJwt(request.auth.bearerToken, "request Bearer Token"));
    }
    if (request.auth.type === "oauth2" && request.auth.oauth2.accessToken) {
      findings.push(...analyzeJwt(request.auth.oauth2.accessToken, "OAuth2 access token"));
    }
    const bodyText = typeof response.data === "string" ? response.data : JSON.stringify(response.data ?? "");
    findings.push(...findAndAnalyzeJwts(bodyText, "response body"));
    return findings;
  };

  const handleAnalyzeResponse = () => {
    if (!lastResponse) return;
    setResponseFindings(computeResponseFindings(lastResponse));
    setAnalyzed(true);
  };

  const handleUpdateStatus = (category: OwaspApiCategory, status: OwaspChecklistItem["status"]) => {
    onUpdateChecklist(updateChecklistItem(request.security.checklist, category, { status }));
  };

  const handleUpdateNotes = (category: OwaspApiCategory, notes: string) => {
    onUpdateChecklist(updateChecklistItem(request.security.checklist, category, { notes }));
  };

  const handleRunProbes = async () => {
    if (!probeTargetValue || selectedCategories.length === 0 || !authorizedForActiveTesting) return;
    const [location, key] = probeTargetValue === "body" ? ["body", undefined] : probeTargetValue.split(":");
    const target: ProbeTarget = { location: location as ProbeTarget["location"], key };

    setProbesRunning(true);
    try {
      const findings = await runSecurityProbes(request, target, selectedCategories, onSend);
      setProbeFindings(findings);
      toast.success(findings.length > 0 ? `${findings.length} potential issue(s) found` : "No issues found by these probes");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to run probes");
    } finally {
      setProbesRunning(false);
    }
  };

  const handleTestWithoutAuth = async () => {
    setAuthHelperRunning("none");
    try {
      setWithoutAuthFindings(await testWithoutAuth(request, onSend));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to run auth helper");
    } finally {
      setAuthHelperRunning(null);
    }
  };

  const handleTestMalformedToken = async () => {
    setAuthHelperRunning("malformed");
    try {
      setMalformedTokenFindings(await testWithMalformedToken(request, onSend));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to run auth helper");
    } finally {
      setAuthHelperRunning(null);
    }
  };

  const handleTestUnexpectedMethod = async () => {
    setAuthHelperRunning("method");
    try {
      setUnexpectedMethodFindings(await testUnexpectedMethod(request, onSend));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to run hygiene helper");
    } finally {
      setAuthHelperRunning(null);
    }
  };

  const handleTestContentType = async () => {
    setAuthHelperRunning("contentType");
    try {
      setContentTypeFindings(await testContentTypeHandling(request, onSend));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to run hygiene helper");
    } finally {
      setAuthHelperRunning(null);
    }
  };

  const handleRunFileProbes = async () => {
    if (!fileProbeTargetKey || selectedFileProbeKinds.length === 0 || !authorizedForActiveTesting) return;
    setFileProbesRunning(true);
    try {
      const findings = await runFileUploadProbes(request, { formKey: fileProbeTargetKey }, selectedFileProbeKinds, onSend);
      setFileProbeFindings(findings);
      toast.success(findings.length > 0 ? `${findings.length} potential issue(s) found` : "No issues found by these probes");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to run file upload probes");
    } finally {
      setFileProbesRunning(false);
    }
  };

  // Default, automatic category set for the full scan's active probes — the
  // two highest-signal, best-understood classes. Kept deliberately smaller
  // than the full 5-category list in Active Probes (below) so an automatic
  // scan against every field doesn't balloon into dozens of requests; anyone
  // wanting the full payload set can still run Active Probes manually.
  const AUTO_PROBE_CATEGORIES: ProbeCategory[] = ["sqli", "xss"];

  const handleRunFullScan = async () => {
    setFullScanRunning(true);
    try {
      // Works even if the request has never been executed yet — this call
      // sends it fresh, so "set the URL and endpoint" really is enough.
      const response = await onSend(request);
      const analysis = computeResponseFindings(response);
      setResponseFindings(analysis);
      setAnalyzed(true);

      const withoutAuth = await testWithoutAuth(request, onSend);
      const malformedToken = await testWithMalformedToken(request, onSend);
      const unexpectedMethod = await testUnexpectedMethod(request, onSend);
      const contentType = await testContentTypeHandling(request, onSend);
      setWithoutAuthFindings(withoutAuth);
      setMalformedTokenFindings(malformedToken);
      setUnexpectedMethodFindings(unexpectedMethod);
      setContentTypeFindings(contentType);

      let activeFindings: SecurityFinding[] = [];
      let fileFindings: SecurityFinding[] = [];

      if (fullScanAuthorized) {
        // Auto-detect every enabled param/header, plus the whole body if it's
        // JSON/raw text — the same fields a tester would otherwise have to
        // hand-pick one at a time in Active Probes below.
        const fieldTargets: ProbeTarget[] = [
          ...request.params.filter((p) => p.enabled && p.key.trim()).map((p) => ({ location: "param" as const, key: p.key })),
          ...request.headers.filter((h) => h.enabled && h.key.trim()).map((h) => ({ location: "header" as const, key: h.key })),
          ...((request.body?.type === "json" || request.body?.type === "raw") && request.body.rawText?.trim()
            ? [{ location: "body" as const }]
            : []),
        ];
        for (const target of fieldTargets) {
          activeFindings = [...activeFindings, ...(await runSecurityProbes(request, target, AUTO_PROBE_CATEGORIES, onSend))];
        }
        setProbeFindings(activeFindings);

        if (hasFileField) {
          fileFindings = await runFileUploadProbes(
            request,
            { formKey: fileFieldOptions[0].value },
            ["doubleExtension", "pathTraversalName", "spoofedContentType", "oversized"],
            onSend
          );
          setFileProbeFindings(fileFindings);
        }
      }

      // Auto-run the Authorization Matrix with whatever profiles already
      // exist (Anonymous works with zero setup) — handled by AuthMatrixSection.
      setMatrixRunSignal((n) => n + 1);

      setActiveKeys((prev) => Array.from(new Set([...prev, "analysis", "auth-helpers", "probes", "file-probes", "auth-matrix"])));
      setFullScanRan(true);
      onResultsDrawerOpenChange(true);

      const totalIssues = [...analysis, ...withoutAuth, ...malformedToken, ...unexpectedMethod, ...contentType, ...activeFindings, ...fileFindings]
        .filter((f) => f.severity !== "info").length;
      toast[totalIssues > 0 ? "warning" : "success"](
        totalIssues > 0 ? `Full scan found ${totalIssues} potential issue(s)` : "Full scan found no issues"
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Full scan failed");
    } finally {
      setFullScanRunning(false);
    }
  };

  // Maps each category's real automated signal to a hint count. Deliberately
  // conservative: only categories with findings that actually speak to that
  // category get a hint, and a hint only ever pushes a "not_tested" row to
  // "fail" (below) — never to "pass", since absence of a finding from these
  // narrow checks doesn't prove the category is secure.
  const categoryHintCounts: Partial<Record<OwaspApiCategory, number>> = {
    API2_BROKEN_AUTH:
      authFindings.filter((f) => f.category === "auth-helper" && f.severity === "high").length +
      responseFindings.filter((f) => f.category === "jwt-issue" && f.severity !== "info").length,
    API3_PROPERTY_AUTH: responseFindings.filter((f) => f.category === "secret-leak").length,
    API4_RESOURCE_CONSUMPTION: [...responseFindings, ...fileProbeFindings].filter((f) => f.category === "resource-consumption").length,
    API5_FUNCTION_AUTH: matrixMismatchCount,
    API8_MISCONFIGURATION: [...responseFindings, ...authFindings, ...fileProbeFindings].filter((f) =>
      ["missing-header", "cors-misconfig", "server-info", "error-leak", "request-hygiene"].includes(f.category)
    ).length,
  };

  // Auto-flag a category as "fail" the moment we have real evidence for it, so
  // the checklist doesn't sit on "Not tested" for signals we've already
  // gathered — the tester can still change/override it at any time.
  useEffect(() => {
    let nextChecklist = request.security.checklist;
    let changed = false;
    for (const meta of OWASP_CATEGORIES) {
      if (!meta.hasAutomatedHint) continue;
      const hintCount = categoryHintCounts[meta.category] ?? 0;
      const item = nextChecklist.find((c) => c.category === meta.category);
      if (hintCount > 0 && item?.status === "not_tested") {
        nextChecklist = updateChecklistItem(nextChecklist, meta.category, { status: "fail" });
        changed = true;
      }
    }
    if (changed) onUpdateChecklist(nextChecklist);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryHintCounts.API2_BROKEN_AUTH, categoryHintCounts.API3_PROPERTY_AUTH, categoryHintCounts.API4_RESOURCE_CONSUMPTION, categoryHintCounts.API5_FUNCTION_AUTH, categoryHintCounts.API8_MISCONFIGURATION]);

  // Every finding currently held anywhere in this panel — the at-a-glance
  // summary and the exported report both draw from this.
  const allFindings = [...responseFindings, ...authFindings, ...probeFindings, ...fileProbeFindings];
  const overallSeverityCounts = allFindings.reduce(
    (acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] || 0) + 1 }),
    { high: 0, medium: 0, low: 0, info: 0 } as Record<SecurityFinding["severity"], number>
  );
  const overallTotal = allFindings.length + matrixMismatchCount;

  // Unlike findings/matrix results, checklist status is persisted — so a
  // request that was scanned in a past session (or before a reload) can
  // still surface "you've looked at this before" even with no live findings.
  const hasChecklistActivity = request.security.checklist.some((c) => c.status !== "not_tested");

  const handleExportReport = () => {
    downloadSecurityReport(
      request,
      request.security.checklist,
      {
        responseAnalysis: responseFindings,
        hygieneHelpers: authFindings,
        activeProbes: probeFindings,
        fileUploadProbes: fileProbeFindings,
      },
      matrixResults
    );
    toast.success("Downloaded security report");
  };

  return (
    <div className="p-4 h-full overflow-y-auto space-y-4">
      <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <FiZap className="w-3.5 h-3.5 text-indigo-500" /> Run Full Security Scan
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Set the URL and endpoint above — this runs response analysis, auth/hygiene checks, active probes across every field, file-upload probes, and the Authorization Matrix in one go.
            </p>
          </div>
          <Button
            type="primary"
            icon={<FiZap />}
            loading={fullScanRunning}
            onClick={handleRunFullScan}
            className="text-xs font-bold shrink-0"
          >
            Run Full Scan
          </Button>
        </div>
        <div
          onClick={() => setFullScanAuthorized((v) => !v)}
          className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 cursor-pointer"
        >
          <Checkbox checked={fullScanAuthorized} onChange={(e) => setFullScanAuthorized(e.target.checked)} onClick={(e) => e.stopPropagation()} />
          <span className="text-[11px] text-slate-600 dark:text-slate-400">
            Also run active injection &amp; file-upload probes (sends real attack-shaped requests to every field) — I&apos;m authorized to test this API. Leave unchecked to only run the non-invasive checks.
          </span>
        </div>
        {(fullScanRan || hasChecklistActivity) && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-indigo-500/10">
            <div className="flex flex-wrap items-center gap-1.5">
              {fullScanRan ? (
                <>
                  {(["high", "medium", "low", "info"] as const).map((sev) =>
                    overallSeverityCounts[sev] ? (
                      <span key={sev} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SEVERITY_STYLES[sev].bg} ${SEVERITY_STYLES[sev].text}`}>
                        {overallSeverityCounts[sev]} {sev}
                      </span>
                    ) : null
                  )}
                  {matrixMismatchCount > 0 && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SEVERITY_STYLES.high.bg} ${SEVERITY_STYLES.high.text}`}>
                      {matrixMismatchCount} matrix issue{matrixMismatchCount === 1 ? "" : "s"}
                    </span>
                  )}
                  {overallTotal === 0 && <span className="text-[10px] font-bold text-emerald-500">No issues found</span>}
                </>
              ) : (
                <span className="text-[10px] font-bold text-slate-500">
                  This request has prior checklist activity — findings reset each session, run a scan to refresh them.
                </span>
              )}
            </div>
            <Button size="small" icon={<FiDownload />} onClick={handleExportReport} className="text-xs font-semibold">
              Export Report
            </Button>
          </div>
        )}
      </div>

      <Collapse
        activeKey={activeKeys}
        onChange={(keys) => setActiveKeys(keys as string[])}
        items={[
          {
            key: "analysis",
            label: (
              <span className="flex items-center gap-1.5 text-xs font-bold">
                <FiShield className="w-3.5 h-3.5" /> Response Analysis
              </span>
            ),
            children: (
              <div className="space-y-3">
                <Button
                  icon={<FiShield />}
                  onClick={handleAnalyzeResponse}
                  disabled={!lastResponse}
                  className="text-xs font-semibold"
                >
                  Analyze Last Response
                </Button>
                {!lastResponse && (
                  <p className="text-[11px] text-slate-500">Execute the request first to analyze its response.</p>
                )}
                {analyzed && <FindingList findings={responseFindings} emptyLabel="No issues found in the last response." />}
              </div>
            ),
          },
          {
            key: "checklist",
            label: (
              <span className="flex items-center gap-1.5 text-xs font-bold">
                <FiCheckCircle className="w-3.5 h-3.5" /> OWASP API Top 10 Checklist
              </span>
            ),
            children: (
              <div className="space-y-2">
                {OWASP_CATEGORIES.map((meta) => {
                  const item = request.security.checklist.find((c) => c.category === meta.category);
                  const hintCount = categoryHintCounts[meta.category] ?? 0;
                  const isAutoFlagged = hintCount > 0 && item?.status === "fail";
                  return (
                    <div key={meta.category} className="rounded-lg border border-slate-500/10 dark:border-white/[0.06] p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <Tooltip title={meta.guidance}>
                          <span className="text-xs font-semibold flex items-center gap-1.5 cursor-help">
                            {meta.code} — {meta.name}
                            {meta.hasAutomatedHint && hintCount > 0 && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-500">
                                {hintCount} hint{hintCount === 1 ? "" : "s"}
                              </span>
                            )}
                          </span>
                        </Tooltip>
                        <Select
                          size="small"
                          value={item?.status || "not_tested"}
                          onChange={(v) => handleUpdateStatus(meta.category, v)}
                          className="w-28"
                          options={[
                            { label: "Not tested", value: "not_tested" },
                            { label: "Pass", value: "pass" },
                            { label: "Fail", value: "fail" },
                            { label: "N/A", value: "n_a" },
                          ]}
                        />
                      </div>
                      {isAutoFlagged && (
                        <p className="text-[10px] text-amber-500">
                          Auto-flagged from {hintCount} automated finding{hintCount === 1 ? "" : "s"} — review and confirm, or change the status if it doesn&apos;t apply.
                        </p>
                      )}
                      <Input
                        size="small"
                        placeholder="Notes..."
                        value={item?.notes || ""}
                        onChange={(e) => handleUpdateNotes(meta.category, e.target.value)}
                        className="text-xs"
                      />
                    </div>
                  );
                })}
              </div>
            ),
          },
          {
            key: "probes",
            label: (
              <span className="flex items-center gap-1.5 text-xs font-bold">
                <FiPlay className="w-3.5 h-3.5" /> Active Probes
              </span>
            ),
            children: (
              <div className="space-y-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Payload categories</p>
                  <Checkbox.Group
                    options={PROBE_CATEGORY_OPTIONS}
                    value={selectedCategories}
                    onChange={(v) => setSelectedCategories(v as ProbeCategory[])}
                    className="text-xs"
                  />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Target field</p>
                  <Select
                    size="small"
                    className="w-full"
                    placeholder="Select a field to probe"
                    value={probeTargetValue}
                    onChange={setProbeTargetValue}
                    options={targetOptions}
                  />
                </div>
                {selectedCategories.length > 0 && probeTargetValue && (
                  <p className="text-[10px] text-slate-500">
                    Will send {selectedCategories.reduce((n, c) => n + PROBE_PAYLOADS[c].length, 0) + 1} requests total (incl. baseline).
                  </p>
                )}
                <div
                  onClick={() => setAuthorizedForActiveTesting((v) => !v)}
                  className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 cursor-pointer"
                >
                  <Checkbox checked={authorizedForActiveTesting} onChange={(e) => setAuthorizedForActiveTesting(e.target.checked)} onClick={(e) => e.stopPropagation()} />
                  <span className="text-[11px] text-slate-600 dark:text-slate-400">
                    I&apos;m authorized to security-test this API. This sends real requests with attack-shaped payloads to the target — only use against APIs you own or have permission to test. Also gates the File Upload Probes section below.
                  </span>
                </div>
                <Button
                  type="primary"
                  danger
                  icon={<FiPlay />}
                  loading={probesRunning}
                  disabled={!authorizedForActiveTesting || selectedCategories.length === 0 || !probeTargetValue}
                  onClick={handleRunProbes}
                  className="w-full text-xs font-bold"
                >
                  Run Probes
                </Button>
                <FindingList findings={probeFindings} emptyLabel="No probes run yet." />
              </div>
            ),
          },
          {
            key: "file-probes",
            label: (
              <span className="flex items-center gap-1.5 text-xs font-bold">
                <FiUploadCloud className="w-3.5 h-3.5" /> File Upload Probes
              </span>
            ),
            children: hasFileField ? (
              <div className="space-y-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Probe kinds</p>
                  <Checkbox.Group
                    options={FILE_PROBE_OPTIONS}
                    value={selectedFileProbeKinds}
                    onChange={(v) => setSelectedFileProbeKinds(v as FileProbeKind[])}
                    className="text-xs"
                  />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Target file field</p>
                  <Select
                    size="small"
                    className="w-full"
                    placeholder="Select a file field to probe"
                    value={fileProbeTargetKey}
                    onChange={setFileProbeTargetKey}
                    options={fileFieldOptions}
                  />
                </div>
                {!authorizedForActiveTesting && (
                  <p className="text-[10px] text-amber-500">Check the authorization box in Active Probes above to enable this.</p>
                )}
                <Button
                  type="primary"
                  danger
                  icon={<FiUploadCloud />}
                  loading={fileProbesRunning}
                  disabled={!authorizedForActiveTesting || selectedFileProbeKinds.length === 0 || !fileProbeTargetKey}
                  onClick={handleRunFileProbes}
                  className="w-full text-xs font-bold"
                >
                  Run File Probes
                </Button>
                <FindingList findings={fileProbeFindings} emptyLabel="No file upload probes run yet." />
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">
                Set this request&apos;s Body to Form Data and add a File field to enable file-upload probes.
              </p>
            ),
          },
          {
            key: "auth-helpers",
            label: (
              <span className="flex items-center gap-1.5 text-xs font-bold">
                <FiLock className="w-3.5 h-3.5" /> Hygiene Helpers
              </span>
            ),
            children: (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Button
                    icon={<FiUnlock />}
                    loading={authHelperRunning === "none"}
                    onClick={handleTestWithoutAuth}
                    className="flex-1 text-xs font-semibold"
                  >
                    Test Without Auth
                  </Button>
                  <Button
                    icon={<FiLock />}
                    loading={authHelperRunning === "malformed"}
                    onClick={handleTestMalformedToken}
                    className="flex-1 text-xs font-semibold"
                  >
                    Test Malformed Token
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button
                    icon={<FiGlobe />}
                    loading={authHelperRunning === "method"}
                    onClick={handleTestUnexpectedMethod}
                    className="flex-1 text-xs font-semibold"
                  >
                    Test Unexpected Method
                  </Button>
                  <Button
                    icon={<FiAlertTriangle />}
                    loading={authHelperRunning === "contentType"}
                    onClick={handleTestContentType}
                    className="flex-1 text-xs font-semibold"
                  >
                    Test Bad Content-Type
                  </Button>
                </div>
                <FindingList findings={authFindings} emptyLabel="No hygiene checks run yet." />
              </div>
            ),
          },
          {
            key: "auth-matrix",
            label: (
              <span className="flex items-center gap-1.5 text-xs font-bold">
                <FiUsers className="w-3.5 h-3.5" /> Authorization Matrix
              </span>
            ),
            children: (
              <AuthMatrixSection
                request={request}
                onSend={onSend}
                onUpdateAuthMatrixBaseline={onUpdateAuthMatrixBaseline}
                onResultsChange={setMatrixResults}
                runSignal={matrixRunSignal}
              />
            ),
          },
        ]}
      />

      <SecurityScanResultsDrawer
        open={resultsDrawerOpen}
        onClose={() => onResultsDrawerOpenChange(false)}
        requestName={request.name}
        testAssertions={
          lastResponse?.assertions
            ? { passed: lastResponse.assertions.filter((a) => a.passed).length, total: lastResponse.assertions.length }
            : null
        }
        findings={allFindings}
        checklist={request.security.checklist}
        matrixResults={matrixResults}
        onExportReport={handleExportReport}
      />
    </div>
  );
}
