import { KeyValuePair } from "@/store/collectionStore";

export interface ScriptContext {
  activeEnvName: string | null;
  activeEnvId: string | null;
  activeEnvVariables: KeyValuePair[];
  globalEnvVariables: KeyValuePair[];
  collectionVariables: KeyValuePair[];
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string;
  };
  response?: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    data: unknown;
    responseTime: number;
  };
}

export interface ScriptTestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export interface ScriptRunResult {
  activeEnvVariables: KeyValuePair[];
  globalEnvVariables: KeyValuePair[];
  collectionVariables: KeyValuePair[];
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string;
  };
  testResults: ScriptTestResult[];
  logs: string[];
}

interface VarStore {
  get: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
  unset: (key: string) => void;
  clear: () => void;
  has: (key: string) => boolean;
}

const createVarStore = (
  variables: KeyValuePair[]
): { store: VarStore; updatedVariables: KeyValuePair[] } => {
  const varsCopy = JSON.parse(JSON.stringify(variables)) as KeyValuePair[];
  const store: VarStore = {
    get: (key: string) => {
      const v = varsCopy.find((x) => x.key === key);
      return v?.enabled ? v.value : undefined;
    },
    set: (key: string, value: string) => {
      const idx = varsCopy.findIndex((x) => x.key === key);
      if (idx > -1) {
        varsCopy[idx] = { ...varsCopy[idx], value };
      } else {
        varsCopy.push({ key, value, enabled: true });
      }
    },
    unset: (key: string) => {
      const idx = varsCopy.findIndex((x) => x.key === key);
      if (idx > -1) {
        varsCopy.splice(idx, 1);
      }
    },
    clear: () => {
      varsCopy.length = 0;
    },
    has: (key: string) => {
      return varsCopy.some((x) => x.key === key && x.enabled);
    },
  };
  return { store, updatedVariables: varsCopy };
};

interface ResponseToChain {
  have: {
    status: (code: number) => ResponseToChain;
    header: (key: string, value?: string) => ResponseToChain;
  };
  be: {
    ok: ResponseToChain;
    success: ResponseToChain;
    info: ResponseToChain;
    redirect: ResponseToChain;
    clientError: ResponseToChain;
    serverError: ResponseToChain;
  };
}

interface ResponseObj {
  code: number;
  status: string;
  responseTime: number;
  headers: {
    get: (key: string) => string | undefined;
  };
  text: () => string;
  json: () => unknown;
  to: ResponseToChain;
}

interface ExpectChain {
  to: {
    equal: (expected: unknown) => ExpectChain;
    eql: (expected: unknown) => ExpectChain;
    include: (expected: unknown) => ExpectChain;
    contain: (expected: unknown) => ExpectChain;
    be: {
      a: (type: string) => ExpectChain;
      ok: ExpectChain;
      true: ExpectChain;
      false: ExpectChain;
      null: ExpectChain;
      undefined: ExpectChain;
      empty: ExpectChain;
    };
    have: {
      property: (prop: string, expectedVal?: unknown) => ExpectChain;
    };
    not: {
      equal: (expected: unknown) => ExpectChain;
      include: (expected: unknown) => ExpectChain;
      contain: (expected: unknown) => ExpectChain;
    };
  };
}

export function runScript(code: string, context: ScriptContext): ScriptRunResult {
  const logs: string[] = [];
  const testResults: ScriptTestResult[] = [];

  const logWarning = (msg: string) => {
    logs.push(`[WARN] ${msg}`);
  };

  // 1. Set up environments
  const activeVarsWrapper = createVarStore(context.activeEnvVariables || []);
  const globalVarsWrapper = createVarStore(context.globalEnvVariables || []);
  const collectionVarsWrapper = createVarStore(context.collectionVariables || []);
  const localVarsWrapper = createVarStore([]);

  if (!context.activeEnvId) {
    // Override set/unset of active environment to print warning
    const originalSet = activeVarsWrapper.store.set;
    const originalUnset = activeVarsWrapper.store.unset;
    activeVarsWrapper.store.set = (k, v) => {
      logWarning("No active environment is selected. Script variables won't persist to workspace.");
      originalSet(k, v);
    };
    activeVarsWrapper.store.unset = (k) => {
      logWarning("No active environment is selected.");
      originalUnset(k);
    };
  }

  // 2. Set up request representation
  const reqHeadersCopy = { ...context.request.headers };
  const requestObj = {
    url: context.request.url,
    method: context.request.method,
    headers: {
      get: (key: string) => {
        const foundKey = Object.keys(reqHeadersCopy).find(
          (k) => k.toLowerCase() === key.toLowerCase()
        );
        return foundKey ? reqHeadersCopy[foundKey] : undefined;
      },
      set: (key: string, value: string) => {
        const foundKey = Object.keys(reqHeadersCopy).find(
          (k) => k.toLowerCase() === key.toLowerCase()
        );
        reqHeadersCopy[foundKey || key] = value;
      },
      delete: (key: string) => {
        const foundKey = Object.keys(reqHeadersCopy).find(
          (k) => k.toLowerCase() === key.toLowerCase()
        );
        if (foundKey) {
          delete reqHeadersCopy[foundKey];
        }
      },
    },
    body: context.request.body,
  };

  // 3. Set up response representation
  let responseObj: ResponseObj | undefined = undefined;
  if (context.response) {
    const resHeaders = context.response.headers || {};
    const resData = context.response.data;

    const baseResponse: Omit<ResponseObj, "to"> = {
      code: context.response.status,
      status: context.response.statusText,
      responseTime: context.response.responseTime,
      headers: {
        get: (key: string) => {
          const foundKey = Object.keys(resHeaders).find(
            (k) => k.toLowerCase() === key.toLowerCase()
          );
          return foundKey ? resHeaders[foundKey] : undefined;
        },
      },
      text: () => {
        return typeof resData === "string" ? resData : JSON.stringify(resData);
      },
      json: () => {
        if (typeof resData === "string") {
          try {
            return JSON.parse(resData);
          } catch {
            return resData;
          }
        }
        return resData;
      },
    };

    const toChain: ResponseToChain = {
      have: {
        status: (code: number) => {
          if (baseResponse.code !== code) {
            throw new Error(`expected response code ${baseResponse.code} to equal ${code}`);
          }
          return toChain;
        },
        header: (key: string, value?: string) => {
          const actualVal = baseResponse.headers.get(key);
          if (actualVal === undefined) {
            throw new Error(`expected response to have header "${key}"`);
          }
          if (value !== undefined && actualVal !== value) {
            throw new Error(`expected header "${key}" to equal "${value}", but got "${actualVal}"`);
          }
          return toChain;
        },
      },
      be: {
        get ok() {
          if (baseResponse.code < 200 || baseResponse.code >= 300) {
            throw new Error(`expected response status code ${baseResponse.code} to be OK (2xx)`);
          }
          return toChain;
        },
        get success() {
          if (baseResponse.code < 200 || baseResponse.code >= 300) {
            throw new Error(`expected response status code ${baseResponse.code} to be success (2xx)`);
          }
          return toChain;
        },
        get info() {
          if (baseResponse.code < 100 || baseResponse.code >= 200) {
            throw new Error(`expected response status code ${baseResponse.code} to be informational (1xx)`);
          }
          return toChain;
        },
        get redirect() {
          if (baseResponse.code < 300 || baseResponse.code >= 400) {
            throw new Error(`expected response status code ${baseResponse.code} to be redirect (3xx)`);
          }
          return toChain;
        },
        get clientError() {
          if (baseResponse.code < 400 || baseResponse.code >= 500) {
            throw new Error(`expected response status code ${baseResponse.code} to be client error (4xx)`);
          }
          return toChain;
        },
        get serverError() {
          if (baseResponse.code < 500) {
            throw new Error(`expected response status code ${baseResponse.code} to be server error (5xx)`);
          }
          return toChain;
        },
      },
    };

    responseObj = {
      ...baseResponse,
      to: toChain,
    };
  }

  // 4. Test function binding
  const test = (name: string, callback: () => void) => {
    try {
      callback();
      testResults.push({ name, passed: true });
    } catch (err: unknown) {
      testResults.push({
        name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // 5. Variables helper (cascade resolve env then globals)
  const variablesObj = {
    get: (key: string) => {
      const envVal = activeVarsWrapper.store.get(key);
      if (envVal !== undefined) return envVal;
      return globalVarsWrapper.store.get(key);
    },
  };

  // 6. Expect assertion framework
  const expect = (val: unknown): ExpectChain => {
    const assert = (passed: boolean, message: string) => {
      if (!passed) {
        throw new Error(message);
      }
    };

    const chain: ExpectChain = {
      to: {
        equal: (expected: unknown) => {
          assert(
            val === expected,
            `expected ${JSON.stringify(val)} to equal ${JSON.stringify(expected)}`
          );
          return chain;
        },
        eql: (expected: unknown) => {
          assert(
            JSON.stringify(val) === JSON.stringify(expected),
            `expected ${JSON.stringify(val)} to deeply equal ${JSON.stringify(expected)}`
          );
          return chain;
        },
        include: (expected: unknown) => {
          if (typeof val === "string") {
            assert(
              val.includes(expected as string),
              `expected ${JSON.stringify(val)} to include ${JSON.stringify(expected)}`
            );
          } else if (Array.isArray(val)) {
            assert(
              val.includes(expected),
              `expected ${JSON.stringify(val)} to include ${JSON.stringify(expected)}`
            );
          } else if (typeof val === "object" && val !== null) {
            assert(
              (expected as string) in val,
              `expected ${JSON.stringify(val)} to include key ${JSON.stringify(expected)}`
            );
          } else {
            assert(false, `expected ${JSON.stringify(val)} to include ${JSON.stringify(expected)}`);
          }
          return chain;
        },
        contain: (expected: unknown) => {
          return chain.to.include(expected);
        },
        be: {
          a: (type: string) => {
            assert(typeof val === type, `expected ${JSON.stringify(val)} to be a ${type}`);
            return chain;
          },
          get ok() {
            assert(!!val, `expected ${JSON.stringify(val)} to be truthy`);
            return chain;
          },
          get true() {
            assert(val === true, `expected ${JSON.stringify(val)} to be true`);
            return chain;
          },
          get false() {
            assert(val === false, `expected ${JSON.stringify(val)} to be false`);
            return chain;
          },
          get null() {
            assert(val === null, `expected ${JSON.stringify(val)} to be null`);
            return chain;
          },
          get undefined() {
            assert(val === undefined, `expected ${JSON.stringify(val)} to be undefined`);
            return chain;
          },
          get empty() {
            if (val === null || val === undefined) {
              assert(true, "");
            } else if (typeof val === "string" || Array.isArray(val)) {
              assert((val as string | unknown[]).length === 0, `expected ${JSON.stringify(val)} to be empty`);
            } else if (typeof val === "object") {
              assert(Object.keys(val as Record<string, unknown>).length === 0, `expected ${JSON.stringify(val)} to be empty`);
            }
            return chain;
          },
        },
        have: {
          property: (prop: string, expectedVal?: unknown) => {
            assert(
              typeof val === "object" && val !== null && prop in val,
              `expected ${JSON.stringify(val)} to have property "${prop}"`
            );
            if (expectedVal !== undefined) {
              assert(
                (val as Record<string, unknown>)[prop] === expectedVal,
                `expected property "${prop}" of ${JSON.stringify(val)} to equal ${expectedVal}`
              );
            }
            return chain;
          },
        },
        not: {
          equal: (expected: unknown) => {
            assert(
              val !== expected,
              `expected ${JSON.stringify(val)} not to equal ${JSON.stringify(expected)}`
            );
            return chain;
          },
          include: (expected: unknown) => {
            if (typeof val === "string") {
              assert(
                !val.includes(expected as string),
                `expected ${JSON.stringify(val)} not to include ${JSON.stringify(expected)}`
              );
            } else if (Array.isArray(val)) {
              assert(
                !val.includes(expected),
                `expected ${JSON.stringify(val)} not to include ${JSON.stringify(expected)}`
              );
            }
            return chain;
          },
          contain: (expected: unknown) => {
            return chain.to.not.include(expected);
          },
        },
      },
    };

    return chain;
  };

  // 7. Assemble the sandbox namespaces
  const seederNamespace = {
    env: activeVarsWrapper.store,
    globals: globalVarsWrapper.store,
    variables: variablesObj,
    request: requestObj,
    response: responseObj,
    test,
    expect,
  };

  const pmNamespace = {
    environment: activeVarsWrapper.store,
    globals: globalVarsWrapper.store,
    variables: variablesObj,
    request: requestObj,
    response: responseObj,
    test,
    expect,
  };

  const beNamespace = {
    environment: activeVarsWrapper.store,
    globals: globalVarsWrapper.store,
    collectionVariables: collectionVarsWrapper.store,
    locals: localVarsWrapper.store,
    variables: variablesObj,
    request: requestObj,
    response: responseObj,
    test,
    expect,
  };

  // 8. Console mock redirection
  const consoleMock = {
    log: (...args: unknown[]) =>
      logs.push(args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")),
    info: (...args: unknown[]) =>
      logs.push(
        "[INFO] " +
          args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")
      ),
    warn: (...args: unknown[]) =>
      logs.push(
        "[WARN] " +
          args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")
      ),
    error: (...args: unknown[]) =>
      logs.push(
        "[ERROR] " +
          args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")
      ),
  };

  // 9. Execute Script with client-side sandboxing protections
  // Note: "eval" and "arguments" cannot be used as parameter names in strict mode,
  // so they are omitted here. "eval" is already restricted by strict mode itself.
  const blockedGlobals = [
    "window",
    "document",
    "globalThis",
    "localStorage",
    "sessionStorage",
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "location",
    "top",
    "parent",
    "self",
    "Function",
    "setTimeout",
    "setInterval",
    "indexedDB",
    "cookieStore",
    "open",
    "close",
  ];

  const paramNames = ["seeder", "pm", "be", "console", "expect", ...blockedGlobals];
  const paramValues = [
    seederNamespace,
    pmNamespace,
    beNamespace,
    consoleMock,
    expect,
    ...Array(blockedGlobals.length).fill(null),
  ];

  try {
    const sandboxExec = new Function(
      ...paramNames,
      `
      "use strict";
      try {
        ${code}
      } catch (e) {
        console.error(e);
        throw e;
      }
      `
    );

    sandboxExec(...paramValues);
  } catch (err: unknown) {
    logs.push(`[RUNTIME ERROR] ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    activeEnvVariables: activeVarsWrapper.updatedVariables,
    globalEnvVariables: globalVarsWrapper.updatedVariables,
    collectionVariables: collectionVarsWrapper.updatedVariables,
    request: {
      url: requestObj.url,
      method: requestObj.method,
      headers: reqHeadersCopy,
      body: requestObj.body,
    },
    testResults,
    logs,
  };
}
