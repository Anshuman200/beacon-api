import { useState } from "react";
import { FiActivity, FiList, FiGrid, FiFileText, FiInfo, FiCheck, FiX } from "react-icons/fi";

export type LogEntry = {
  id: number;
  index: number;
  status: "success" | "error" | "pending";
  statusCode?: number;
  message: string;
  responseData?: unknown;
  redirectChain?: string[];
  itemData?: unknown;
  timestamp: string;
};

interface Props {
  logs: LogEntry[];
  total: number;
  succeeded: number;
  failed: number;
  isRunning: boolean;
  onClear: () => void;
}

type View = "list" | "grid";

function extractLabel(msg: string): string {
  const m = msg.match(/"name"\s*:\s*"([^"]+)"/);
  if (m) return m[1];
  const parts = msg.split(" — ");
  return parts[0].replace(/^(OK|Created|)\s*/i, "").trim().slice(0, 32) || msg.slice(0, 32);
}

export default function LogPanel({ logs, total, succeeded, failed, isRunning, onClear }: Props) {
  const [view, setView] = useState<View>("grid");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const sent = succeeded + failed;
  const progress = total > 0 ? Math.round((sent / total) * 100) : 0;
  const pending = total - sent;
  const isDone = !isRunning && total > 0 && sent >= total;
  const allOk = isDone && failed === 0;

  return (
    <div className="flex flex-col h-full max-h-full rounded-2xl border border-slate-900/5 dark:border-white/[0.07] glass overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.03)] dark:shadow-[0_4px_40px_rgba(0,0,0,0.45)]">

      {/* ── Header ── */}
      <div className="px-6 py-4 border-b border-slate-500/10 dark:border-white/[0.06] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0">
            <FiActivity className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
          </div>
          <div>
            <span className="text-sm font-bold text-slate-900 dark:text-white">Results</span>
            {total > 0 && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{sent} of {total} requests completed</p>
            )}
          </div>

          {isRunning && (
            <span className="flex items-center gap-1.5 text-[11px] text-indigo-600 bg-indigo-500/10 border border-indigo-500/20 dark:text-indigo-300 px-2.5 py-1 rounded-full ml-1">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 pulse-dot" />
              Seeding…
            </span>
          )}
          {allOk && (
            <span className="flex items-center gap-1.5 text-[11px] text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 dark:text-emerald-300 px-2.5 py-1 rounded-full ml-1">
              ✓ All done
            </span>
          )}
          {isDone && failed > 0 && (
            <span className="flex items-center gap-1.5 text-[11px] text-yellow-600 bg-yellow-500/10 border border-yellow-500/20 dark:text-yellow-300 px-2.5 py-1 rounded-full ml-1">
              ⚠ Done with errors
            </span>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex items-center bg-slate-500/5 border border-slate-500/10 dark:bg-white/[0.04] dark:border-white/[0.08] rounded-lg p-0.5 gap-0.5">
            <button onClick={() => setView("list")}
              className={`p-1.5 rounded-md transition-all duration-150 ${
                view === "list"
                  ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/40"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-350"
              }`}>
              <FiList className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setView("grid")}
              className={`p-1.5 rounded-md transition-all duration-150 ${
                view === "grid"
                  ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/40"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-350"
              }`}>
              <FiGrid className="w-3.5 h-3.5" />
            </button>
          </div>
          <button onClick={onClear} disabled={logs.length === 0}
            className="text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:text-slate-500 dark:hover:text-slate-350 disabled:opacity-20 transition-colors px-3 py-1.5 rounded-lg hover:bg-slate-500/5 hover:border-slate-500/10 dark:hover:bg-white/[0.04] border border-transparent dark:hover:border-white/[0.06]">
            Clear
          </button>
        </div>
      </div>

      {/* ── Progress ── */}
      {total > 0 && (
        <div className="px-6 py-5 border-b border-slate-500/10 dark:border-white/[0.06] shrink-0 bg-gradient-to-r from-slate-500/[0.01] dark:from-white/[0.015] to-transparent">
          <div className="flex items-center gap-6">

            {/* Big counter */}
            <div className="shrink-0 text-center min-w-[60px]">
              <div className={`text-[52px] leading-none font-black tabular-nums tracking-tight ${
                isRunning ? "text-indigo-600 dark:text-indigo-400" : allOk ? "text-emerald-600 dark:text-emerald-400" : "text-slate-900 dark:text-white"
              }`}>{sent}</div>
              <div className="text-slate-550 dark:text-slate-400 text-xs font-semibold mt-1.5">/ {total} sent</div>
            </div>

            <div className="w-px h-12 bg-slate-500/10 dark:bg-white/[0.06] shrink-0" />

            {/* Stats + bar */}
            <div className="flex-1 flex flex-col gap-3 min-w-0">
              <div className="flex items-center gap-5 flex-wrap">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-md bg-emerald-500/10 flex items-center justify-center shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-450 block" />
                  </div>
                  <span className="text-xs text-slate-500">Success</span>
                  <span className="text-sm font-black text-emerald-600 dark:text-emerald-400 tabular-nums">{succeeded}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-md bg-rose-500/10 flex items-center justify-center shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 dark:bg-rose-450 block" />
                  </div>
                  <span className="text-xs text-slate-500">Failed</span>
                  <span className={`text-sm font-black tabular-nums ${failed > 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-550 dark:text-slate-500"}`}>{failed}</span>
                </div>
                {isRunning && pending > 0 && (
                  <div className="flex items-center gap-2 ml-auto">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-500 dark:bg-slate-650 pulse-dot block" />
                    <span className="text-xs text-slate-550 dark:text-slate-600">{pending} pending</span>
                  </div>
                )}
              </div>

              <div className="relative h-2 bg-slate-500/10 dark:bg-white/[0.05] rounded-full overflow-hidden">
                <div
                  className="absolute left-0 top-0 h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${progress}%`,
                    background: isRunning
                      ? "linear-gradient(90deg, #6366f1, #a78bfa)"
                      : allOk
                      ? "linear-gradient(90deg, #10b981, #34d399)"
                      : "linear-gradient(90deg, #10b981, #fbbf24)",
                  }}
                >
                  {isRunning && <div className="absolute inset-0 shimmer rounded-full" />}
                </div>
                {isRunning && (
                  <div className="absolute top-0 h-full rounded-full opacity-60 transition-all duration-300 blur-sm"
                    style={{ width: `${progress}%`, background: "linear-gradient(90deg, #6366f1, #a78bfa)" }} />
                )}
              </div>
            </div>

            {/* Percentage badge */}
            <div className={`w-[64px] h-[64px] shrink-0 rounded-2xl flex flex-col items-center justify-center border transition-all duration-300 ${
              isRunning
                ? "bg-indigo-500/10 border-indigo-500/20 dark:border-indigo-500/25 text-indigo-600 dark:text-indigo-300"
                : allOk
                ? "bg-emerald-500/10 border-emerald-500/20 dark:border-emerald-500/25 text-emerald-600 dark:text-emerald-300"
                : "bg-yellow-500/10 border-yellow-500/20 dark:border-yellow-500/25 text-yellow-600 dark:text-yellow-300"
            }`}>
              <span className="text-[17px] font-black leading-none">{progress}%</span>
              <span className="text-[9px] font-semibold opacity-50 mt-0.5 uppercase tracking-wider">done</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto p-4">

        {/* ── Empty state ── */}
        {logs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-7 py-12">
            <div className="relative">
              <div className="absolute inset-0 rounded-3xl bg-indigo-500/5 dark:bg-indigo-500/8 blur-2xl scale-150" />
              <div className="relative w-24 h-24 rounded-3xl bg-slate-500/5 border border-slate-500/10 dark:bg-white/[0.025] dark:border-white/[0.07] flex items-center justify-center float-icon">
                <FiFileText className="w-10 h-10 text-slate-400 dark:text-slate-600" />
              </div>
            </div>
            <div className="text-center space-y-2">
              <p className="text-base font-bold text-slate-500 dark:text-slate-400">No results yet</p>
              <p className="text-sm text-slate-600 dark:text-slate-400 max-w-[220px] leading-relaxed">
                Configure your endpoint and hit{" "}
                <span className="text-indigo-600 dark:text-indigo-400 font-semibold">Run Seed</span>{" "}
                to start populating your API
              </p>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-500/5 border border-slate-500/10 dark:bg-white/[0.02] dark:border-white/[0.05] px-4 py-2.5 rounded-xl">
              <FiInfo className="w-3.5 h-3.5 text-indigo-500/60 dark:text-indigo-600/60 shrink-0" />
              Results stream in here as each request completes
            </div>
          </div>
        )}

        {/* ── LIST ── */}
        {view === "list" && logs.length > 0 && (
          <div className="space-y-1.5 font-mono text-xs">
            {logs.map((log) => (
              <div key={log.id}
                className={`card-in flex items-start gap-3 px-4 py-3 rounded-xl border transition-all duration-150 ${
                  log.status === "success"
                    ? "bg-emerald-500/[0.03] dark:bg-emerald-500/[0.04] border-emerald-500/15 dark:border-emerald-500/[0.15] hover:border-emerald-500/35 hover:bg-emerald-500/[0.06] dark:hover:bg-emerald-500/[0.07]"
                    : log.status === "error"
                    ? "bg-rose-500/[0.03] dark:bg-rose-500/[0.04] border-rose-500/15 dark:border-rose-500/[0.15] hover:border-rose-500/35 hover:bg-rose-500/[0.06] dark:hover:bg-rose-500/[0.07]"
                    : "bg-indigo-500/[0.03] dark:bg-indigo-500/[0.04] border-indigo-500/15 dark:border-indigo-500/[0.15]"
                }`}
              >
                {log.status === "success" ? (
                  <FiCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-500 dark:text-emerald-400" />
                ) : log.status === "error" ? (
                  <FiX className="w-3.5 h-3.5 mt-0.5 shrink-0 text-rose-500 dark:text-rose-400" />
                ) : (
                  <span className="mt-0.5 shrink-0 text-[11px] font-bold text-indigo-500 dark:text-indigo-400">·</span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 dark:text-slate-500 shrink-0">#{log.index}</span>
                    {log.statusCode && (
                      <span className={`px-1.5 py-px rounded text-[10px] font-bold shrink-0 ${
                        log.statusCode < 300 ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300"
                          : log.statusCode < 400 ? "bg-yellow-500/10 text-yellow-600 dark:bg-yellow-500/15 dark:text-yellow-300"
                          : "bg-rose-500/10 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300"
                      }`}>
                        {log.statusCode}
                      </span>
                    )}
                    <span className={`truncate text-[11px] flex-1 ${
                      log.status === "success" ? "text-slate-800 dark:text-emerald-200/70" : "text-slate-800 dark:text-rose-200/70"
                    }`}>{log.message}</span>
                    <span className="text-[10px] text-slate-400 dark:text-slate-600 shrink-0">{log.timestamp}</span>
                  </div>
                  {!!log.responseData && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[10px] text-slate-500 hover:text-slate-800 dark:text-slate-500 dark:hover:text-slate-350">View response</summary>
                      <pre className="mt-1 text-[10px] text-slate-600 dark:text-slate-400 bg-slate-500/5 dark:bg-black/20 p-2 rounded border border-slate-500/10 dark:border-white/5 overflow-x-auto whitespace-pre-wrap break-all max-h-28">
                        {JSON.stringify(log.responseData, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
 
        {/* ── GRID ── */}
        {view === "grid" && logs.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {logs.map((log, i) => {
              const label = extractLabel(log.message);
              const isExpand = expandedId === log.id;
              const ok = log.status === "success";
              const err = log.status === "error";
              return (
                <div key={log.id}
                  onClick={() => setExpandedId(isExpand ? null : log.id)}
                  className={`card-in relative overflow-hidden rounded-xl border cursor-pointer
                    transition-all duration-200 hover:-translate-y-0.5 group ${
                    ok
                      ? "bg-emerald-500/[0.03] dark:bg-emerald-500/[0.04] border-emerald-500/15 dark:border-emerald-500/[0.15] hover:border-emerald-500/35 hover:bg-emerald-500/[0.06] hover:shadow-xl dark:hover:shadow-emerald-500/10"
                      : err
                      ? "bg-rose-500/[0.03] dark:bg-rose-500/[0.04] border-rose-500/15 dark:border-rose-500/[0.15] hover:border-rose-500/35 hover:bg-rose-500/[0.06] hover:shadow-xl dark:hover:shadow-rose-500/10"
                      : "bg-indigo-500/[0.03] dark:bg-indigo-500/[0.04] border-indigo-500/15 dark:border-indigo-500/[0.15]"
                  }`}
                  style={{ animationDelay: `${(i % 16) * 15}ms` }}
                >
                  {/* Left accent bar */}
                  <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${
                    ok ? "bg-gradient-to-b from-emerald-500 to-emerald-600 dark:from-emerald-400 dark:to-emerald-500"
                       : err ? "bg-gradient-to-b from-rose-500 to-rose-600 dark:from-rose-400 dark:to-rose-500"
                       : "bg-gradient-to-b from-indigo-500 to-indigo-600 dark:from-indigo-400 dark:to-indigo-500"
                  }`} />
 
                  <div className="pl-4 pr-3.5 pt-4 pb-3.5">
                    {/* Row 1: index + status badge */}
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">#{log.index}</span>
                      <div className="flex items-center gap-1.5">
                        {log.statusCode && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                            log.statusCode < 300 ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300"
                              : log.statusCode < 400 ? "bg-yellow-500/10 text-yellow-600 dark:bg-yellow-500/15 dark:text-yellow-300"
                              : "bg-rose-500/10 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300"
                          }`}>
                            {log.statusCode}
                          </span>
                        )}
                        <div className={`w-5 h-5 rounded-md flex items-center justify-center text-xs ${
                          ok ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-450"
                            : err ? "bg-rose-500/10 text-rose-600 dark:bg-rose-500/15 dark:text-rose-450"
                            : "bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400"
                        }`}>
                          {ok ? <FiCheck /> : err ? <FiX /> : "·"}
                        </div>
                      </div>
                    </div>
 
                    {/* Row 2: label */}
                    <p className={`text-sm font-bold mb-1 leading-tight truncate ${
                      ok ? "text-slate-800 dark:text-emerald-100" : err ? "text-slate-800 dark:text-rose-100" : "text-slate-800 dark:text-slate-200"
                    }`}>
                      {label || "—"}
                    </p>
 
                    {/* Row 3: timestamp */}
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">{log.timestamp}</span>
                      {!!log.responseData && (
                        <span className="text-[9px] text-slate-400 dark:text-slate-600 group-hover:text-slate-600 dark:group-hover:text-slate-400 transition-colors">
                          {isExpand ? "▲" : "▼"}
                        </span>
                      )}
                    </div>
 
                    {/* Expanded response */}
                    {isExpand && !!log.responseData && (
                      <div className="mt-3 pt-3 border-t border-slate-500/10 dark:border-white/[0.06]">
                        <pre className="text-[9px] font-mono text-slate-500 dark:text-slate-450 bg-slate-500/5 dark:bg-black/20 p-2 rounded overflow-x-auto whitespace-pre-wrap break-all max-h-24">
                          {JSON.stringify(log.responseData, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
