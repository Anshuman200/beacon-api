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

export interface ScriptWorkerRequest {
  code: string;
  context: ScriptContext;
}
