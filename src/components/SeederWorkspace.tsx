"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import { useSeederStore } from "@/store/seederStore";
import { useCollectionStore, ApiRequest, Assertion, AssertionTarget, AssertionOperator, AuthType, BodyType, Environment, KeyValuePair } from "@/store/collectionStore";
import { prepareRequest } from "@/lib/requestRunner";
import { evaluateAssertions, AssertionResult } from "@/lib/assertions";
import { runScript } from "@/lib/scriptRunner";
import { resolveTemplates } from "@/lib/variables";
import { fetchClientCredentialsToken, runAuthorizationCodeFlow, ensureOAuth2Token } from "@/lib/oauth2";
import { hasFileEntry, findReservedKeyCollision, buildMultipartRequest } from "@/lib/multipartRequest";
import SecurityPanel from "./SecurityPanel";
import { HTTP_METHODS, METHOD_THEMES } from "@/lib/methodThemes";
import KeyValueTable from "./KeyValueTable";
import { FiLoader, FiTerminal, FiDatabase, FiCheckCircle, FiXCircle, FiCpu, FiCode, FiLayers, FiPlus, FiCopy, FiAlignLeft, FiCoffee, FiTrash2, FiActivity } from "react-icons/fi";
import { Select, Input, Button, ConfigProvider, Tabs, InputNumber, Progress, AutoComplete, Checkbox } from "antd";
import { toast } from "@/lib/toast";
import confetti from "canvas-confetti";
import { FaPlay } from "react-icons/fa";

/* ── Script Snippets ── */
const SCRIPT_SNIPPETS = [
  {
    category: "Response",
    items: [
      { label: "Parse JSON body", code: `const body = be.response.json();\nconsole.log("body:", body);` },
      { label: "Get status code", code: `console.log("Status:", be.response.code);` },
      { label: "Get response header", code: `console.log("Content-Type:", be.response.headers.get("content-type"));` },
      { label: "Get response time", code: `console.log("Response time:", be.response.responseTime, "ms");` },
    ],
  },
  {
    category: "Variables — Set",
    items: [
      { label: "Set env variable", code: `be.environment.set("key", "value");` },
      { label: "Set global variable", code: `be.globals.set("key", "value");` },
      { label: "Set collection variable", code: `be.collectionVariables.set("key", "value");` },
      { label: "Set local variable", code: `be.locals.set("key", "value");` },
      { label: "Save token", code: `be.environment.set("token", be.response.json().access_token);\nconsole.log("Token saved");` },
    ],
  },
  {
    category: "Variables — Get",
    items: [
      { label: "Get env variable", code: `console.log(be.environment.get("key"));` },
      { label: "Get global variable", code: `console.log(be.globals.get("key"));` },
      { label: "Get collection variable", code: `console.log(be.collectionVariables.get("key"));` },
      { label: "Get local variable", code: `console.log(be.locals.get("key"));` },
    ],
  },
  {
    category: "Variables — Clear",
    items: [
      { label: "Clear env variable", code: `be.environment.unset("key");` },
      { label: "Clear global variable", code: `be.globals.unset("key");` },
      { label: "Clear collection variable", code: `be.collectionVariables.unset("key");` },
      { label: "Clear local variable", code: `be.locals.unset("key");` },
    ],
  },
  {
    category: "Tests",
    items: [
      { label: "Status is 200", code: `be.test("Status is 200", () => {\n  be.expect(be.response.code).to.equal(200);\n});` },
      { label: "Response time < 500ms", code: `be.test("Response time < 500ms", () => {\n  be.expect(be.response.responseTime).to.be.lessThan(500);\n});` },
      { label: "Response is success", code: `be.test("Response is OK", () => {\n  be.response.to.be.ok;\n});` },
    ],
  },
];

interface SingleRequestResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: unknown;
  responseTime: number;
  error?: string;
}

/** Execution state for one request, keyed by request id so switching tabs never bleeds another request's in-flight run into view. */
interface RunState {
  isRunning: boolean;
  progress: { sent: number; total: number; succeeded: number; failed: number; logs: string[] };
  consoleLogs: { source: "pre" | "post"; text: string }[];
  lastResponse: {
    status: number;
    statusText: string;
    responseTime: number;
    headers: Record<string, string>;
    data: unknown;
    assertions: AssertionResult[];
    passed: boolean;
  } | null;
}

const DEFAULT_RUN_STATE: RunState = {
  isRunning: false,
  progress: { sent: 0, total: 0, succeeded: 0, failed: 0, logs: [] },
  consoleLogs: [],
  lastResponse: null,
};

export default function SeederWorkspace() {
  // This is a single shared flag across the whole app (used by RequestSidebar
  // to disable structural actions while *anything* runs) — we only write to
  // it here (kept in sync with per-request run state below); the per-tab
  // `isRunning` used everywhere else in this file is a separate, derived value.
  const { setIsRunning: setAnyRequestRunningGlobal } = useSeederStore();

  const {
    collections,
    activeCollectionId,
    activeRequestId,
    updateRequest,
    environments,
    activeEnvironmentId,
    addToHistory,
    updateEnvironment,
    updateCollectionVariables,
  } = useCollectionStore();

  const activeEnv = environments.find((e) => e.id === activeEnvironmentId) || null;
  const globalsEnv = environments.find((e) => e.id === "env_globals") || null;
  const activeCollection = useMemo(
    () => collections.find((c) => c.id === activeCollectionId) || null,
    [collections, activeCollectionId]
  );

  // Active Request Resolver — search across all collections
  const activeReq = useMemo(() => {
    for (const col of collections) {
      const req = col.requests.find((r) => r.id === activeRequestId);
      if (req) return req;
    }
    return null;
  }, [collections, activeRequestId]);

  const [oauth2Loading, setOauth2Loading] = useState(false);

  // UI state for response display
  const [responseTab, setResponseTab] = useState<"body" | "headers" | "tests" | "codegen" | "console">("body");

  // Lifted out of SecurityPanel so "View Results" can live in the always-visible
  // metrics bar rather than being buried inside the Security tab.
  const [securityResultsDrawerOpen, setSecurityResultsDrawerOpen] = useState(false);

  const [copied, setCopied] = useState(false);
  const [copiedLang, setCopiedLang] = useState<string | null>(null);
  const [wrapResponse, setWrapResponse] = useState(false);

  // Per-request execution state — isRunning/progress/consoleLogs/lastResponse
  // are all keyed by request id so switching tabs mid-run shows the correct
  // (idle) state for whichever request is now active, and a run in progress
  // elsewhere keeps going untouched in the background.
  const [runStates, setRunStates] = useState<Record<string, RunState>>({});
  const abortFlags = useRef<Record<string, boolean>>({});

  const updateRunState = (id: string, patch: Partial<RunState> | ((prev: RunState) => Partial<RunState>)) => {
    setRunStates((prev) => {
      const current = prev[id] ?? DEFAULT_RUN_STATE;
      return { ...prev, [id]: { ...current, ...(typeof patch === "function" ? patch(current) : patch) } };
    });
  };

  const activeRunState = (activeRequestId && runStates[activeRequestId]) || DEFAULT_RUN_STATE;
  const isRunning = activeRunState.isRunning;
  const seederProgress = activeRunState.progress;
  const consoleLogs = activeRunState.consoleLogs;
  const lastResponse = activeRunState.lastResponse;

  // Keep the shared global flag (RequestSidebar's structural-action gate) in
  // sync with "is at least one request running anywhere," not just the active one.
  useEffect(() => {
    setAnyRequestRunningGlobal(Object.values(runStates).some((s) => s.isRunning));
  }, [runStates, setAnyRequestRunningGlobal]);

  // Reset the response sub-tab selection when switching requests (unrelated
  // UI preference — the actual response/console/progress data is already
  // correctly scoped per request via runStates, no clearing needed there).
  const [lastSeenRequestId, setLastSeenRequestId] = useState(activeRequestId);
  if (lastSeenRequestId !== activeRequestId) {
    setLastSeenRequestId(activeRequestId);
    setResponseTab("body");
  }

  const handleCopyResponse = () => {
    if (!lastResponse) return;
    const text = typeof lastResponse.data === "object"
      ? JSON.stringify(lastResponse.data, null, 2)
      : String(lastResponse.data);
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyLang = (lang: string, code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedLang(lang);
    setTimeout(() => setCopiedLang(null), 1500);
  };

  // Script editor refs for cursor-position snippet insertion
  const preScriptRef = useRef<{ resizableTextArea?: { textArea: HTMLTextAreaElement } } | null>(null);
  const postScriptRef = useRef<{ resizableTextArea?: { textArea: HTMLTextAreaElement } } | null>(null);
  const [focusedScript, setFocusedScript] = useState<"pre" | "post">("post");

  // Sync update request shortcuts
  const handleUpdate = (updates: Partial<ApiRequest>) => {
    if (activeReq) {
      updateRequest(activeReq.id, updates);
    }
  };

  const handleGetOAuth2Token = async () => {
    if (!activeReq || !activeReq.auth.oauth2) return;
    const oauth2 = activeReq.auth.oauth2;
    const resolve = (v: string) => resolveTemplates(v, activeEnv, globalsEnv, activeCollection?.variables);

    setOauth2Loading(true);
    try {
      const result = oauth2.grantType === "authorization_code"
        ? await runAuthorizationCodeFlow(oauth2, resolve)
        : await fetchClientCredentialsToken(oauth2, resolve);

      handleUpdate({
        auth: { ...activeReq.auth, oauth2: { ...oauth2, ...result.oauth2Updates } },
      });
      toast.success("Access token fetched");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to fetch access token");
    } finally {
      setOauth2Loading(false);
    }
  };

  const insertSnippet = (code: string) => {
    if (!activeReq) return;
    const isPre = focusedScript === "pre";
    const ref = isPre ? preScriptRef.current : postScriptRef.current;
    const textarea = ref?.resizableTextArea?.textArea;
    const current = isPre ? (activeReq.preRequestScript || "") : (activeReq.postResponseScript || "");
    const trimmedCode = code.trim();

    // Toggle off: this snippet's code is already present — remove it (plus the
    // trailing newline it was inserted with) instead of inserting a duplicate.
    if (current.includes(trimmedCode)) {
      const withoutSnippet = current
        .replace(`${trimmedCode}\n`, "")
        .replace(trimmedCode, "")
        .replace(/\n{3,}/g, "\n\n");
      handleUpdate(isPre ? { preRequestScript: withoutSnippet } : { postResponseScript: withoutSnippet });
      return;
    }

    let newVal: string;
    if (textarea) {
      const start = textarea.selectionStart;
      const prefix = current.slice(0, start);
      const suffix = current.slice(textarea.selectionEnd);
      newVal = prefix + (prefix && !prefix.endsWith("\n") ? "\n" : "") + code + "\n" + suffix;
    } else {
      newVal = current + (current && !current.endsWith("\n") ? "\n" : "") + code + "\n";
    }
    handleUpdate(isPre ? { preRequestScript: newVal } : { postResponseScript: newVal });
  };

  /* ── Assertions Evaluators ── */
  const handleAddAssertion = () => {
    if (!activeReq) return;
    const newAssertion: Assertion = {
      id: "assert_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
      target: "status_code",
      property: "",
      operator: "equals",
      value: "200",
    };
    handleUpdate({
      assertions: [...(activeReq.assertions || []), newAssertion],
    });
  };

  const handleUpdateAssertion = (id: string, updates: Partial<Assertion>) => {
    if (!activeReq) return;
    handleUpdate({
      assertions: activeReq.assertions.map((a) => (a.id === id ? { ...a, ...updates } : a)),
    });
  };

  const handleDeleteAssertion = (id: string) => {
    if (!activeReq) return;
    handleUpdate({
      assertions: activeReq.assertions.filter((a) => a.id !== id),
    });
  };

  /* ── Execution Logic ── */
  const fireSingleRequest = async (
    req: ApiRequest,
    actEnv: Environment | null = activeEnv,
    globEnv: Environment | null = globalsEnv,
    colVars: KeyValuePair[] = activeCollection?.variables || []
  ): Promise<SingleRequestResult> => {
    let requestForSend = req;
    if (req.auth?.type === "oauth2") {
      const resolve = (v: string) => resolveTemplates(v, actEnv, globEnv, colVars);
      const tokenResult = await ensureOAuth2Token(req, resolve);
      if (tokenResult && Object.keys(tokenResult.oauth2Updates).length > 0) {
        const auth = { ...req.auth, oauth2: { ...req.auth.oauth2, ...tokenResult.oauth2Updates } };
        updateRequest(req.id, { auth });
        requestForSend = { ...req, auth };
      }
    }

    const prepared = prepareRequest(requestForSend, actEnv, globEnv, colVars);
    const start = Date.now();

    try {
      let res: Response;
      if (hasFileEntry(prepared.data)) {
        const collision = findReservedKeyCollision(prepared.data);
        if (collision) {
          throw new Error(`Form field key "${collision}" is reserved — please rename it.`);
        }
        res = await fetch("/api/seed", { method: "POST", body: buildMultipartRequest(prepared) });
      } else {
        res = await fetch("/api/seed", {
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

      const result = await res.json();
      const elapsed = Date.now() - start;

      return {
        status: result.status || res.status,
        statusText: result.statusText || res.statusText,
        headers: result.headers || {},
        data: result.data || result.error || "No Response Content",
        responseTime: result.responseTime || elapsed,
        error: result.error,
      };
    } catch (e) {
      return {
        status: 500,
        statusText: "Connection Refused",
        headers: {},
        data: String(e),
        responseTime: Date.now() - start,
        error: String(e),
      };
    }
  };

  const handleRunRequest = async () => {
    if (!activeReq) return;
    const requestId = activeReq.id;
    updateRunState(requestId, { isRunning: true, lastResponse: null });
    abortFlags.current[requestId] = false;

    const isItemsMode = activeReq.seedMode === "items";

    // Parse items for items mode
    let payloads: unknown[] = [null];
    if (isItemsMode) {
      try {
        const parsed = JSON.parse(activeReq.jsonItems || "[]");
        if (Array.isArray(parsed) && parsed.length > 0) {
          payloads = parsed;
        } else {
          toast.error("Multiple items payload must be a non-empty JSON array");
          updateRunState(requestId, { isRunning: false });
          return;
        }
      } catch {
        toast.error("Invalid JSON Array syntax in items payload");
        updateRunState(requestId, { isRunning: false });
        return;
      }
    } else {
      payloads = Array(activeReq.repeatCount || 1).fill(null);
    }

    updateRunState(requestId, {
      consoleLogs: [],
      progress: { sent: 0, total: payloads.length, succeeded: 0, failed: 0, logs: [] },
    });

    let localSuccess = 0;
    let localFail = 0;

    for (let i = 0; i < payloads.length; i++) {
      if (abortFlags.current[requestId]) {
        updateRunState(requestId, (prev) => ({
          progress: { ...prev.progress, logs: ["Execution halted by user", ...prev.progress.logs] },
        }));
        break;
      }

      // Configure request context item mapping
      const currentReq = { ...activeReq };
      if (isItemsMode) {
        // If items mode, payload is the item itself
        if (activeReq.body.type === "json") {
          currentReq.body = {
            ...currentReq.body,
            rawText: typeof payloads[i] === "object" ? JSON.stringify(payloads[i]) : String(payloads[i]),
          };
        } else {
          // urlencoded or formdata
          currentReq.body = {
            ...currentReq.body,
            formdata: Object.entries(payloads[i] as Record<string, unknown>).map(([k, v]) => ({ key: k, type: "text" as const, value: String(v), enabled: true })),
          };
        }
      }

      let currentEnvVars = activeEnv?.variables || [];
      let currentGlobalVars = globalsEnv?.variables || [];
      let currentColVars = activeCollection?.variables || [];

      // Run Pre-request Script
      if (currentReq.preRequestScript) {
        const preResult = await runScript(currentReq.preRequestScript, {
          activeEnvName: activeEnv?.name || null,
          activeEnvId: activeEnv?.id || null,
          activeEnvVariables: currentEnvVars,
          globalEnvVariables: currentGlobalVars,
          collectionVariables: currentColVars,
          request: {
            url: currentReq.baseUrl + "/" + currentReq.endpoint,
            method: currentReq.method,
            headers: currentReq.headers.reduce((acc, h) => {
              if (h.enabled && h.key) acc[h.key] = h.value;
              return acc;
            }, {} as Record<string, string>),
            body: currentReq.body.rawText || "",
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

        if (preResult.logs.length > 0) {
          updateRunState(requestId, (prev) => ({
            consoleLogs: [...prev.consoleLogs, ...preResult.logs.map((text) => ({ source: "pre" as const, text }))],
            progress: {
              ...prev.progress,
              logs: [...preResult.logs.map((l) => `[Pre-request] ${l}`), ...prev.progress.logs],
            },
          }));
        }
      }

      // Resolve variables configured/modified after pre-request script
      const latestActiveEnv = activeEnvironmentId
        ? {
          id: activeEnvironmentId,
          name: activeEnv?.name || "",
          variables: currentEnvVars,
        }
        : null;
      const latestGlobalsEnv = {
        id: "env_globals",
        name: "Globals",
        variables: currentGlobalVars,
      };

      const res = await fireSingleRequest(currentReq, latestActiveEnv, latestGlobalsEnv, currentColVars);

      // Evaluate visual assertions
      const assertionResults = evaluateAssertions(
        {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
          data: res.data,
          responseTime: res.responseTime,
        },
        activeReq.assertions || []
      );

      // Run Post-response Script
      let scriptTestResults: AssertionResult[] = [];
      if (currentReq.postResponseScript) {
        const postResult = await runScript(currentReq.postResponseScript, {
          activeEnvName: activeEnv?.name || null,
          activeEnvId: activeEnv?.id || null,
          activeEnvVariables: currentEnvVars,
          globalEnvVariables: currentGlobalVars,
          collectionVariables: currentColVars,
          request: {
            url: currentReq.baseUrl + "/" + currentReq.endpoint,
            method: currentReq.method,
            headers: currentReq.headers.reduce((acc, h) => {
              if (h.enabled && h.key) acc[h.key] = h.value;
              return acc;
            }, {} as Record<string, string>),
            body: currentReq.body.rawText || "",
          },
          response: {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
            data: res.data,
            responseTime: res.responseTime,
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

        if (postResult.logs.length > 0) {
          updateRunState(requestId, (prev) => ({
            consoleLogs: [...prev.consoleLogs, ...postResult.logs.map((text) => ({ source: "post" as const, text }))],
            progress: {
              ...prev.progress,
              logs: [...postResult.logs.map((l) => `[Post-response] ${l}`), ...prev.progress.logs],
            },
          }));
        }
      }

      const combinedAssertions = [...assertionResults, ...scriptTestResults];
      const passed = combinedAssertions.every((ar) => ar.passed);

      if (passed && res.status >= 200 && res.status < 350) {
        localSuccess++;
      } else {
        localFail++;
      }

      updateRunState(requestId, (prev) => ({
        progress: {
          ...prev.progress,
          sent: i + 1,
          succeeded: localSuccess,
          failed: localFail,
          logs: [
            `#${i + 1} [${currentReq.method}] Status ${res.status} | Latency ${res.responseTime}ms | assertions: ${combinedAssertions.filter((a) => a.passed).length
            }/${combinedAssertions.length} passed`,
            ...prev.progress.logs,
          ],
        },
      }));

      // Set output context for single request or last request
      if (i === payloads.length - 1 || payloads.length === 1) {
        updateRunState(requestId, {
          lastResponse: {
            status: res.status,
            statusText: res.statusText,
            responseTime: res.responseTime,
            headers: res.headers,
            data: res.data,
            assertions: combinedAssertions,
            passed,
          },
        });

        // Add history entry to store
        addToHistory({
          requestId: activeReq.id,
          requestName: activeReq.name,
          method: activeReq.method,
          url: activeReq.baseUrl + "/" + activeReq.endpoint,
          status: passed ? "success" : "error",
          statusCode: res.status,
          responseTime: res.responseTime,
          assertionPassCount: combinedAssertions.filter((a) => a.passed).length,
          assertionTotalCount: combinedAssertions.length,
        });
      }

      // Delay between loops
      if (activeReq.delay > 0 && i < payloads.length - 1) {
        await new Promise((r) => setTimeout(r, activeReq.delay));
      }
    }

    updateRunState(requestId, { isRunning: false });

    // Confetti on success
    if (localFail === 0 && localSuccess > 0) {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
      });
    }
  };

  const handleStopSeeder = () => {
    if (!activeRequestId) return;
    abortFlags.current[activeRequestId] = true;
    updateRunState(activeRequestId, { isRunning: false });
  };

  const generatedCode = useMemo(() => {
    if (!activeReq) return { curl: "", fetch: "", axios: "", python: "", java: "", go: "", rust: "" };
    const prepared = prepareRequest(activeReq, activeEnv, globalsEnv, activeCollection?.variables);

    // cURL
    let curl = `curl -X ${prepared.method} "${prepared.url}"`;
    Object.entries(prepared.headers).forEach(([k, v]) => {
      curl += ` \\\n  -H "${k}: ${v}"`;
    });
    if (prepared.data) {
      const dataStr = typeof prepared.data === "object" ? JSON.stringify(prepared.data) : String(prepared.data);
      curl += ` \\\n  -d '${dataStr.replace(/'/g, "'\\''")}'`;
    }

    // Fetch
    const fetchHeaders: Record<string, string> = { ...prepared.headers };
    if (prepared.contentType && prepared.method !== "GET" && prepared.method !== "HEAD") {
      fetchHeaders["Content-Type"] = prepared.contentType;
    }
    const fetchOpts = {
      method: prepared.method,
      headers: fetchHeaders,
      body: prepared.method !== "GET" && prepared.data
        ? (typeof prepared.data === "object" ? JSON.stringify(prepared.data, null, 2) : prepared.data)
        : undefined,
    };
    const fetchStr = `fetch("${prepared.url}", ${JSON.stringify(fetchOpts, null, 2)});`;

    // Axios
    const axiosOpts = {
      method: prepared.method.toLowerCase(),
      url: prepared.url,
      headers: prepared.headers,
      data: prepared.method !== "GET" ? prepared.data : undefined,
    };
    const axiosStr = `import axios from 'axios';\n\naxios(${JSON.stringify(axiosOpts, null, 2)});`;

    // Python
    let py = `import requests\nimport json\n\nurl = "${prepared.url}"\n`;
    if (Object.keys(prepared.headers).length > 0) {
      py += `headers = ${JSON.stringify(prepared.headers, null, 2)}\n`;
    } else {
      py += `headers = {}\n`;
    }
    if (prepared.data && prepared.method !== "GET") {
      py += `payload = ${JSON.stringify(prepared.data, null, 2)}\n`;
      py += `response = requests.request("${prepared.method}", url, headers=headers, json=payload)\n`;
    } else {
      py += `response = requests.request("${prepared.method}", url, headers=headers)\n`;
    }
    py += `print("Status:", response.status_code)\nprint(response.json())`;

    // Java
    let javaBody = "HttpRequest.BodyPublishers.noBody()";
    if (prepared.data && prepared.method !== "GET" && prepared.method !== "HEAD") {
      const bodyStr = typeof prepared.data === "object" ? JSON.stringify(prepared.data) : String(prepared.data);
      javaBody = `HttpRequest.BodyPublishers.ofString("${bodyStr.replace(/"/g, "\\\"").replace(/\n/g, "\\n")}")`;
    }
    let java = `import java.net.URI;\nimport java.net.http.HttpClient;\nimport java.net.http.HttpRequest;\nimport java.net.http.HttpResponse;\n\n`;
    java += `HttpClient client = HttpClient.newHttpClient();\n`;
    java += `HttpRequest request = HttpRequest.newBuilder()\n`;
    java += `    .uri(URI.create("${prepared.url}"))\n`;
    java += `    .method("${prepared.method}", ${javaBody})\n`;
    Object.entries(prepared.headers).forEach(([k, v]) => {
      java += `    .header("${k}", "${v}")\n`;
    });
    if (prepared.contentType && prepared.method !== "GET" && prepared.method !== "HEAD" && !prepared.headers["Content-Type"]) {
      java += `    .header("Content-Type", "${prepared.contentType}")\n`;
    }
    java += `    .build();\n\n`;
    java += `HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());\n`;
    java += `System.out.println("Status: " + response.statusCode());\n`;
    java += `System.out.println(response.body());`;

    // Go
    let goBody = "nil";
    if (prepared.data && prepared.method !== "GET" && prepared.method !== "HEAD") {
      const bodyStr = typeof prepared.data === "object" ? JSON.stringify(prepared.data) : String(prepared.data);
      goBody = `strings.NewReader(\`${bodyStr}\`)`;
    }
    let go = `package main\n\nimport (\n    "fmt"\n    "io"\n    "net/http"\n`;
    if (goBody !== "nil") {
      go += `    "strings"\n`;
    }
    go += `)\n\nfunc main() {\n`;
    go += `    url := "${prepared.url}"\n`;
    go += `    method := "${prepared.method}"\n`;
    if (goBody !== "nil") {
      go += `    payload := ${goBody}\n`;
    }
    go += `    req, err := http.NewRequest(method, url, ${goBody !== "nil" ? "payload" : "nil"})\n`;
    go += `    if err != nil {\n        fmt.Println(err)\n        return\n    }\n`;
    Object.entries(prepared.headers).forEach(([k, v]) => {
      go += `    req.Header.Add("${k}", "${v}")\n`;
    });
    if (prepared.contentType && prepared.method !== "GET" && prepared.method !== "HEAD" && !prepared.headers["Content-Type"]) {
      go += `    req.Header.Add("Content-Type", "${prepared.contentType}")\n`;
    }
    go += `\n    res, err := http.DefaultClient.Do(req)\n`;
    go += `    if err != nil {\n        fmt.Println(err)\n        return\n    }\n`;
    go += `    defer res.Body.Close()\n`;
    go += `    body, _ := io.ReadAll(res.Body)\n\n`;
    go += `    fmt.Println("Status:", res.StatusCode)\n`;
    go += `    fmt.Println(string(body))\n}`;

    // Rust
    let rust = `use reqwest::header::{HeaderMap, HeaderValue};\n\n`;
    rust += `#[tokio::main]\nasync fn main() -> Result<(), Box<dyn std::error::Error>> {\n`;
    rust += `    let client = reqwest::Client::new();\n`;
    rust += `    let mut headers = HeaderMap::new();\n`;
    Object.entries(prepared.headers).forEach(([k, v]) => {
      rust += `    headers.insert("${k}", HeaderValue::from_static("${v}"));\n`;
    });
    if (prepared.contentType && prepared.method !== "GET" && prepared.method !== "HEAD" && !prepared.headers["Content-Type"]) {
      rust += `    headers.insert("Content-Type", HeaderValue::from_static("${prepared.contentType}"));\n`;
    }
    rust += `\n    let response = client.request(reqwest::Method::${prepared.method.toUpperCase()}, "${prepared.url}")\n`;
    rust += `        .headers(headers)\n`;
    if (prepared.data && prepared.method !== "GET" && prepared.method !== "HEAD") {
      const bodyStr = typeof prepared.data === "object" ? JSON.stringify(prepared.data) : String(prepared.data);
      rust += `        .body(r#"${bodyStr}"#)\n`;
    }
    rust += `        .send()\n        .await?;\n\n`;
    rust += `    println!("Status: {}", response.status());\n`;
    rust += `    println!("{}", response.text().await?);\n`;
    rust += `    Ok(())\n}`;

    return { curl, fetch: fetchStr, axios: axiosStr, python: py, java, go, rust };
  }, [activeReq, activeEnv, globalsEnv, activeCollection]);

  const activeMethod = activeReq?.method || "GET";
  const mTheme = METHOD_THEMES[activeMethod] || METHOD_THEMES.GET;

  if (!activeReq) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-slate-500 dark:text-slate-650 h-full">
        <FiDatabase className="w-12 h-12 opacity-20 mb-4 float-icon" />
        <p className="text-base font-bold">No Request Selected</p>
        <p className="text-xs text-center max-w-[280px] mt-1 leading-relaxed">
          Create or select a request from the sidebar collection to begin building your tests.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col lg:flex-row h-full overflow-hidden min-h-0">

      {/* ── PANEL: REQUEST BUILDER (50%) ── */}
      <div className="w-full lg:w-1/2 h-full flex flex-col border-r border-slate-500/10 dark:border-white/[0.06] overflow-hidden min-h-0 bg-slate-500/[0.005] dark:bg-[#07080f]/40 p-4">

        {/* Editable Title */}
        <div className="flex items-center gap-3 mb-3 shrink-0">
          <Input
            value={activeReq.name}
            variant="borderless"
            onChange={(e) => handleUpdate({ name: e.target.value })}
            className="text-base font-bold text-slate-900 dark:text-white hover:bg-slate-500/5 dark:hover:bg-white/5 rounded-lg px-2 py-1 flex-1 font-sans"
            placeholder="Untitled Request"
          />
          {activeEnvironmentId && (
            <span className="text-[10px] shrink-0 font-bold bg-emerald-500/10 border border-emerald-500/25 text-emerald-600 dark:text-emerald-450 px-2 py-0.5 rounded-full uppercase">
              {activeEnv?.name}
            </span>
          )}
        </div>

        {/* Method & URL Input Bar */}
        <div className="flex gap-2 mb-4 shrink-0">
          <ConfigProvider
            theme={{
              components: {
                Select: {
                  colorBgContainer: mTheme.bg,
                  colorBorder: mTheme.border,
                  colorText: mTheme.text,
                  colorIcon: mTheme.text,
                  colorPrimary: mTheme.border,
                  colorPrimaryHover: mTheme.border,
                  controlOutline: "transparent",
                },
              },
            }}
          >
            <Select
              className="shrink-0 font-extrabold text-xs"
              style={{ width: 105 }}
              popupMatchSelectWidth={false}
              value={activeMethod}
              onChange={(v) => handleUpdate({ method: v })}
              options={HTTP_METHODS.map((m) => ({
                label: (
                  <span
                    style={{ color: METHOD_THEMES[m]?.text, fontWeight: 900 }}
                    className="text-xs tracking-wider"
                  >
                    {m}
                  </span>
                ),
                value: m,
              }))}
            />
          </ConfigProvider>

          <Input
            value={activeReq.baseUrl}
            onChange={(e) => handleUpdate({ baseUrl: e.target.value })}
            placeholder="https://api.example.com"
            className="flex-1 font-mono text-xs dark:text-white"
          />
        </div>

        <div className="flex gap-2 mb-4 shrink-0">
          <span className="text-slate-500 font-mono select-none py-1.5 pl-3">/</span>
          <Input
            value={activeReq.endpoint}
            onChange={(e) => handleUpdate({ endpoint: e.target.value })}
            placeholder="posts/1"
            className="flex-1 font-mono text-xs dark:text-white"
          />
        </div>

        {/* Workspace Config Tabs */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0 border border-slate-500/10 dark:border-white/[0.06] rounded-2xl bg-white/40 dark:bg-white/[0.005] overflow-hidden">
          <Tabs
            defaultActiveKey="params"
            size="small"
            centered
            className="h-full flex flex-col overflow-hidden min-h-0"
            tabBarStyle={{ marginBottom: 0 }}
            items={[
              {
                key: "params",
                label: (
                  <span className="flex items-center gap-1.5">
                    Params
                    {activeReq.params?.some((p) => p.enabled && p.key) && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                    )}
                  </span>
                ),
                children: (
                  <div className="p-4 h-full overflow-y-auto">
                    <p className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase mb-3 tracking-wider">
                      Query Parameters
                    </p>
                    <KeyValueTable
                      value={activeReq.params || []}
                      onChange={(vars) => handleUpdate({ params: vars })}
                    />
                  </div>
                ),
              },
              {
                key: "headers",
                label: (
                  <span className="flex items-center gap-1.5">
                    Headers
                    {activeReq.headers?.some((h) => h.enabled && h.key) && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                    )}
                  </span>
                ),
                children: (
                  <div className="p-4 h-full overflow-y-auto">
                    <p className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase mb-3 tracking-wider">
                      Request Headers
                    </p>
                    <KeyValueTable
                      value={activeReq.headers || []}
                      onChange={(vars) => handleUpdate({ headers: vars })}
                    />
                  </div>
                ),
              },
              {
                key: "auth",
                label: (
                  <span className="flex items-center gap-1.5">
                    Auth
                    {activeReq.auth?.type !== "none" && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                    )}
                  </span>
                ),
                children: (
                  <div className="p-4 h-full overflow-y-auto space-y-4">
                    <div>
                      <p className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase mb-2 tracking-wider">
                        Auth Type
                      </p>
                      <Select
                        className="w-full"
                        value={activeReq.auth?.type || "none"}
                        onChange={(val) =>
                          handleUpdate({
                            auth: { ...activeReq.auth, type: val as AuthType },
                          })
                        }
                        options={[
                          { label: "No Auth", value: "none" },
                          { label: "Bearer Token", value: "bearer" },
                          { label: "Basic Auth", value: "basic" },
                          { label: "API Key", value: "apikey" },
                          { label: "OAuth 2.0", value: "oauth2" },
                        ]}
                      />
                    </div>

                    {/* Bearer */}
                    {activeReq.auth?.type === "bearer" && (
                      <div>
                        <p className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase mb-1 tracking-wider">
                          Bearer Token
                        </p>
                        <Input.Password
                          value={activeReq.auth.bearerToken || ""}
                          placeholder="Token"
                          onChange={(e) =>
                            handleUpdate({
                              auth: { ...activeReq.auth, bearerToken: e.target.value },
                            })
                          }
                          className="font-mono text-xs"
                        />
                      </div>
                    )}

                    {/* Basic */}
                    {activeReq.auth?.type === "basic" && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase mb-1 tracking-wider">
                            Username
                          </p>
                          <Input
                            value={activeReq.auth.basicUser || ""}
                            placeholder="Username"
                            onChange={(e) =>
                              handleUpdate({
                                auth: { ...activeReq.auth, basicUser: e.target.value },
                              })
                            }
                            className="text-xs"
                          />
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase mb-1 tracking-wider">
                            Password
                          </p>
                          <Input.Password
                            value={activeReq.auth.basicPass || ""}
                            placeholder="Password"
                            onChange={(e) =>
                              handleUpdate({
                                auth: { ...activeReq.auth, basicPass: e.target.value },
                              })
                            }
                            className="text-xs"
                          />
                        </div>
                      </div>
                    )}

                    {/* API Key */}
                    {activeReq.auth?.type === "apikey" && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase mb-1 tracking-wider">
                              Key
                            </p>
                            <Input
                              value={activeReq.auth.apiKeyName || ""}
                              placeholder="Key Name"
                              onChange={(e) =>
                                handleUpdate({
                                  auth: { ...activeReq.auth, apiKeyName: e.target.value },
                                })
                              }
                              className="font-mono text-xs"
                            />
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase mb-1 tracking-wider">
                              Value
                            </p>
                            <Input.Password
                              value={activeReq.auth.apiKeyValue || ""}
                              placeholder="Value"
                              onChange={(e) =>
                                handleUpdate({
                                  auth: { ...activeReq.auth, apiKeyValue: e.target.value },
                                })
                              }
                              className="font-mono text-xs"
                            />
                          </div>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase mb-1 tracking-wider">
                            Add to
                          </p>
                          <Select
                            className="w-full"
                            value={activeReq.auth.apiKeyLocation || "header"}
                            onChange={(val) =>
                              handleUpdate({
                                auth: { ...activeReq.auth, apiKeyLocation: val as "header" | "query" },
                              })
                            }
                            options={[
                              { label: "Header", value: "header" },
                              { label: "Query Params", value: "query" },
                            ]}
                          />
                        </div>
                      </div>
                    )}

                    {/* OAuth 2.0 */}
                    {activeReq.auth?.type === "oauth2" && activeReq.auth.oauth2 && (
                      <div className="space-y-3">
                        <div>
                          <p className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase mb-1 tracking-wider">
                            Grant Type
                          </p>
                          <Select
                            className="w-full"
                            value={activeReq.auth.oauth2.grantType}
                            onChange={(val) =>
                              handleUpdate({
                                auth: { ...activeReq.auth, oauth2: { ...activeReq.auth.oauth2, grantType: val as "client_credentials" | "authorization_code" } },
                              })
                            }
                            options={[
                              { label: "Client Credentials", value: "client_credentials" },
                              { label: "Authorization Code", value: "authorization_code" },
                            ]}
                          />
                        </div>

                        <div>
                          <p className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase mb-1 tracking-wider">
                            Access Token URL
                          </p>
                          <Input
                            value={activeReq.auth.oauth2.accessTokenUrl}
                            placeholder="https://auth.example.com/oauth/token"
                            onChange={(e) =>
                              handleUpdate({ auth: { ...activeReq.auth, oauth2: { ...activeReq.auth.oauth2, accessTokenUrl: e.target.value } } })
                            }
                            className="font-mono text-xs"
                          />
                        </div>

                        {activeReq.auth.oauth2.grantType === "authorization_code" && (
                          <>
                            <div>
                              <p className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase mb-1 tracking-wider">
                                Authorization URL
                              </p>
                              <Input
                                value={activeReq.auth.oauth2.authorizationUrl}
                                placeholder="https://auth.example.com/oauth/authorize"
                                onChange={(e) =>
                                  handleUpdate({ auth: { ...activeReq.auth, oauth2: { ...activeReq.auth.oauth2, authorizationUrl: e.target.value } } })
                                }
                                className="font-mono text-xs"
                              />
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase mb-1 tracking-wider">
                                Redirect URI
                              </p>
                              <Input
                                value={activeReq.auth.oauth2.redirectUri}
                                placeholder={typeof window !== "undefined" ? `${window.location.origin}/oauth/callback` : "/oauth/callback"}
                                onChange={(e) =>
                                  handleUpdate({ auth: { ...activeReq.auth, oauth2: { ...activeReq.auth.oauth2, redirectUri: e.target.value } } })
                                }
                                className="font-mono text-xs"
                              />
                            </div>
                            <div className="flex items-center justify-between">
                              <p className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase tracking-wider">
                                Use PKCE
                              </p>
                              <Checkbox
                                checked={activeReq.auth.oauth2.usePkce}
                                onChange={(e) =>
                                  handleUpdate({ auth: { ...activeReq.auth, oauth2: { ...activeReq.auth.oauth2, usePkce: e.target.checked } } })
                                }
                              />
                            </div>
                          </>
                        )}

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase mb-1 tracking-wider">
                              Client ID
                            </p>
                            <Input
                              value={activeReq.auth.oauth2.clientId}
                              placeholder="Client ID"
                              onChange={(e) =>
                                handleUpdate({ auth: { ...activeReq.auth, oauth2: { ...activeReq.auth.oauth2, clientId: e.target.value } } })
                              }
                              className="font-mono text-xs"
                            />
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase mb-1 tracking-wider">
                              Client Secret
                            </p>
                            <Input.Password
                              value={activeReq.auth.oauth2.clientSecret}
                              placeholder="Client Secret"
                              onChange={(e) =>
                                handleUpdate({ auth: { ...activeReq.auth, oauth2: { ...activeReq.auth.oauth2, clientSecret: e.target.value } } })
                              }
                              className="font-mono text-xs"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase mb-1 tracking-wider">
                              Scope
                            </p>
                            <Input
                              value={activeReq.auth.oauth2.scope}
                              placeholder="read write"
                              onChange={(e) =>
                                handleUpdate({ auth: { ...activeReq.auth, oauth2: { ...activeReq.auth.oauth2, scope: e.target.value } } })
                              }
                              className="font-mono text-xs"
                            />
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase mb-1 tracking-wider">
                              Audience
                            </p>
                            <Input
                              value={activeReq.auth.oauth2.audience}
                              placeholder="(optional)"
                              onChange={(e) =>
                                handleUpdate({ auth: { ...activeReq.auth, oauth2: { ...activeReq.auth.oauth2, audience: e.target.value } } })
                              }
                              className="font-mono text-xs"
                            />
                          </div>
                        </div>

                        <Button
                          type="primary"
                          loading={oauth2Loading}
                          onClick={handleGetOAuth2Token}
                          className="w-full font-bold"
                        >
                          Get New Access Token
                        </Button>

                        {activeReq.auth.oauth2.accessToken && (
                          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 space-y-0.5">
                            <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                              Current Token
                            </p>
                            <p className="font-mono text-[11px] text-slate-600 dark:text-slate-300 truncate">
                              {activeReq.auth.oauth2.accessToken.slice(0, 24)}…
                            </p>
                            <p className="text-[10px] text-slate-500">
                              {activeReq.auth.oauth2.expiresAt
                                ? `Expires ${new Date(activeReq.auth.oauth2.expiresAt).toLocaleTimeString()}`
                                : "No expiry reported"}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: "body",
                label: (
                  <span className="flex items-center gap-1.5">
                    Body
                    {activeReq.body?.type !== "none" && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                    )}
                  </span>
                ),
                children: (
                  <div className="p-4 h-full overflow-y-auto space-y-3">
                    <div className="flex items-center justify-between">
                      <Select
                        value={activeReq.body?.type || "none"}
                        onChange={(val) => {
                          const type = val as BodyType;
                          const ctByType: Partial<Record<BodyType, string>> = {
                            json: "application/json",
                            graphql: "application/json",
                            formdata: "multipart/form-data",
                            urlencoded: "application/x-www-form-urlencoded",
                          };
                          handleUpdate({
                            body: { ...activeReq.body, type },
                            contentType: ctByType[type] ?? activeReq.contentType,
                          });
                        }}
                        options={[
                          { label: "None", value: "none" },
                          { label: "JSON", value: "json" },
                          { label: "Form Data", value: "formdata" },
                          { label: "URL Encoded", value: "urlencoded" },
                          { label: "GraphQL", value: "graphql" },
                          { label: "Raw (Text)", value: "raw" },
                        ]}
                        className="w-40"
                      />

                      {(activeReq.body?.type === "json" || activeReq.body?.type === "graphql") && (
                        <span className="text-[10px] text-slate-500 font-semibold uppercase">
                          Content-Type: application/json
                        </span>
                      )}
                    </div>

                    {/* Raw Text Areas */}
                    {(activeReq.body?.type === "json" || activeReq.body?.type === "raw") && (
                      <Input.TextArea
                        value={activeReq.body.rawText || ""}
                        onChange={(e) =>
                          handleUpdate({
                            body: { ...activeReq.body, rawText: e.target.value },
                          })
                        }
                        placeholder={activeReq.body.type === "json" ? '{\n  "key": "value"\n}' : "Raw request body"}
                        autoSize={{ minRows: 6, maxRows: 12 }}
                        className="font-mono text-xs"
                      />
                    )}

                    {/* GraphQL */}
                    {activeReq.body?.type === "graphql" && (
                      <div className="space-y-3">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Query</p>
                          <Input.TextArea
                            value={activeReq.body.graphql?.query || ""}
                            onChange={(e) =>
                              handleUpdate({
                                body: { ...activeReq.body, graphql: { ...activeReq.body.graphql, query: e.target.value } },
                              })
                            }
                            placeholder={"query GetUser($id: ID!) {\n  user(id: $id) {\n    name\n  }\n}"}
                            autoSize={{ minRows: 8, maxRows: 16 }}
                            className="font-mono text-xs"
                          />
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Variables (JSON)</p>
                          <Input.TextArea
                            value={activeReq.body.graphql?.variables || ""}
                            onChange={(e) =>
                              handleUpdate({
                                body: { ...activeReq.body, graphql: { ...activeReq.body.graphql, variables: e.target.value } },
                              })
                            }
                            placeholder={'{\n  "id": "1"\n}'}
                            autoSize={{ minRows: 4, maxRows: 8 }}
                            className="font-mono text-xs"
                          />
                        </div>
                      </div>
                    )}

                    {/* Form Data */}
                    {activeReq.body?.type === "formdata" && (
                      <KeyValueTable
                        value={activeReq.body.formdata || []}
                        onChange={(vars) =>
                          handleUpdate({
                            body: { ...activeReq.body, formdata: vars },
                          })
                        }
                        showDescription={false}
                        allowFileRows
                      />
                    )}

                    {/* URL Encoded */}
                    {activeReq.body?.type === "urlencoded" && (
                      <KeyValueTable
                        value={activeReq.body.urlencoded || []}
                        onChange={(vars) =>
                          handleUpdate({
                            body: { ...activeReq.body, urlencoded: vars },
                          })
                        }
                        showDescription={false}
                      />
                    )}
                  </div>
                ),
              },
              {
                key: "tests",
                label: (
                  <span className="flex items-center gap-1.5">
                    Tests
                    {activeReq.assertions?.length > 0 && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                    )}
                  </span>
                ),
                children: (
                  <div className="p-4 h-full overflow-y-auto space-y-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase tracking-wider">
                        Visual Assertion Rules
                      </p>
                      <Button
                        type="dashed"
                        size="small"
                        icon={<FiPlus />}
                        onClick={handleAddAssertion}
                        className="text-xs"
                      >
                        Add Test
                      </Button>
                    </div>

                    {/* Assertions Editor List */}
                    {(!activeReq.assertions || activeReq.assertions.length === 0) ? (
                      <div className="text-center py-8 border border-dashed border-slate-500/10 dark:border-white/[0.06] rounded-xl text-slate-550 text-xs">
                        No test assertions configured. Tests check response validity automatically on completion.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {activeReq.assertions.map((assert) => (
                          <div
                            key={assert.id}
                            className="flex items-center gap-2 bg-slate-500/5 dark:bg-white/[0.02] border border-slate-500/10 dark:border-white/[0.05] p-2.5 rounded-xl flex-wrap"
                          >
                            {/* Target Select */}
                            <Select
                              value={assert.target}
                              size="small"
                              onChange={(v) => handleUpdateAssertion(assert.id, { target: v as AssertionTarget })}
                              options={[
                                { label: "Status Code", value: "status_code" },
                                { label: "Response Time", value: "response_time" },
                                { label: "Content-Type", value: "content_type" },
                                { label: "JSON Path", value: "json_path" },
                                { label: "Body Text", value: "body_text" },
                                { label: "Header", value: "header" },
                              ]}
                              className="w-32"
                            />

                            {/* Property Input for header or json_path */}
                            {(assert.target === "json_path" || assert.target === "header") && (
                              <Input
                                value={assert.property}
                                size="small"
                                placeholder={assert.target === "json_path" ? "$.id" : "Header-Name"}
                                onChange={(e) => handleUpdateAssertion(assert.id, { property: e.target.value })}
                                className="w-28 font-mono text-xs"
                              />
                            )}

                            {/* Operator Select */}
                            <Select
                              value={assert.operator}
                              size="small"
                              onChange={(v) => handleUpdateAssertion(assert.id, { operator: v as AssertionOperator })}
                              options={[
                                { label: "equals", value: "equals" },
                                { label: "does not equal", value: "not_equals" },
                                { label: "contains", value: "contains" },
                                { label: "does not contain", value: "not_contains" },
                                { label: "exists", value: "exists" },
                                { label: "less than", value: "less_than" },
                                { label: "greater than", value: "greater_than" },
                                { label: "matches regex", value: "matches_regex" },
                              ]}
                              className="w-32"
                            />

                            {/* Expected Value Input */}
                            {assert.operator !== "exists" && (
                              <AutoComplete
                                value={assert.value}
                                size="small"
                                placeholder="Expected value"
                                onChange={(v) => handleUpdateAssertion(assert.id, { value: v })}
                                className="flex-1 min-w-[80px]"
                                options={[
                                  { value: "true" },
                                  { value: "false" },
                                  { value: "null" },
                                  { value: "0" },
                                  { value: "1" },
                                  { value: "200" },
                                  { value: "201" },
                                  { value: "400" },
                                  { value: "401" },
                                  { value: "403" },
                                  { value: "404" },
                                  { value: "500" },
                                ].filter((o) => !assert.value || o.value.startsWith(assert.value))}
                              />
                            )}

                            {/* Delete */}
                            <Button
                              type="text"
                              danger
                              size="small"
                              icon={<FiXCircle />}
                              onClick={() => handleDeleteAssertion(assert.id)}
                              className="hover:bg-rose-500/10 border-none flex items-center justify-center p-1.5"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: "security",
                label: (
                  <span className="flex items-center gap-1.5">
                    Security
                    {activeReq.security?.checklist?.some((c) => c.status !== "not_tested") && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                    )}
                  </span>
                ),
                children: (
                  <SecurityPanel
                    request={activeReq}
                    lastResponse={lastResponse}
                    onSend={fireSingleRequest}
                    onUpdateChecklist={(checklist) => handleUpdate({ security: { ...activeReq.security, checklist } })}
                    onUpdateAuthMatrixBaseline={(authMatrixBaseline) => handleUpdate({ security: { ...activeReq.security, authMatrixBaseline } })}
                    resultsDrawerOpen={securityResultsDrawerOpen}
                    onResultsDrawerOpenChange={setSecurityResultsDrawerOpen}
                  />
                ),
              },
              {
                key: "scripts",
                label: (
                  <span className="flex items-center gap-1.5">
                    Scripts
                    {(activeReq.preRequestScript?.trim() || activeReq.postResponseScript?.trim()) && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                    )}
                  </span>
                ),
                children: (
                  <div className="flex h-full overflow-hidden">
                    {/* ── Left: Editors + Console ── */}
                    <div className="flex-1 min-w-0 overflow-y-auto p-4 space-y-4">
                      {/* Pre-request Script */}
                      <div
                        className={`rounded-xl p-0.5 transition-all duration-200 ${focusedScript === "pre" ? "ring-2 ring-amber-400/60 bg-amber-400/5" : "ring-1 ring-slate-500/10 dark:ring-white/[0.06]"}`}
                        onClick={() => setFocusedScript("pre")}
                      >
                        <div className="flex items-center justify-between px-2 pt-2 pb-1.5">
                          <p className={`text-[10px] font-bold uppercase tracking-wider transition-colors ${focusedScript === "pre" ? "text-amber-400" : "text-slate-500 dark:text-slate-450"}`}>
                            Pre-request Script (JavaScript)
                          </p>
                          <span className="text-[9px] text-slate-400 font-medium">Runs before template resolution</span>
                        </div>
                        <Input.TextArea
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          ref={preScriptRef as any}
                          value={activeReq.preRequestScript || ""}
                          onFocus={() => setFocusedScript("pre")}
                          onChange={(e) => handleUpdate({ preRequestScript: e.target.value })}
                          placeholder={`// Pre-request Script\n// Example: be.environment.set("timestamp", Date.now().toString());`}
                          autoSize={{ minRows: 5, maxRows: 10 }}
                          className="font-mono text-xs dark:bg-[#0c0d16] dark:border-white/10 dark:text-emerald-400 !border-0 !shadow-none !rounded-t-none"
                        />
                      </div>

                      {/* Post-response Script */}
                      <div
                        className={`rounded-xl p-0.5 transition-all duration-200 ${focusedScript === "post" ? "ring-2 ring-sky-400/60 bg-sky-400/5" : "ring-1 ring-slate-500/10 dark:ring-white/[0.06]"}`}
                        onClick={() => setFocusedScript("post")}
                      >
                        <div className="flex items-center justify-between px-2 pt-2 pb-1.5">
                          <p className={`text-[10px] font-bold uppercase tracking-wider transition-colors ${focusedScript === "post" ? "text-sky-400" : "text-slate-500 dark:text-slate-450"}`}>
                            Post-response Script / Tests (JavaScript)
                          </p>
                          <span className="text-[9px] text-slate-400 font-medium">Runs after response is received</span>
                        </div>
                        <Input.TextArea
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          ref={postScriptRef as any}
                          value={activeReq.postResponseScript || ""}
                          onFocus={() => setFocusedScript("post")}
                          onChange={(e) => handleUpdate({ postResponseScript: e.target.value })}
                          placeholder={`// Post-response Script / Tests\n// Example:\n// be.test("Status is 200", () => {\n//   be.response.to.have.status(200);\n// });`}
                          autoSize={{ minRows: 5, maxRows: 10 }}
                          className="font-mono text-xs dark:bg-[#0c0d16] dark:border-white/10 dark:text-emerald-400 !border-0 !shadow-none !rounded-t-none"
                        />
                      </div>
                    </div>

                    {/* ── Right: Snippets Panel ── */}
                    {(() => {
                      const currentFocusedScript = focusedScript === "pre" ? (activeReq.preRequestScript || "") : (activeReq.postResponseScript || "");
                      return (
                    <div className="w-52 shrink-0 border-l border-slate-500/10 dark:border-white/[0.07] flex flex-col overflow-hidden bg-slate-500/[0.015] dark:bg-white/[0.008]">
                      {/* Panel header */}
                      <div className="px-3 py-3 border-b border-slate-500/10 dark:border-white/[0.06] shrink-0 space-y-2">
                        <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                          <FiCode className="w-3 h-3 text-indigo-500" /> Snippets
                        </p>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => setFocusedScript("pre")}
                            className={`flex-1 text-[9px] font-bold px-2 py-1 rounded-lg border transition-all cursor-pointer ${focusedScript === "pre"
                              ? "bg-amber-500/15 border-amber-500/40 text-amber-400"
                              : "bg-transparent border-slate-500/15 dark:border-white/[0.07] text-slate-500 hover:border-amber-500/30 hover:text-amber-400"}`}
                          >
                            Pre-request
                          </button>
                          <button
                            type="button"
                            onClick={() => setFocusedScript("post")}
                            className={`flex-1 text-[9px] font-bold px-2 py-1 rounded-lg border transition-all cursor-pointer ${focusedScript === "post"
                              ? "bg-sky-500/15 border-sky-500/40 text-sky-400"
                              : "bg-transparent border-slate-500/15 dark:border-white/[0.07] text-slate-500 hover:border-sky-500/30 hover:text-sky-400"}`}
                          >
                            Post-response
                          </button>
                        </div>
                      </div>

                      {/* Snippet list */}
                      <div className="flex-1 overflow-y-auto py-2 space-y-0.5">
                        {SCRIPT_SNIPPETS.map((group, gi) => (
                          <div key={group.category}>
                            {gi > 0 && (
                              <div className="mx-3 my-2.5 border-t border-slate-500/10 dark:border-white/[0.06]" />
                            )}
                            {/* Category badge */}
                            <div className="px-3 pb-1.5 pt-1">
                              <span className="inline-flex items-center gap-1 px-2 py-[3px] rounded-md text-[9px] font-black uppercase tracking-widest bg-indigo-500/10 dark:bg-indigo-500/15 border border-indigo-500/20 dark:border-indigo-500/25 text-indigo-600 dark:text-indigo-400">
                                {group.category}
                              </span>
                            </div>
                            {/* Snippet items — highlighted while their code is present in the
                                focused script; clicking again removes it (toggle, not just insert). */}
                            {group.items.map((snippet) => {
                              const isActive = currentFocusedScript.includes(snippet.code.trim());
                              return (
                                <button
                                  key={snippet.label}
                                  type="button"
                                  onClick={() => insertSnippet(snippet.code)}
                                  className={`w-full text-left flex items-center gap-2 px-3 py-[7px] border-l-2 text-[11.5px] font-medium transition-all cursor-pointer ${isActive
                                    ? "border-l-indigo-500 bg-indigo-500/10 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400"
                                    : "border-l-transparent text-slate-600 dark:text-slate-300 hover:border-l-indigo-400/50 hover:bg-slate-500/[0.04] dark:hover:bg-white/[0.025] hover:text-slate-900 dark:hover:text-white"
                                    }`}
                                >
                                  <span className={`text-[10px] leading-none shrink-0 ${isActive ? "text-indigo-500" : "text-slate-400 dark:text-slate-500"}`}>›</span>
                                  {snippet.label}
                                </button>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                      );
                    })()}
                  </div>
                ),
              },
              {
                key: "seed",
                label: (
                  <span className="flex items-center gap-1.5">
                    Runner Config
                    {(activeReq.seedMode === "items" || activeReq.repeatCount > 1) && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                    )}
                  </span>
                ),
                children: (
                  <div className="p-4 h-full overflow-y-auto space-y-4">
                    {/* Seeder Mode */}
                    <div>
                      <p className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase mb-2 tracking-wider">
                        Seeding Mode
                      </p>
                      <div className="flex bg-slate-500/5 dark:bg-white/[0.03] border border-slate-500/10 dark:border-white/[0.07] rounded-xl p-1 gap-1">
                        <button
                          type="button"
                          onClick={() => handleUpdate({ seedMode: "repeat" })}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${activeReq.seedMode === "repeat"
                            ? "bg-indigo-600 text-white shadow"
                            : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                            }`}
                        >
                          Repeat Request
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUpdate({ seedMode: "items" })}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${activeReq.seedMode === "items"
                            ? "bg-indigo-600 text-white shadow"
                            : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                            }`}
                        >
                          Multiple Items Payload
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      {activeReq.seedMode === "repeat" && (
                        <div>
                          <p className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase mb-1 tracking-wider">
                            Repeat Count
                          </p>
                          <InputNumber
                            min={1}
                            max={10000}
                            value={activeReq.repeatCount}
                            onChange={(v) => handleUpdate({ repeatCount: v || 1 })}
                            className="w-full"
                          />
                        </div>
                      )}
                      <div>
                        <p className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase mb-1 tracking-wider">
                          Delay (ms)
                        </p>
                        <InputNumber
                          min={0}
                          max={10000}
                          step={50}
                          value={activeReq.delay}
                          onChange={(v) => handleUpdate({ delay: v || 0 })}
                          className="w-full"
                        />
                      </div>
                    </div>

                    {activeReq.seedMode === "items" && (
                      <div>
                        <p className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase mb-1.5 tracking-wider">
                          Items JSON Array Payload
                        </p>
                        <Input.TextArea
                          value={activeReq.jsonItems || "[]"}
                          onChange={(e) => handleUpdate({ jsonItems: e.target.value })}
                          placeholder={'[\n  { "id": 1, "name": "Item 1" },\n  { "id": 2, "name": "Item 2" }\n]'}
                          autoSize={{ minRows: 6, maxRows: 12 }}
                          className="font-mono text-xs"
                        />
                      </div>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </div>

        {/* Trigger Execute Buttons */}
        <div className="mt-4 flex gap-2 shrink-0 w-full md:max-w-xl mx-auto">
          {isRunning ? (
            <Button
              danger
              onClick={handleStopSeeder}
              className="flex-1 h-11 font-bold flex items-center justify-center gap-2"
            >
              Terminate Request
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<FaPlay />}
              onClick={handleRunRequest}
              className="flex-1 h-11 font-bold flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-500 to-indigo-600 border-none shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/35 hover:from-indigo-400 hover:to-indigo-500"
            >
              {activeReq.seedMode === "repeat"
                ? `Execute × ${activeReq.repeatCount}`
                : `Executes`}
            </Button>
          )}
        </div>

      </div>

      {/* ── PANEL 3: RESPONSE PANEL ── */}
      <div className="w-full lg:w-1/2 h-full flex flex-col overflow-hidden min-h-0 bg-slate-500/5 dark:bg-white/[0.002] p-4">

        {/* Seeder live status indicator */}
        {isRunning && (
          <div className="mb-4 bg-indigo-500/5 border border-indigo-500/20 rounded-2xl p-4 shrink-0 flex items-center gap-4">
            <div className="relative">
              <div className="absolute inset-0 bg-indigo-500/20 rounded-full blur-md scale-150 animate-ping" />
              <FiLoader className="w-6 h-6 text-indigo-500 animate-spin relative z-10" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-350">
                <span>Sending Requests...</span>
                <span>{seederProgress.sent} / {seederProgress.total}</span>
              </div>
              <Progress
                percent={Math.round((seederProgress.sent / seederProgress.total) * 100)}
                size="small"
                showInfo={false}
                strokeColor="#6366f1"
                trailColor="rgba(255,255,255,0.05)"
                className="mt-1.5"
              />
              <div className="flex gap-4 mt-1 text-[10px] text-slate-550">
                <span className="text-emerald-500 font-semibold">{seederProgress.succeeded} Passed</span>
                <span className="text-rose-500 font-semibold">{seederProgress.failed} Failed</span>
              </div>
            </div>
          </div>
        )}

        {/* Response Metrics Header */}
        {lastResponse && (
          <div className="bg-slate-500/5 dark:bg-white/[0.02] border border-slate-500/10 dark:border-white/[0.06] rounded-2xl p-4 mb-4 shrink-0 flex items-center justify-between gap-3">
            <div className="flex items-center gap-4 flex-wrap">
              <div>
                <span className="text-[10px] font-bold text-slate-550 dark:text-slate-500 uppercase tracking-wider block">
                  Status Code
                </span>
                <span className={`text-base font-black px-2 py-0.5 rounded-lg mt-0.5 inline-block ${lastResponse.status < 300 ? "text-emerald-500 bg-emerald-500/10" : "text-rose-500 bg-rose-500/10"
                  }`}>
                  {lastResponse.status} {lastResponse.statusText}
                </span>
              </div>

              <div className="w-px h-8 bg-slate-500/10 dark:bg-white/[0.05]" />

              <div>
                <span className="text-[10px] font-bold text-slate-550 dark:text-slate-500 uppercase tracking-wider block">
                  Response Time
                </span>
                <span className="text-base font-black text-slate-900 dark:text-white mt-0.5 inline-block">
                  {lastResponse.responseTime} <span className="text-xs font-semibold text-slate-500">ms</span>
                </span>
              </div>

              <div className="w-px h-8 bg-slate-500/10 dark:bg-white/[0.05]" />

              <div>
                <span className="text-[10px] font-bold text-slate-550 dark:text-slate-500 uppercase tracking-wider block">
                  Tests Passed
                </span>
                <span className={`text-base font-black mt-0.5 inline-flex items-center gap-1.5 ${lastResponse.passed ? "text-emerald-500" : "text-rose-500"
                  }`}>
                  {lastResponse.passed ? <FiCheckCircle /> : <FiXCircle />}
                  {lastResponse.assertions.filter((a) => a.passed).length} / {lastResponse.assertions.length}
                </span>
              </div>
            </div>
            {activeReq.security?.checklist?.some((c) => c.status !== "not_tested") && (
              <Button
                size="small"
                icon={<FiActivity />}
                onClick={() => setSecurityResultsDrawerOpen(true)}
                className="text-xs font-semibold shrink-0"
              >
                View Results
              </Button>
            )}
          </div>
        )}

        {/* Response Tabs — always visible */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0 border border-slate-500/10 dark:border-white/[0.06] rounded-2xl bg-white/40 dark:bg-white/[0.003]">
          <Tabs
            activeKey={responseTab}
            onChange={(key) => setResponseTab(key as "body" | "headers" | "tests" | "codegen" | "console")}
            size="small"
            centered
            className="h-full flex flex-col overflow-hidden min-h-0"
            tabBarStyle={{ marginBottom: 0 }}
            items={[
              {
                key: "headers",
                label: "Headers",
                children: lastResponse ? (
                  <div className="p-4 h-full overflow-y-auto space-y-2">
                    <div className="border border-slate-500/10 dark:border-white/[0.05] rounded-xl overflow-hidden">
                      <table className="w-full text-xs text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-500/5 dark:bg-white/[0.02] border-b border-slate-500/10 dark:border-white/[0.05] text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase tracking-wider">
                            <th className="px-4 py-2">Header Name</th>
                            <th className="px-4 py-2">Value</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-500/5 dark:divide-white/[0.03]">
                          {Object.entries(lastResponse.headers).map(([k, v]) => (
                            <tr key={k} className="hover:bg-slate-500/[0.01] dark:hover:bg-white/[0.005]">
                              <td className="px-4 py-2 font-mono text-slate-600 dark:text-slate-400 font-bold">{k}</td>
                              <td className="px-4 py-2 font-mono text-slate-800 dark:text-slate-300 break-all">{v}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center p-8 text-slate-500">
                    <FiTerminal className="w-8 h-8 opacity-25 mb-3" />
                    <p className="text-xs font-semibold">No Response Yet</p>
                  </div>
                ),
              },
              {
                key: "body",
                label: "Body",
                children: lastResponse ? (
                  <div className="h-full relative group">
                    {/* Copy & Wrap Controls */}
                    <div className="absolute top-6 right-8 flex items-center gap-1.5 z-20">
                      <button
                        type="button"
                        onClick={handleCopyResponse}
                        className="flex items-center justify-center p-2 rounded-xl bg-slate-900/85 hover:bg-slate-950 text-slate-300 border border-slate-800 hover:text-white transition-all cursor-pointer shadow-lg backdrop-blur-md"
                        title={copied ? "Copied response" : "Copy response"}
                      >
                        {copied ? (
                          <FiCheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <FiCopy className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setWrapResponse(!wrapResponse)}
                        className={`flex items-center justify-center p-2 rounded-xl transition-all cursor-pointer shadow-lg backdrop-blur-md border ${wrapResponse
                          ? "bg-indigo-650/95 hover:bg-indigo-700 text-white border-indigo-500"
                          : "bg-slate-900/85 hover:bg-slate-950 text-slate-300 border-slate-800 hover:text-white"
                          }`}
                        title={wrapResponse ? "Disable line wrap" : "Enable line wrap"}
                      >
                        <FiAlignLeft className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Scrollable pre container */}
                    <div className="p-4 h-full overflow-y-auto">
                      <pre className={`text-xs font-mono text-slate-800 dark:text-indigo-200 bg-slate-950/95 p-4 rounded-xl border border-slate-900 ${wrapResponse ? "whitespace-pre-wrap break-all" : "whitespace-pre overflow-x-auto"
                        }`}>
                        {typeof lastResponse.data === "object"
                          ? JSON.stringify(lastResponse.data, null, 2)
                          : String(lastResponse.data)}
                      </pre>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center p-8 text-slate-500">
                    <FiTerminal className="w-8 h-8 opacity-25 mb-3" />
                    <p className="text-xs font-semibold">No Response Yet</p>
                    <p className="text-[10px] text-center max-w-[220px] mt-0.5">Execute a request to see the response here.</p>
                  </div>
                ),
              },
              {
                key: "tests",
                label: lastResponse ? `Tests (${lastResponse.assertions.filter((a) => a.passed).length}/${lastResponse.assertions.length})` : "Tests",
                children: lastResponse ? (
                  <div className="p-4 h-full overflow-y-auto space-y-2">
                    {lastResponse.assertions.length === 0 ? (
                      <div className="text-center text-xs text-slate-500 py-6">
                        No test assertions were configured for this request.
                      </div>
                    ) : (
                      lastResponse.assertions.map((ar) => (
                        <div
                          key={ar.id}
                          className={`flex items-start gap-3 p-3 rounded-xl border ${ar.passed
                            ? "bg-emerald-500/[0.03] border-emerald-500/15 text-emerald-950 dark:text-emerald-200"
                            : "bg-rose-500/[0.03] border-rose-500/15 text-rose-950 dark:text-rose-200"
                            }`}
                        >
                          {ar.passed ? (
                            <FiCheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                          ) : (
                            <FiXCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                          )}
                          <div className="text-xs">
                            <p className="font-bold">{ar.passed ? "Passed" : "Failed"}</p>
                            <p className="opacity-80 mt-0.5 font-mono">{ar.message}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center p-8 text-slate-500">
                    <FiTerminal className="w-8 h-8 opacity-25 mb-3" />
                    <p className="text-xs font-semibold">No Response Yet</p>
                  </div>
                ),
              },
              {
                key: "codegen",
                label: "Code Gen",
                children: (
                  <div className="p-4 h-full overflow-y-auto space-y-5">
                    {/* Curl */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase tracking-wider flex items-center gap-1">
                          <FiCode className="w-3.5 h-3.5 text-indigo-500" />
                          cURL Command
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyLang("curl", generatedCode.curl)}
                          className="flex items-center justify-center p-1 rounded-md text-slate-500 hover:text-indigo-500 dark:text-slate-400 dark:hover:text-indigo-400 hover:bg-slate-500/10 dark:hover:bg-white/[0.04] transition-all cursor-pointer"
                          title="Copy cURL"
                        >
                          {copiedLang === "curl" ? (
                            <FiCheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <FiCopy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                      <pre className="text-[10px] font-mono bg-slate-950/95 p-3 rounded-lg border border-slate-900 text-indigo-200 overflow-x-auto whitespace-pre select-all">
                        {generatedCode.curl}
                      </pre>
                    </div>

                    {/* Fetch */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase tracking-wider flex items-center gap-1">
                          <FiCpu className="w-3.5 h-3.5 text-emerald-500" />
                          Fetch API (JS)
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyLang("fetch", generatedCode.fetch)}
                          className="flex items-center justify-center p-1 rounded-md text-slate-500 hover:text-indigo-500 dark:text-slate-400 dark:hover:text-indigo-400 hover:bg-slate-500/10 dark:hover:bg-white/[0.04] transition-all cursor-pointer"
                          title="Copy Fetch Script"
                        >
                          {copiedLang === "fetch" ? (
                            <FiCheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <FiCopy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                      <pre className="text-[10px] font-mono bg-slate-950/95 p-3 rounded-lg border border-slate-900 text-indigo-200 overflow-x-auto whitespace-pre select-all">
                        {generatedCode.fetch}
                      </pre>
                    </div>

                    {/* Axios */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase tracking-wider flex items-center gap-1">
                          <FiCode className="w-3.5 h-3.5 text-sky-500" />
                          Axios (Node.js)
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyLang("axios", generatedCode.axios)}
                          className="flex items-center justify-center p-1 rounded-md text-slate-500 hover:text-indigo-500 dark:text-slate-400 dark:hover:text-indigo-400 hover:bg-slate-500/10 dark:hover:bg-white/[0.04] transition-all cursor-pointer"
                          title="Copy Axios Script"
                        >
                          {copiedLang === "axios" ? (
                            <FiCheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <FiCopy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                      <pre className="text-[10px] font-mono bg-slate-950/95 p-3 rounded-lg border border-slate-900 text-indigo-200 overflow-x-auto whitespace-pre select-all">
                        {generatedCode.axios}
                      </pre>
                    </div>

                    {/* Python */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase tracking-wider flex items-center gap-1">
                          <FiLayers className="w-3.5 h-3.5 text-amber-500" />
                          Python Requests
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyLang("python", generatedCode.python)}
                          className="flex items-center justify-center p-1 rounded-md text-slate-500 hover:text-indigo-500 dark:text-slate-400 dark:hover:text-indigo-400 hover:bg-slate-500/10 dark:hover:bg-white/[0.04] transition-all cursor-pointer"
                          title="Copy Python Script"
                        >
                          {copiedLang === "python" ? (
                            <FiCheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <FiCopy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                      <pre className="text-[10px] font-mono bg-slate-950/95 p-3 rounded-lg border border-slate-900 text-indigo-200 overflow-x-auto whitespace-pre select-all">
                        {generatedCode.python}
                      </pre>
                    </div>

                    {/* Java */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase tracking-wider flex items-center gap-1">
                          <FiCoffee className="w-3.5 h-3.5 text-amber-600" />
                          Java HttpClient
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyLang("java", generatedCode.java)}
                          className="flex items-center justify-center p-1 rounded-md text-slate-500 hover:text-indigo-500 dark:text-slate-400 dark:hover:text-indigo-400 hover:bg-slate-500/10 dark:hover:bg-white/[0.04] transition-all cursor-pointer"
                          title="Copy Java Script"
                        >
                          {copiedLang === "java" ? (
                            <FiCheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <FiCopy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                      <pre className="text-[10px] font-mono bg-slate-950/95 p-3 rounded-lg border border-slate-900 text-indigo-200 overflow-x-auto whitespace-pre select-all">
                        {generatedCode.java}
                      </pre>
                    </div>

                    {/* Go */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase tracking-wider flex items-center gap-1">
                          <FiTerminal className="w-3.5 h-3.5 text-teal-500" />
                          Go HTTP
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyLang("go", generatedCode.go)}
                          className="flex items-center justify-center p-1 rounded-md text-slate-500 hover:text-indigo-500 dark:text-slate-400 dark:hover:text-indigo-400 hover:bg-slate-500/10 dark:hover:bg-white/[0.04] transition-all cursor-pointer"
                          title="Copy Go Script"
                        >
                          {copiedLang === "go" ? (
                            <FiCheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <FiCopy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                      <pre className="text-[10px] font-mono bg-slate-950/95 p-3 rounded-lg border border-slate-900 text-indigo-200 overflow-x-auto whitespace-pre select-all">
                        {generatedCode.go}
                      </pre>
                    </div>

                    {/* Rust */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold text-slate-550 dark:text-slate-450 uppercase tracking-wider flex items-center gap-1">
                          <FiCpu className="w-3.5 h-3.5 text-orange-500" />
                          Rust Reqwest
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyLang("rust", generatedCode.rust)}
                          className="flex items-center justify-center p-1 rounded-md text-slate-500 hover:text-indigo-500 dark:text-slate-400 dark:hover:text-indigo-400 hover:bg-slate-500/10 dark:hover:bg-white/[0.04] transition-all cursor-pointer"
                          title="Copy Rust Script"
                        >
                          {copiedLang === "rust" ? (
                            <FiCheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <FiCopy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                      <pre className="text-[10px] font-mono bg-slate-950/95 p-3 rounded-lg border border-slate-900 text-indigo-200 overflow-x-auto whitespace-pre select-all">
                        {generatedCode.rust}
                      </pre>
                    </div>
                  </div>
                ),
              },
              {
                key: "console",
                label: (
                  <span className="flex items-center gap-1.5">
                    Console
                    {consoleLogs.length > 0 && (
                      <span className="text-[9px] font-bold bg-emerald-500/15 text-emerald-500 px-1.5 py-0.5 rounded-full">{consoleLogs.length}</span>
                    )}
                  </span>
                ),
                children: (
                  <div className="h-full flex flex-col">
                    <div className="flex items-center justify-between px-4 py-2 border-b border-slate-500/10 shrink-0">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                        <FiTerminal className="w-3 h-3 text-emerald-500" /> Script Console
                      </span>
                      {consoleLogs.length > 0 && (
                        <button
                          type="button"
                          onClick={() => activeRequestId && updateRunState(activeRequestId, { consoleLogs: [] })}
                          className="text-[9px] font-bold text-rose-500 hover:underline cursor-pointer flex items-center gap-1"
                        >
                          <FiTrash2 className="w-2.5 h-2.5" /> Clear
                        </button>
                      )}
                    </div>
                    <div className="flex-1 overflow-y-auto bg-slate-950/95 p-4 font-mono text-[11px] space-y-2">
                      {consoleLogs.length === 0 ? (
                        <p className="text-slate-600 italic select-none">{`// console.log() output from scripts appears here`}</p>
                      ) : (
                        consoleLogs.map((entry, idx) => (
                          <div key={idx} className="flex items-start gap-2.5">
                            <span className={`shrink-0 text-[9px] font-black uppercase px-1.5 py-0.5 rounded mt-0.5 ${entry.source === "pre" ? "bg-amber-500/15 text-amber-400" : "bg-sky-500/15 text-sky-400"}`}>
                              {entry.source === "pre" ? "PRE" : "POST"}
                            </span>
                            <span className="text-emerald-300 break-all leading-relaxed">{entry.text}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ),
              },
            ]}
          />
        </div>

      </div>
    </div>
  );
}
