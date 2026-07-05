"use client";

import { useState, useRef, useMemo } from "react";
import { useSeederStore } from "@/store/seederStore";
import { useCollectionStore, ApiRequest, Environment, KeyValuePair } from "@/store/collectionStore";
import { prepareRequest } from "@/lib/requestRunner";
import { evaluateAssertions, AssertionResult } from "@/lib/assertions";
import { runScript } from "@/lib/scriptRunner";
import { resolveTemplates } from "@/lib/variables";
import { ensureOAuth2Token } from "@/lib/oauth2";
import { hasFileEntry, findReservedKeyCollision, buildMultipartRequest } from "@/lib/multipartRequest";
import { FiPlay, FiSliders, FiCheckCircle, FiXCircle, FiTrendingUp, FiClock, FiActivity, FiLoader, FiChevronDown, FiChevronUp } from "react-icons/fi";
import { Button, Checkbox, InputNumber, Progress } from "antd";
import { toast } from "@/lib/toast";
import confetti from "canvas-confetti";

interface RunnerLogItem {
  id: string;
  requestName: string;
  method: string;
  url: string;
  statusCode?: number;
  statusText?: string;
  responseTime: number;
  assertionResults: AssertionResult[];
  passed: boolean;
  timestamp: string;
}

export default function CollectionRunner() {
  const {
    isRunning,
    setIsRunning,
  } = useSeederStore();

  const {
    collections,
    activeCollectionId,
    environments,
    activeEnvironmentId,
    addToHistory,
    updateEnvironment,
    updateCollectionVariables,
    updateRequest,
  } = useCollectionStore();

  const activeEnv = environments.find((e) => e.id === activeEnvironmentId) || null;
  const globalsEnv = environments.find((e) => e.id === "env_globals") || null;

  // Only requests from the currently active collection
  const activeCollection = useMemo(
    () => collections.find((c) => c.id === activeCollectionId) || null,
    [collections, activeCollectionId]
  );
  const requests = useMemo(() => activeCollection?.requests || [], [activeCollection]);

  // Selected requests to run — reset whenever the active collection changes
  const [lastSeenCollectionId, setLastSeenCollectionId] = useState(activeCollectionId);
  const [selectedReqIds, setSelectedReqIds] = useState<string[]>(() =>
    requests.map((r) => r.id)
  );

  if (lastSeenCollectionId !== activeCollectionId) {
    setLastSeenCollectionId(activeCollectionId);
    setSelectedReqIds(requests.map((r) => r.id));
  }
  const [iterations, setIterations] = useState<number>(1);
  const [delay, setDelay] = useState<number>(100);

  // Runner execution state
  const [runnerLogs, setRunnerLogs] = useState<RunnerLogItem[]>([]);
  const [expandedLogIds, setExpandedLogIds] = useState<Record<string, boolean>>({});
  const [currentRequestIndex, setCurrentRequestIndex] = useState<number>(-1);
  const [currentIteration, setCurrentIteration] = useState<number>(0);
  
  const [stats, setStats] = useState({
    totalRequests: 0,
    completedRequests: 0,
    passedTests: 0,
    failedTests: 0,
    totalResponseTime: 0,
    minResponseTime: 999999,
    maxResponseTime: 0,
  });

  const abortRef = useRef(false);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedReqIds(requests.map((r) => r.id));
    } else {
      setSelectedReqIds([]);
    }
  };

  const handleToggleRequest = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedReqIds([...selectedReqIds, id]);
    } else {
      setSelectedReqIds(selectedReqIds.filter((x) => x !== id));
    }
  };

  const toggleLogExpand = (id: string) => {
    setExpandedLogIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const runRequest = async (
    req: ApiRequest,
    actEnv: Environment | null,
    globEnv: Environment | null,
    colVars: KeyValuePair[]
  ): Promise<{
    log: RunnerLogItem;
    updatedActEnvVars: KeyValuePair[];
    updatedGlobEnvVars: KeyValuePair[];
    updatedColVars: KeyValuePair[];
  }> => {
    let currentEnvVars = actEnv?.variables || [];
    let currentGlobalVars = globEnv?.variables || [];
    let currentColVars = colVars;

    // 1. Run Pre-request Script
    if (req.preRequestScript) {
      const preResult = await runScript(req.preRequestScript, {
        activeEnvName: actEnv?.name || null,
        activeEnvId: actEnv?.id || null,
        activeEnvVariables: currentEnvVars,
        globalEnvVariables: currentGlobalVars,
        collectionVariables: currentColVars,
        request: {
          url: req.baseUrl + "/" + req.endpoint,
          method: req.method,
          headers: req.headers.reduce((acc, h) => {
            if (h.enabled && h.key) acc[h.key] = h.value;
            return acc;
          }, {} as Record<string, string>),
          body: req.body.rawText || "",
        },
      });

      currentEnvVars = preResult.activeEnvVariables;
      currentGlobalVars = preResult.globalEnvVariables;
      currentColVars = preResult.collectionVariables;

      if (activeEnvironmentId) {
        updateEnvironment(activeEnvironmentId, { variables: currentEnvVars });
      }
      updateEnvironment("env_globals", { variables: currentGlobalVars });
      if (activeCollectionId) {
        updateCollectionVariables(activeCollectionId, currentColVars);
      }
    }

    const resolvedActiveEnv = activeEnvironmentId
      ? {
          id: activeEnvironmentId,
          name: actEnv?.name || "",
          variables: currentEnvVars,
        }
      : null;
    const resolvedGlobalsEnv = {
      id: "env_globals",
      name: "Globals",
      variables: currentGlobalVars,
    };

    let requestForSend = req;
    if (req.auth?.type === "oauth2") {
      const resolve = (v: string) => resolveTemplates(v, resolvedActiveEnv, resolvedGlobalsEnv, currentColVars);
      const tokenResult = await ensureOAuth2Token(req, resolve);
      if (tokenResult && Object.keys(tokenResult.oauth2Updates).length > 0) {
        const auth = { ...req.auth, oauth2: { ...req.auth.oauth2, ...tokenResult.oauth2Updates } };
        updateRequest(req.id, { auth });
        requestForSend = { ...req, auth };
      }
    }

    const prepared = prepareRequest(requestForSend, resolvedActiveEnv, resolvedGlobalsEnv, currentColVars);
    const timestamp = new Date().toLocaleTimeString();

    try {
      let response: Response;
      if (hasFileEntry(prepared.data)) {
        const collision = findReservedKeyCollision(prepared.data);
        if (collision) {
          throw new Error(`Form field key "${collision}" is reserved — please rename it.`);
        }
        response = await fetch("/api/seed", { method: "POST", body: buildMultipartRequest(prepared) });
      } else {
        response = await fetch("/api/seed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: prepared.url,
            method: prepared.method,
            contentType: prepared.contentType,
            headers: prepared.headers,
            data: prepared.data,
          }),
        });
      }

      const result = await response.json();

      if (result.error) {
        return {
          log: {
            id: `log_${Date.now()}_${Math.random()}`,
            requestName: req.name,
            method: prepared.method,
            url: prepared.url,
            statusCode: result.status || 500,
            statusText: result.error,
            responseTime: result.responseTime || 0,
            assertionResults: [],
            passed: false,
            timestamp,
          },
          updatedActEnvVars: currentEnvVars,
          updatedGlobEnvVars: currentGlobalVars,
          updatedColVars: currentColVars,
        };
      }

      const proxyRes = {
        status: result.status,
        statusText: result.statusText,
        headers: result.headers || {},
        data: result.data,
        responseTime: result.responseTime || 0,
      };

      const assertionResults = evaluateAssertions(proxyRes, req.assertions || []);

      // 2. Run Post-response Script
      let scriptTestResults: AssertionResult[] = [];
      if (req.postResponseScript) {
        const postResult = await runScript(req.postResponseScript, {
          activeEnvName: actEnv?.name || null,
          activeEnvId: actEnv?.id || null,
          activeEnvVariables: currentEnvVars,
          globalEnvVariables: currentGlobalVars,
          collectionVariables: currentColVars,
          request: {
            url: prepared.url,
            method: req.method,
            headers: req.headers.reduce((acc, h) => {
              if (h.enabled && h.key) acc[h.key] = h.value;
              return acc;
            }, {} as Record<string, string>),
            body: req.body.rawText || "",
          },
          response: {
            status: result.status,
            statusText: result.statusText,
            headers: result.headers || {},
            data: result.data,
            responseTime: result.responseTime || 0,
          },
        });

        currentEnvVars = postResult.activeEnvVariables;
        currentGlobalVars = postResult.globalEnvVariables;
        currentColVars = postResult.collectionVariables;

        if (activeEnvironmentId) {
          updateEnvironment(activeEnvironmentId, { variables: currentEnvVars });
        }
        updateEnvironment("env_globals", { variables: currentGlobalVars });
        if (activeCollectionId) {
          updateCollectionVariables(activeCollectionId, currentColVars);
        }

        scriptTestResults = postResult.testResults.map((tr) => ({
          id: `script_assert_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          target: "script",
          property: "",
          operator: "script",
          expectedValue: "passed",
          actualValue: tr.passed ? "passed" : "failed",
          passed: tr.passed,
          message: tr.passed ? tr.name : `${tr.name}: ${tr.error || "assertion failed"}`,
        }));
      }

      const combinedAssertions = [...assertionResults, ...scriptTestResults];
      const passed = combinedAssertions.every((ar) => ar.passed);

      return {
        log: {
          id: `log_${Date.now()}_${Math.random()}`,
          requestName: req.name,
          method: prepared.method,
          url: prepared.url,
          statusCode: result.status,
          statusText: result.statusText,
          responseTime: result.responseTime || 0,
          assertionResults: combinedAssertions,
          passed,
          timestamp,
        },
        updatedActEnvVars: currentEnvVars,
        updatedGlobEnvVars: currentGlobalVars,
        updatedColVars: currentColVars,
      };
    } catch {
      return {
        log: {
          id: `log_${Date.now()}_${Math.random()}`,
          requestName: req.name,
          method: prepared.method,
          url: prepared.url,
          statusCode: 500,
          statusText: "Connection Error",
          responseTime: 0,
          assertionResults: [],
          passed: false,
          timestamp,
        },
        updatedActEnvVars: currentEnvVars,
        updatedGlobEnvVars: currentGlobalVars,
        updatedColVars: currentColVars,
      };
    }
  };

  const handleRunCollection = async () => {
    const selectedRequests = requests.filter((r) => selectedReqIds.includes(r.id));
    if (selectedRequests.length === 0) {
      toast.warning("Select at least one request to run");
      return;
    }

    setIsRunning(true);
    abortRef.current = false;
    setRunnerLogs([]);
    setExpandedLogIds({});
    setCurrentRequestIndex(0);
    setCurrentIteration(1);

    const totalToRun = selectedRequests.length * iterations;
    setStats({
      totalRequests: totalToRun,
      completedRequests: 0,
      passedTests: 0,
      failedTests: 0,
      totalResponseTime: 0,
      minResponseTime: 999999,
      maxResponseTime: 0,
    });

    let currentCompleted = 0;
    let currentPassed = 0;
    let currentFailed = 0;
    let currentTotalTime = 0;
    let minTime = 999999;
    let maxTime = 0;

    for (let iter = 1; iter <= iterations; iter++) {
      if (abortRef.current) break;
      setCurrentIteration(iter);

      let runningActEnvVars = activeEnv?.variables || [];
      let runningGlobEnvVars = globalsEnv?.variables || [];
      let runningColVars = activeCollection?.variables || [];

      for (let i = 0; i < selectedRequests.length; i++) {
        if (abortRef.current) break;
        setCurrentRequestIndex(i);

        const req = selectedRequests[i];

        const tempActEnv = activeEnvironmentId
          ? {
              id: activeEnvironmentId,
              name: activeEnv?.name || "",
              variables: runningActEnvVars,
            }
          : null;

        const tempGlobEnv = {
          id: "env_globals",
          name: "Globals",
          variables: runningGlobEnvVars,
        };

        const result = await runRequest(req, tempActEnv, tempGlobEnv, runningColVars);
        const log = result.log;

        runningActEnvVars = result.updatedActEnvVars;
        runningGlobEnvVars = result.updatedGlobEnvVars;
        runningColVars = result.updatedColVars;

        // Update stats
        currentCompleted++;
        if (log.passed) {
          currentPassed++;
        } else {
          currentFailed++;
        }

        if (log.responseTime > 0) {
          currentTotalTime += log.responseTime;
          minTime = Math.min(minTime, log.responseTime);
          maxTime = Math.max(maxTime, log.responseTime);
        }

        setStats({
          totalRequests: totalToRun,
          completedRequests: currentCompleted,
          passedTests: currentPassed,
          failedTests: currentFailed,
          totalResponseTime: currentTotalTime,
          minResponseTime: minTime === 999999 ? 0 : minTime,
          maxResponseTime: maxTime,
        });

        setRunnerLogs((prev) => [log, ...prev]);

        // Add to history store
        addToHistory({
          requestId: req.id,
          requestName: req.name,
          method: log.method,
          url: log.url,
          status: log.passed ? "success" : "error",
          statusCode: log.statusCode,
          responseTime: log.responseTime,
          assertionPassCount: log.assertionResults.filter((ar) => ar.passed).length,
          assertionTotalCount: log.assertionResults.length,
        });

        // Delay between loops
        if (delay > 0 && currentCompleted < totalToRun) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    setIsRunning(false);
    setCurrentRequestIndex(-1);
    setCurrentIteration(0);

    if (currentFailed === 0 && currentCompleted > 0 && !abortRef.current) {
      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 },
      });
      toast.success("Collection test run completed with 100% pass rate!");
    } else if (!abortRef.current) {
      toast.warning(`Collection run finished: ${currentFailed} failed tests`);
    } else {
      toast.info("Runner stopped by user");
    }
  };

  const handleStopRunner = () => {
    abortRef.current = true;
    setIsRunning(false);
  };

  const progressPercent = stats.totalRequests > 0 
    ? Math.round((stats.completedRequests / stats.totalRequests) * 100) 
    : 0;

  const avgResponseTime = stats.completedRequests > 0 
    ? Math.round(stats.totalResponseTime / stats.completedRequests) 
    : 0;

  return (
    <div className="w-full px-5 py-5 flex flex-col lg:flex-row gap-5 lg:h-full lg:min-h-0 lg:overflow-hidden bg-slate-500/[0.005] dark:bg-[#07080f]/40">

      {/* ── LEFT PANEL: RUNNER SETTINGS & TARGET CHECKLIST ── */}
      <div className="w-full lg:w-80 shrink-0 flex flex-col gap-3 lg:h-full lg:min-h-0 bg-white/40 dark:bg-white/[0.01] border border-slate-500/10 dark:border-white/[0.06] rounded-2xl p-4 lg:overflow-hidden shadow-sm">
        
        <div className="flex items-center justify-between border-b border-slate-500/10 dark:border-white/[0.05] pb-2 shrink-0">
          <div className="min-w-0">
            <h3 className="text-xs font-bold text-slate-550 dark:text-slate-400 uppercase tracking-wider">
              Run Collection
            </h3>
            {activeCollection && (
              <p className="text-[10px] text-indigo-500 font-semibold truncate mt-0.5">{activeCollection.name}</p>
            )}
          </div>
          <span className="text-[10px] text-slate-500 font-bold shrink-0">
            {requests.length} Requests
          </span>
        </div>

        {/* Configurations */}
        <div className="grid grid-cols-2 gap-3.5 bg-slate-500/5 dark:bg-white/[0.015] p-3 rounded-xl border border-slate-500/10 dark:border-white/[0.05] shrink-0">
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-450 uppercase mb-1 flex items-center gap-1">
              <FiSliders className="w-3 h-3 text-indigo-500" />
              Loops
            </p>
            <InputNumber
              min={1}
              max={100}
              value={iterations}
              onChange={(v) => setIterations(v || 1)}
              disabled={isRunning}
              className="w-full"
            />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-450 uppercase mb-1 flex items-center gap-1">
              <FiClock className="w-3 h-3 text-indigo-500" />
              Delay (ms)
            </p>
            <InputNumber
              min={0}
              max={10000}
              step={50}
              value={delay}
              onChange={(v) => setDelay(v || 0)}
              disabled={isRunning}
              className="w-full"
            />
          </div>
        </div>

        {/* Selection Checklist */}
        <div className="flex-1 flex flex-col lg:min-h-0">
          <div className="flex items-center justify-between px-1.5 py-1 text-[10px] font-bold text-slate-550 dark:text-slate-450 shrink-0">
            <Checkbox
              checked={selectedReqIds.length === requests.length && requests.length > 0}
              indeterminate={selectedReqIds.length > 0 && selectedReqIds.length < requests.length}
              onChange={(e) => handleSelectAll(e.target.checked)}
              disabled={isRunning || requests.length === 0}
            >
              Select All
            </Checkbox>
            <span>{selectedReqIds.length} Selected</span>
          </div>

          <div className="flex-1 lg:overflow-y-auto space-y-1.5 pr-1 lg:min-h-0 border border-slate-500/10 dark:border-white/[0.05] rounded-xl p-2 bg-slate-500/[0.01] dark:bg-white/[0.005]">
            {requests.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500">
                Create requests in the workspace builder first.
              </div>
            ) : (
              requests.map((req, idx) => {
                const isSelected = selectedReqIds.includes(req.id);
                const isCurrent = isRunning && currentRequestIndex === idx;

                let methodBg = "bg-indigo-500/10 text-indigo-500";
                if (req.method === "GET") methodBg = "bg-emerald-500/10 text-emerald-500";
                if (req.method === "DELETE") methodBg = "bg-rose-500/10 text-rose-500";
                if (req.method === "PUT" || req.method === "PATCH") methodBg = "bg-amber-500/10 text-amber-550";

                return (
                  <div
                    key={req.id}
                    className={`flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg border transition-colors ${
                      isCurrent
                        ? "bg-indigo-500/10 border-indigo-500/40 text-indigo-650 dark:text-indigo-400 font-semibold"
                        : "bg-transparent border-slate-550/5 dark:border-white/[0.02] text-slate-700 dark:text-slate-400 hover:border-slate-500/10"
                    }`}
                  >
                    <Checkbox
                      checked={isSelected}
                      onChange={(e) => handleToggleRequest(req.id, e.target.checked)}
                      disabled={isRunning}
                    />
                    <div className="flex-1 min-w-0 pr-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[8px] font-black px-1 rounded uppercase tracking-wider shrink-0 ${methodBg}`}>
                          {req.method}
                        </span>
                        <span className="truncate text-xs font-semibold">{req.name}</span>
                      </div>
                      <p className="text-[9px] font-mono text-slate-500 truncate mt-0.5">
                        {req.baseUrl}/{req.endpoint}
                      </p>
                    </div>

                    {isCurrent && (
                      <FiLoader className="w-3.5 h-3.5 animate-spin text-indigo-500 shrink-0" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Trigger Execute Buttons */}
        <div className="shrink-0 mt-1">
          {isRunning ? (
            <Button
              danger
              onClick={handleStopRunner}
              className="w-full h-11 rounded-full font-bold flex items-center justify-center gap-2"
            >
              Stop Test Suite
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<FiPlay />}
              onClick={handleRunCollection}
              disabled={selectedReqIds.length === 0 || requests.length === 0}
              className="w-full h-11 rounded-full font-bold flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-500 to-indigo-600 border-none shadow-lg shadow-indigo-500/25 hover:shadow-indigo-550/35 hover:from-indigo-450 hover:to-indigo-550"
            >
              Run collection
            </Button>
          )}
        </div>
      </div>

      {/* ── RIGHT PANEL: METRICS & VISUAL RESULTS CHECKLIST ── */}
      <div className="flex-1 flex flex-col gap-3 lg:h-full lg:min-h-0 bg-white/40 dark:bg-white/[0.01] border border-slate-500/10 dark:border-white/[0.06] rounded-2xl p-5 lg:overflow-hidden shadow-sm">
        
        {/* Statistics Panels */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 shrink-0">
          {/* Progress */}
          <div className="bg-slate-500/5 dark:bg-white/[0.015] border border-slate-500/10 dark:border-white/[0.05] rounded-xl p-3 flex flex-col justify-between h-20">
            <span className="text-[10px] font-bold text-slate-550 dark:text-slate-500 uppercase tracking-wider block">
              Total Progress
            </span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-xl font-black text-slate-900 dark:text-white tabular-nums">
                {stats.completedRequests}
              </span>
              <span className="text-xs text-slate-500 font-semibold">/ {stats.totalRequests} runs</span>
            </div>
            <Progress 
              percent={progressPercent} 
              size="small" 
              showInfo={false} 
              strokeColor="#6366f1"
              trailColor="rgba(0,0,0,0.05)" 
              className="mb-1"
            />
          </div>

          {/* Test Outcomes */}
          <div className="bg-slate-500/5 dark:bg-white/[0.015] border border-slate-500/10 dark:border-white/[0.05] rounded-xl p-3 flex flex-col justify-between h-20">
            <span className="text-[10px] font-bold text-slate-550 dark:text-slate-500 uppercase tracking-wider block">
              Passed / Failed
            </span>
            <div className="flex items-center gap-3.5 mt-0.5">
              <div className="flex items-center gap-1">
                <FiCheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span className="text-lg font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {stats.passedTests}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <FiXCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                <span className={`text-lg font-black tabular-nums ${stats.failedTests > 0 ? "text-rose-600 dark:text-rose-455" : "text-slate-500"}`}>
                  {stats.failedTests}
                </span>
              </div>
            </div>
            <span className="text-[9px] text-slate-500 font-semibold block">
              {stats.completedRequests > 0 ? `${Math.round((stats.passedTests / stats.completedRequests) * 100)}% pass rate` : "No runs recorded"}
            </span>
          </div>

          {/* Response Latencies */}
          <div className="bg-slate-500/5 dark:bg-white/[0.015] border border-slate-500/10 dark:border-white/[0.05] rounded-xl p-3 flex flex-col justify-between h-20">
            <span className="text-[10px] font-bold text-slate-550 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1">
              Avg Latency
            </span>
            <span className="text-xl font-black text-slate-900 dark:text-white tabular-nums mt-0.5">
              {avgResponseTime} <span className="text-xs font-normal text-slate-500 font-semibold">ms</span>
            </span>
            <span className="text-[9px] text-slate-550 dark:text-slate-500 font-semibold">
              Min: {stats.minResponseTime}ms / Max: {stats.maxResponseTime}ms
            </span>
          </div>

          {/* Active Env / Status */}
          <div className="bg-slate-500/5 dark:bg-white/[0.015] border border-slate-500/10 dark:border-white/[0.05] rounded-xl p-3 flex flex-col justify-between h-20">
            <span className="text-[10px] font-bold text-slate-550 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1">
              Active Environment
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`} />
              <span className="text-xs font-bold text-slate-700 dark:text-slate-350 truncate max-w-[120px]">
                {activeEnv?.name || "Globals"}
              </span>
            </div>
            <span className="text-[9px] text-slate-500 font-semibold block">
              {isRunning ? `Running iter ${currentIteration}/${iterations}` : "Ready"}
            </span>
          </div>
        </div>

        {/* Clean pass/fail execution results card list */}
        <div className="flex-1 flex flex-col border border-slate-500/10 dark:border-white/[0.06] rounded-2xl lg:overflow-hidden bg-slate-500/[0.01] dark:bg-white/[0.002] lg:min-h-0">
          
          {/* List Header */}
          <div className="px-4 py-2.5 bg-slate-500/5 dark:bg-white/[0.015] border-b border-slate-500/10 dark:border-white/[0.05] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase tracking-wider">
              <FiActivity className="w-3.5 h-3.5 text-indigo-500" />
              Test Execution Logs
            </div>
            <button
              onClick={() => {
                setRunnerLogs([]);
                setExpandedLogIds({});
              }}
              disabled={isRunning || runnerLogs.length === 0}
              className="text-[9px] font-bold text-rose-500 hover:underline disabled:opacity-20 transition-all cursor-pointer"
            >
              Clear Output
            </button>
          </div>

          {/* Cards List */}
          <div className="flex-1 lg:overflow-y-auto p-4 space-y-2.5 lg:min-h-0 bg-slate-500/[0.005] dark:bg-[#07080f]/10">
            {runnerLogs.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 dark:text-slate-650 gap-2 py-12">
                <FiTrendingUp className="w-8 h-8 opacity-20 animate-pulse" />
                <p className="text-xs font-bold">No runs recorded</p>
                <p className="text-[10px] text-center max-w-[200px] mt-0.5">
                  Select requests on the checklist and click &quot;Run Collection&quot; to execute tests.
                </p>
              </div>
            )}

            {runnerLogs.map((log) => {
              const isExpanded = !!expandedLogIds[log.id];
              const ok = log.passed;

              let methodBg = "bg-indigo-500/10 text-indigo-500";
              if (log.method === "GET") methodBg = "bg-emerald-500/10 text-emerald-500";
              if (log.method === "DELETE") methodBg = "bg-rose-500/10 text-rose-500";
              if (log.method === "PUT" || log.method === "PATCH") methodBg = "bg-amber-500/10 text-amber-550";

              return (
                <div
                  key={log.id}
                  onClick={() => toggleLogExpand(log.id)}
                  className={`border rounded-xl p-3 bg-white/40 dark:bg-white/[0.005] cursor-pointer transition-all hover:bg-slate-550/[0.01] hover:border-slate-500/15 ${
                    ok
                      ? "border-emerald-500/15 dark:border-emerald-500/[0.08]"
                      : "border-rose-500/15 dark:border-rose-500/[0.08]"
                  }`}
                >
                  {/* Card Header Summary */}
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      {ok ? (
                        <FiCheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                      ) : (
                        <FiXCircle className="w-4 h-4 text-rose-500 shrink-0" />
                      )}
                      
                      <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0 ${methodBg}`}>
                        {log.method}
                      </span>
                      
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-205 truncate">
                        {log.requestName}
                      </span>
                      
                      <span className="text-[10px] text-slate-500 truncate max-w-xs font-mono hidden md:inline">
                        {log.url}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 text-[10px] font-bold">
                      <span className={`px-1.5 py-px rounded ${
                        log.statusCode && log.statusCode < 300 ? "text-emerald-500 bg-emerald-500/10" : "text-rose-500 bg-rose-500/10"
                      }`}>
                        {log.statusCode || "ERR"}
                      </span>
                      
                      <span className="text-slate-700 dark:text-slate-350 tabular-nums">
                        {log.responseTime} ms
                      </span>

                      {log.assertionResults.length > 0 && (
                        <span className={ok ? "text-emerald-500" : "text-rose-500"}>
                          {log.assertionResults.filter((ar) => ar.passed).length}/{log.assertionResults.length} Tests
                        </span>
                      )}

                      {log.assertionResults.length > 0 ? (
                        isExpanded ? <FiChevronUp className="text-slate-500 w-3.5 h-3.5" /> : <FiChevronDown className="text-slate-500 w-3.5 h-3.5" />
                      ) : null}
                    </div>
                  </div>

                  {/* Assertion Pass/Fail Log details (Collapsible) */}
                  {isExpanded && log.assertionResults.length > 0 && (
                    <div
                      className="mt-2.5 pt-2.5 border-t border-slate-500/10 dark:border-white/[0.05] space-y-1.5 pl-6 font-mono text-[10px]"
                      onClick={(e) => e.stopPropagation()} // Stop toggle bubble
                    >
                      {log.assertionResults.map((ar) => (
                        <div key={ar.id} className="flex items-start gap-2">
                          {ar.passed ? (
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0 block" />
                          ) : (
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0 block" />
                          )}
                          <span className={ar.passed ? "text-emerald-500/80" : "text-rose-500/90"}>
                            {ar.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
