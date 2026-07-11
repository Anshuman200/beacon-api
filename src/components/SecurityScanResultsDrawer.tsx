"use client";

import { Drawer, Button } from "antd";
import { FiDownload, FiAlertTriangle, FiInfo, FiCheckCircle, FiXCircle, FiHelpCircle } from "react-icons/fi";
import type { OwaspChecklistItem } from "@/store/collectionStore";
import type { SecurityFinding } from "@/lib/securityAnalysis";
import type { MatrixResultSummary } from "@/components/AuthMatrixSection";
import { OWASP_CATEGORIES } from "@/lib/owaspChecklist";

const SEVERITY_COLOR: Record<SecurityFinding["severity"], string> = {
  high: "#f43f5e",
  medium: "#f59e0b",
  low: "#0ea5e9",
  info: "#64748b",
};

// Status palette — reserved for state (good/warning/critical/neutral), never reused as a categorical color.
const STATUS = {
  good: "#10b981",
  warning: "#f59e0b",
  critical: "#f43f5e",
  neutral: "#64748b",
};

/** Same-ramp horizontal progress track (fill = the status color, track = a light tint of it) — used for
 * "a single ratio against a limit," never a circular gauge (those read ambiguously at a glance, especially
 * at 0%: an empty ring looks broken rather than "not started yet"). */
function Meter({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 rounded-md overflow-hidden" style={{ backgroundColor: `${color}22` }}>
      <div className="h-full rounded-md transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

/** Headline KPI — one number, one label, one line of plain-English context. No gauge, no percent math
 * the reader has to do themselves. */
function KpiTile({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="rounded-lg border border-slate-500/10 dark:border-white/[0.06] px-3 py-2.5">
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{label}</p>
      <p className="text-xl font-bold mt-0.5" style={{ color }}>{value}</p>
      <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">{sub}</p>
    </div>
  );
}

const SEVERITY_STYLES: Record<SecurityFinding["severity"], { bg: string; text: string }> = {
  high: { bg: "bg-rose-500/10 border-rose-500/20", text: "text-rose-500" },
  medium: { bg: "bg-amber-500/10 border-amber-500/20", text: "text-amber-500" },
  low: { bg: "bg-sky-500/10 border-sky-500/20", text: "text-sky-500" },
  info: { bg: "bg-slate-500/10 border-slate-500/20", text: "text-slate-500" },
};

const SEVERITY_ORDER: SecurityFinding["severity"][] = ["high", "medium", "low", "info"];

type Readiness = "not_ready" | "needs_review" | "ready";

/**
 * A heuristic, not a certification — mirrors this module's honest-detection
 * principle (never claim more confidence than the underlying checks support).
 * "ready" only ever means "nothing this scan looked at is blocking," not "this
 * API has been fully audited."
 */
function computeReadiness(
  severityCounts: Record<SecurityFinding["severity"], number>,
  checklistFail: number,
  checklistNotTested: number,
  matrixProblemCount: number
): Readiness {
  if (severityCounts.high > 0 || checklistFail > 0 || matrixProblemCount > 0) return "not_ready";
  if (checklistNotTested > 0 || severityCounts.medium > 0) return "needs_review";
  return "ready";
}

const READINESS_META: Record<Readiness, { label: string; sub: string; icon: typeof FiCheckCircle; classes: string }> = {
  not_ready: {
    label: "Not Production Ready",
    sub: "Blocking issues found below — fix these before shipping.",
    icon: FiXCircle,
    classes: "bg-rose-500/10 border-rose-500/25 text-rose-500",
  },
  needs_review: {
    label: "Needs Review",
    sub: "No blocking issues yet, but some checks haven't run or finished — review them before shipping.",
    icon: FiHelpCircle,
    classes: "bg-amber-500/10 border-amber-500/25 text-amber-500",
  },
  ready: {
    label: "No Blocking Issues Found",
    sub: "Every check run so far came back clean — still worth a human review before shipping.",
    icon: FiCheckCircle,
    classes: "bg-emerald-500/10 border-emerald-500/25 text-emerald-500",
  },
};

interface Props {
  open: boolean;
  onClose: () => void;
  requestName: string;
  testAssertions: { passed: number; total: number } | null;
  findings: SecurityFinding[];
  checklist: OwaspChecklistItem[];
  matrixResults: MatrixResultSummary[];
  onExportReport: () => void;
}

function StatBadge({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="flex-1 min-w-[70px] rounded-lg border border-slate-500/10 dark:border-white/[0.06] px-2.5 py-2 text-center">
      <div className="text-xl font-black tabular-nums" style={{ color }}>{count}</div>
      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

export default function SecurityScanResultsDrawer({
  open,
  onClose,
  requestName,
  testAssertions,
  findings,
  checklist,
  matrixResults,
  onExportReport,
}: Props) {
  const severityCounts = findings.reduce(
    (acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] || 0) + 1 }),
    { high: 0, medium: 0, low: 0, info: 0 } as Record<SecurityFinding["severity"], number>
  );
  const totalFindings = findings.length;
  const sortedFindings = [...findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

  const checklistPass = checklist.filter((c) => c.status === "pass").length;
  const checklistFail = checklist.filter((c) => c.status === "fail").length;
  const checklistNotTested = checklist.filter((c) => c.status === "not_tested").length;
  const checklistNA = checklist.filter((c) => c.status === "n_a").length;
  const checklistReviewed = checklistPass + checklistFail;
  const failedCategories = OWASP_CATEGORIES.filter((meta) =>
    checklist.some((c) => c.category === meta.category && c.status === "fail")
  );

  const matrixPass = matrixResults.filter((r) => !r.isMismatch && !r.isRegression).length;
  const matrixProblems = matrixResults.filter((r) => r.isMismatch || r.isRegression);

  const readiness = computeReadiness(severityCounts, checklistFail, checklistNotTested, matrixProblems.length);
  const readinessMeta = READINESS_META[readiness];
  const ReadinessIcon = readinessMeta.icon;

  return (
    <Drawer
      title={`Security Scan Results — ${requestName}`}
      open={open}
      onClose={onClose}
      placement="right"
      size={480}
      extra={
        <Button size="small" icon={<FiDownload />} onClick={onExportReport} className="text-xs font-semibold">
          Export Report
        </Button>
      }
    >
      <div className="space-y-5">
        <div className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-3 ${readinessMeta.classes}`}>
          <ReadinessIcon className="w-5 h-5 shrink-0" />
          <div>
            <p className="text-sm font-black">{readinessMeta.label}</p>
            <p className="text-[11px] font-medium opacity-90 mt-0.5">{readinessMeta.sub}</p>
          </div>
        </div>

        {/* At-a-glance KPIs — plain numbers + one line of context each, no gauges to eyeball. */}
        <div className="grid grid-cols-2 gap-2">
          <KpiTile
            label="Test assertions"
            value={testAssertions && testAssertions.total > 0 ? `${testAssertions.passed}/${testAssertions.total}` : "—"}
            sub={
              !testAssertions || testAssertions.total === 0
                ? "Execute the request to run its assertions"
                : testAssertions.passed === testAssertions.total
                ? "All passing"
                : `${testAssertions.total - testAssertions.passed} failing`
            }
            color={
              !testAssertions || testAssertions.total === 0
                ? STATUS.neutral
                : testAssertions.passed === testAssertions.total
                ? STATUS.good
                : STATUS.critical
            }
          />
          <KpiTile
            label="Findings"
            value={String(totalFindings)}
            sub={
              totalFindings === 0
                ? "No issues found"
                : `${severityCounts.high} high · ${severityCounts.medium} medium`
            }
            color={
              severityCounts.high > 0
                ? STATUS.critical
                : severityCounts.medium > 0
                ? STATUS.warning
                : totalFindings > 0
                ? STATUS.neutral
                : STATUS.good
            }
          />
          <KpiTile
            label="Checklist coverage"
            value={`${checklistReviewed}/10`}
            sub={checklistReviewed === 0 ? "Not started" : `${checklistPass} passed · ${checklistFail} failed`}
            color={checklistFail > 0 ? STATUS.critical : checklistReviewed === 10 ? STATUS.good : STATUS.neutral}
          />
          <KpiTile
            label="Auth matrix"
            value={matrixResults.length === 0 ? "—" : String(matrixProblems.length)}
            sub={matrixResults.length === 0 ? "Not run yet" : matrixProblems.length === 0 ? "All roles OK" : "role mismatch(es)"}
            color={matrixResults.length === 0 ? STATUS.neutral : matrixProblems.length > 0 ? STATUS.critical : STATUS.good}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Findings by Severity</p>
            {totalFindings > 0 && <p className="text-[10px] font-semibold text-slate-500">{totalFindings} total</p>}
          </div>
          {totalFindings === 0 ? (
            <p className="text-xs text-slate-500 text-center py-2">No findings from the checks run so far.</p>
          ) : (
            <>
              <div className="flex h-2 gap-0.5 rounded-md overflow-hidden">
                {(["high", "medium", "low", "info"] as const).map((sev) =>
                  severityCounts[sev] > 0 ? (
                    <div
                      key={sev}
                      style={{ width: `${(severityCounts[sev] / totalFindings) * 100}%`, backgroundColor: SEVERITY_COLOR[sev] }}
                    />
                  ) : null
                )}
              </div>
              <div className="flex gap-2 mt-2">
                <StatBadge label="High" count={severityCounts.high} color={SEVERITY_COLOR.high} />
                <StatBadge label="Medium" count={severityCounts.medium} color={SEVERITY_COLOR.medium} />
                <StatBadge label="Low" count={severityCounts.low} color={SEVERITY_COLOR.low} />
                <StatBadge label="Info" count={severityCounts.info} color={SEVERITY_COLOR.info} />
              </div>
            </>
          )}
        </div>

        {sortedFindings.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Detailed Findings</p>
            <div className="space-y-2">
              {sortedFindings.map((f) => {
                const style = SEVERITY_STYLES[f.severity];
                return (
                  <div key={f.id} className={`rounded-lg border px-3 py-2 ${style.bg}`}>
                    <div className={`flex items-center gap-1.5 text-xs font-bold ${style.text}`}>
                      {f.severity === "info" || f.severity === "low" ? <FiInfo className="w-3.5 h-3.5" /> : <FiAlertTriangle className="w-3.5 h-3.5" />}
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
          </div>
        )}

        {/* Everything about the checklist lives in one place now — coverage meter, the
            pass/fail/not-tested/n-a breakdown, and the failing categories — instead of a
            top gauge and a "breakdown" section split apart by Findings and the Matrix. */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">OWASP API Top 10 Checklist</p>
            <p className="text-[10px] font-semibold text-slate-500">{checklistReviewed}/10 reviewed</p>
          </div>
          <Meter value={checklistReviewed} max={10} color="#6366f1" />
          <div className="flex gap-2 mt-2">
            <StatBadge label="Pass" count={checklistPass} color="#10b981" />
            <StatBadge label="Fail" count={checklistFail} color="#f43f5e" />
            <StatBadge label="Not Tested" count={checklistNotTested} color="#64748b" />
            <StatBadge label="N/A" count={checklistNA} color="#94a3b8" />
          </div>
          {failedCategories.length > 0 && (
            <div className="space-y-2 mt-2">
              {failedCategories.map((meta) => (
                <div key={meta.category} className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2">
                  <p className="text-xs font-bold text-rose-500">{meta.code} — {meta.name}</p>
                  <p className="text-[11px] text-slate-700 dark:text-slate-300 mt-1.5 pt-1.5 border-t border-current/10">
                    <span className="font-bold">How to fix:</span> {meta.guidance}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Authorization Matrix</p>
          {matrixResults.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-2">Matrix not run yet.</p>
          ) : (
            <>
              <div className="flex gap-2">
                <StatBadge label="Roles Pass" count={matrixPass} color="#10b981" />
                <StatBadge label="Issues" count={matrixProblems.length} color="#f43f5e" />
              </div>
              {matrixProblems.length > 0 && (
                <div className="space-y-2 mt-2">
                  {matrixProblems.map((r, i) => (
                    <div key={i} className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2">
                      <p className="text-xs font-bold text-rose-500">{r.profileName} — got {r.status}</p>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
                        {r.isRegression
                          ? `Regression: this role previously got ${r.baselineStatus}.`
                          : `Expected ${r.expectedStatus} for this role.`}
                      </p>
                      <p className="text-[11px] text-slate-700 dark:text-slate-300 mt-1.5 pt-1.5 border-t border-current/10">
                        <span className="font-bold">How to fix:</span> Review this endpoint&apos;s authorization logic for the &quot;{r.profileName}&quot; role — it&apos;s returning a status that doesn&apos;t match what this role should get.
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Drawer>
  );
}
