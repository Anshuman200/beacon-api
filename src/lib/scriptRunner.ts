import type { ScriptContext, ScriptRunResult, ScriptWorkerRequest } from "./scriptTypes";

export type { ScriptContext, ScriptRunResult, ScriptTestResult } from "./scriptTypes";

const SCRIPT_TIMEOUT_MS = 5000;
const RESULT_TAG = "beacon-script-result";

interface TaggedResultMessage {
  tag: typeof RESULT_TAG;
  result: ScriptRunResult;
}

function isTaggedResult(data: unknown): data is TaggedResultMessage {
  return typeof data === "object" && data !== null && (data as { tag?: unknown }).tag === RESULT_TAG;
}

function passthroughResult(context: ScriptContext, logMessage: string): ScriptRunResult {
  return {
    activeEnvVariables: context.activeEnvVariables,
    globalEnvVariables: context.globalEnvVariables,
    collectionVariables: context.collectionVariables,
    request: context.request,
    testResults: [],
    logs: [logMessage],
  };
}

/**
 * Runs a pre-request/test script inside a dedicated Web Worker. Workers have
 * no window/document/cookies/localStorage by construction, and the worker
 * (scriptRunner.worker.ts) additionally strips its own fetch/importScripts/
 * WebSocket globals — so even a full sandbox-escape inside the executed code
 * can't reach the host page or the network.
 */
export function runScript(code: string, context: ScriptContext): Promise<ScriptRunResult> {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    return Promise.resolve(passthroughResult(context, "[WARN] Scripts can only run in the browser."));
  }

  return new Promise((resolve) => {
    const worker = new Worker(new URL("../workers/scriptRunner.worker.ts", import.meta.url));
    let settled = false;

    const finish = (result: ScriptRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      worker.terminate();
      resolve(result);
    };

    const timeoutId = setTimeout(() => {
      finish(passthroughResult(context, `[RUNTIME ERROR] Script execution timed out after ${SCRIPT_TIMEOUT_MS}ms`));
    }, SCRIPT_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (isTaggedResult(event.data)) {
        finish(event.data.result);
      }
      // Untagged messages (e.g. a script calling the real postMessage via an
      // escaped global) are ignored — only our own tagged result settles this.
    };

    worker.onerror = (event) => {
      finish(passthroughResult(context, `[RUNTIME ERROR] ${event.message || "Worker failed to execute script"}`));
    };

    const message: ScriptWorkerRequest = { code, context };
    worker.postMessage(message);
  });
}
