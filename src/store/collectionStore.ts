import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { encryptData, decryptData } from "@/lib/crypto";

export interface KeyValuePair {
  key: string;
  value: string;
  description?: string;
  enabled: boolean;
}

export type AuthType = "none" | "bearer" | "basic" | "apikey";

export interface AuthConfig {
  type: AuthType;
  bearerToken: string;
  basicUser: string;
  basicPass: string;
  apiKeyName: string;
  apiKeyValue: string;
  apiKeyLocation: "header" | "query";
}

export type BodyType = "none" | "json" | "formdata" | "urlencoded" | "raw";

export interface BodyConfig {
  type: BodyType;
  rawText: string;
  formdata: KeyValuePair[];
  urlencoded: KeyValuePair[];
}

export type AssertionTarget = "status_code" | "response_time" | "content_type" | "json_path" | "body_text" | "header";
export type AssertionOperator = "equals" | "not_equals" | "contains" | "not_contains" | "less_than" | "greater_than" | "exists" | "matches_regex";

export interface Assertion {
  id: string;
  target: AssertionTarget;
  property: string;
  operator: AssertionOperator;
  value: string;
}

export interface ApiRequest {
  id: string;
  name: string;
  method: string;
  baseUrl: string;
  endpoint: string;
  contentType: string;
  params: KeyValuePair[];
  headers: KeyValuePair[];
  auth: AuthConfig;
  body: BodyConfig;
  assertions: Assertion[];
  seedMode: "repeat" | "items";
  repeatCount: number;
  delay: number;
  jsonItems: string;
  preRequestScript: string;
  postResponseScript: string;
}

export interface Collection {
  id: string;
  name: string;
  requests: ApiRequest[];
  variables: KeyValuePair[];
}

export interface Environment {
  id: string;
  name: string;
  variables: KeyValuePair[];
}

export interface HistoryEntry {
  id: string;
  requestId: string;
  requestName: string;
  method: string;
  url: string;
  timestamp: string;
  status: "success" | "error";
  statusCode?: number;
  responseTime: number;
  assertionPassCount: number;
  assertionTotalCount: number;
}

export const createDefaultRequest = (id: string, name = "New Request"): ApiRequest => ({
  id,
  name,
  method: "GET",
  baseUrl: "https://jsonplaceholder.typicode.com",
  endpoint: "posts/1",
  contentType: "application/json",
  params: [],
  headers: [],
  auth: {
    type: "none",
    bearerToken: "",
    basicUser: "",
    basicPass: "",
    apiKeyName: "x-api-key",
    apiKeyValue: "",
    apiKeyLocation: "header",
  },
  body: {
    type: "none",
    rawText: "{}",
    formdata: [],
    urlencoded: [],
  },
  assertions: [
    {
      id: "assert_status_" + Date.now(),
      target: "status_code",
      property: "",
      operator: "equals",
      value: "200",
    },
    {
      id: "assert_time_" + (Date.now() + 1),
      target: "response_time",
      property: "",
      operator: "less_than",
      value: "3000",
    },
    {
      id: "assert_ct_" + (Date.now() + 2),
      target: "content_type",
      property: "",
      operator: "contains",
      value: "application/json",
    },
  ],
  seedMode: "repeat",
  repeatCount: 1,
  delay: 100,
  jsonItems: "[]",
  preRequestScript: "",
  postResponseScript: `const body = be.response.json();\nconsole.log("response is :- ", body);`,
});

interface CollectionStore {
  // Collections
  collections: Collection[];
  activeCollectionId: string | null;
  setActiveCollectionId: (id: string | null) => void;
  addCollection: (name?: string) => string;
  renameCollection: (id: string, name: string) => void;
  deleteCollection: (id: string) => void;
  updateCollectionVariables: (collectionId: string, variables: KeyValuePair[]) => void;

  // Requests (nested within collections)
  activeRequestId: string | null;
  setActiveRequestId: (id: string | null) => void;
  addRequest: (collectionId: string, request?: Partial<ApiRequest>) => string;
  updateRequest: (id: string, updates: Partial<ApiRequest>) => void;
  deleteRequest: (id: string) => void;
  duplicateRequest: (id: string) => void;

  // Environments
  environments: Environment[];
  activeEnvironmentId: string | null;
  setActiveEnvironmentId: (id: string | null) => void;
  addEnvironment: (name: string) => string;
  updateEnvironment: (id: string, updates: Partial<Environment>) => void;
  deleteEnvironment: (id: string) => void;
  updateEnvironmentVariable: (envId: string, key: string, value: string) => void;

  // History
  history: HistoryEntry[];
  addToHistory: (entry: Omit<HistoryEntry, "id" | "timestamp">) => void;
  clearHistory: () => void;

  // Reset
  resetCollectionStore: () => void;
}

const DEFAULT_COLLECTION_ID = "col_default";
const DEFAULT_REQUEST_ID = "req_default";

const buildInitialState = () => {
  const defaultReq = createDefaultRequest(DEFAULT_REQUEST_ID, "Default Request");
  return {
    collections: [{ id: DEFAULT_COLLECTION_ID, name: "My Collection", requests: [defaultReq], variables: [] }],
    activeCollectionId: DEFAULT_COLLECTION_ID,
    activeRequestId: DEFAULT_REQUEST_ID,
    environments: [{ id: "env_globals", name: "Globals", variables: [] }],
    activeEnvironmentId: null,
    history: [],
  };
};

export const useCollectionStore = create<CollectionStore>()(
  persist(
    (set) => ({
      ...buildInitialState(),

      // ── Collections ──
      setActiveCollectionId: (activeCollectionId) => set({ activeCollectionId }),

      addCollection: (name) => {
        const id = "col_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
        set((state) => {
          const colName = name || `Collection ${state.collections.length + 1}`;
          return {
            collections: [...state.collections, { id, name: colName, requests: [], variables: [] }],
            activeCollectionId: id,
          };
        });
        return id;
      },

      renameCollection: (id, name) => set((state) => ({
        collections: state.collections.map((c) => c.id === id ? { ...c, name } : c),
      })),

      deleteCollection: (id) => set((state) => {
        if (state.collections.length <= 1) return {};
        const filtered = state.collections.filter((c) => c.id !== id);
        const deletedCol = state.collections.find((c) => c.id === id);
        const wasActiveRequest = deletedCol?.requests.some((r) => r.id === state.activeRequestId);
        const nextActiveCollectionId = state.activeCollectionId === id ? (filtered[0]?.id ?? null) : state.activeCollectionId;
        const nextActiveRequestId = wasActiveRequest
          ? (filtered.flatMap((c) => c.requests)[0]?.id ?? null)
          : state.activeRequestId;
        return {
          collections: filtered,
          activeCollectionId: nextActiveCollectionId,
          activeRequestId: nextActiveRequestId,
        };
      }),

      updateCollectionVariables: (collectionId, variables) => set((state) => ({
        collections: state.collections.map((c) => c.id === collectionId ? { ...c, variables } : c),
      })),

      // ── Requests ──
      setActiveRequestId: (activeRequestId) => set({ activeRequestId }),

      addRequest: (collectionId, reqData) => {
        const id = (reqData as { id?: string })?.id || ("req_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9));
        set((state) => {
          const targetCol = state.collections.find((c) => c.id === collectionId);
          if (!targetCol) return {};
          const name = (reqData as { name?: string })?.name || `Request #${targetCol.requests.length + 1}`;
          const newReq: ApiRequest = { ...createDefaultRequest(id, name), ...reqData, id };
          return {
            collections: state.collections.map((c) =>
              c.id === collectionId ? { ...c, requests: [...c.requests, newReq] } : c
            ),
            activeCollectionId: collectionId,
            activeRequestId: id,
          };
        });
        return id;
      },

      updateRequest: (id, updates) => set((state) => ({
        collections: state.collections.map((col) => ({
          ...col,
          requests: col.requests.map((r) => r.id === id ? { ...r, ...updates } : r),
        })),
      })),

      deleteRequest: (id) => set((state) => {
        const newCollections = state.collections.map((col) => ({
          ...col,
          requests: col.requests.filter((r) => r.id !== id),
        }));
        let nextActiveId = state.activeRequestId;
        if (state.activeRequestId === id) {
          const allRemaining = newCollections.flatMap((c) => c.requests);
          nextActiveId = allRemaining.length > 0 ? allRemaining[0].id : null;
        }
        return { collections: newCollections, activeRequestId: nextActiveId };
      }),

      duplicateRequest: (id) => set((state) => {
        let newActiveId = state.activeRequestId;
        const newCollections = state.collections.map((col) => {
          const index = col.requests.findIndex((r) => r.id === id);
          if (index === -1) return col;
          const newId = "req_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
          const copy: ApiRequest = { ...JSON.parse(JSON.stringify(col.requests[index])), id: newId, name: `${col.requests[index].name} (Copy)` };
          newActiveId = newId;
          const updated = [...col.requests];
          updated.splice(index + 1, 0, copy);
          return { ...col, requests: updated };
        });
        return { collections: newCollections, activeRequestId: newActiveId };
      }),

      // ── Environments ──
      setActiveEnvironmentId: (activeEnvironmentId) => set({ activeEnvironmentId }),

      addEnvironment: (name) => {
        const id = "env_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
        const newEnv: Environment = { id, name, variables: [] };
        set((state) => ({
          environments: [...state.environments, newEnv],
          activeEnvironmentId: state.activeEnvironmentId ?? id,
        }));
        return id;
      },

      updateEnvironment: (id, updates) => set((state) => ({
        environments: state.environments.map((e) => e.id === id ? { ...e, ...updates } : e),
      })),

      updateEnvironmentVariable: (envId, key, value) => set((state) => {
        const env = state.environments.find((e) => e.id === envId);
        if (!env) return {};
        const varExists = env.variables.some((v) => v.key === key);
        const updatedVars = varExists
          ? env.variables.map((v) => v.key === key ? { ...v, value } : v)
          : [...env.variables, { key, value, enabled: true }];
        return {
          environments: state.environments.map((e) => e.id === envId ? { ...e, variables: updatedVars } : e),
        };
      }),

      deleteEnvironment: (id) => set((state) => {
        if (id === "env_globals") return {};
        const filtered = state.environments.filter((e) => e.id !== id);
        return {
          environments: filtered,
          activeEnvironmentId: state.activeEnvironmentId === id ? (filtered[0]?.id ?? null) : state.activeEnvironmentId,
        };
      }),

      // ── History ──
      addToHistory: (entry) => {
        const id = "hist_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
        set((state) => ({
          history: [{ ...entry, id, timestamp: new Date().toLocaleTimeString() }, ...state.history].slice(0, 100),
        }));
      },

      clearHistory: () => set({ history: [] }),

      // ── Reset ──
      resetCollectionStore: () => set(buildInitialState()),
    }),
    {
      name: "api-seeder-workspace",
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
        }
        return {
          getItem: async (name) => {
            const val = localStorage.getItem(name);
            if (!val) return null;
            return await decryptData(val);
          },
          setItem: async (name, value) => {
            const encrypted = await encryptData(value);
            localStorage.setItem(name, encrypted);
          },
          removeItem: (name) => localStorage.removeItem(name),
        };
      }),
      version: 1,
      migrate: (persistedState: unknown, fromVersion: number) => {
        const state = persistedState as Record<string, unknown> | null;
        if (!state || typeof state !== "object") return buildInitialState();

        // Migrate from old flat `requests[]` format (with optional `collectionName`)
        if ("requests" in state && !("collections" in state)) {
          const oldRequests = (state.requests as ApiRequest[] | undefined) || [];
          const colName = (state.collectionName as string | undefined) || "My Collection";
          const col: Collection = {
            id: DEFAULT_COLLECTION_ID,
            name: colName,
            requests: oldRequests.length > 0 ? oldRequests : [createDefaultRequest(DEFAULT_REQUEST_ID, "Default Request")],
            variables: [],
          };
          const { requests: _r, collectionName: _cn, ...rest } = state as Record<string, unknown>;
          void _r; void _cn;
          const migrated: Record<string, unknown> = {
            ...rest,
            collections: [col],
            activeCollectionId: DEFAULT_COLLECTION_ID,
            activeRequestId: (rest.activeRequestId as string | undefined) || col.requests[0].id,
          };
          return migrated as unknown as CollectionStore;
        }

        // v0 → v1: backfill `variables: []` on any collection that's missing it
        if (fromVersion < 1 && Array.isArray(state.collections)) {
          state.collections = (state.collections as Array<Record<string, unknown>>).map((col) => ({
            ...col,
            variables: (col.variables as KeyValuePair[] | undefined) ?? [],
          }));
        }

        // Ensure at least one collection with at least one request
        const s = state as { collections?: Collection[]; activeCollectionId?: string | null; activeRequestId?: string | null };
        if (!s.collections || s.collections.length === 0) {
          return { ...state, ...buildInitialState() } as unknown as CollectionStore;
        }

        return state as unknown as CollectionStore;
      },
    }
  )
);
