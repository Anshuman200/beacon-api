import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { encryptData, decryptData } from "@/lib/crypto";

export interface KeyValuePair {
  key: string;
  value: string;
  description?: string;
  enabled: boolean;
  /** When true, export omits this variable's value (key is kept so a re-import can prompt for it). */
  secret?: boolean;
}

export type AuthType = "none" | "bearer" | "basic" | "apikey" | "oauth2";
export type OAuth2GrantType = "client_credentials" | "authorization_code";

export interface OAuth2Config {
  grantType: OAuth2GrantType;
  accessTokenUrl: string;
  /** authorization_code only */
  authorizationUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  audience: string;
  /** authorization_code only; defaults to `${origin}/oauth/callback` */
  redirectUri: string;
  /** authorization_code only, default true */
  usePkce: boolean;
  // Populated after a successful token fetch — not directly user-edited.
  accessToken: string;
  tokenType: string;
  expiresAt: number | null;
  refreshToken: string;
}

export interface AuthConfig {
  type: AuthType;
  bearerToken: string;
  basicUser: string;
  basicPass: string;
  apiKeyName: string;
  apiKeyValue: string;
  apiKeyLocation: "header" | "query";
  oauth2: OAuth2Config;
}

export type BodyType = "none" | "json" | "formdata" | "urlencoded" | "raw" | "graphql";

export interface GraphQLBody {
  query: string;
  /** Raw JSON text, parsed at send-time (mirrors how rawText is handled). */
  variables: string;
}

export interface FormDataPair {
  key: string;
  type: "text" | "file";
  /** Used when type === "text". */
  value: string;
  description?: string;
  enabled: boolean;
  secret?: boolean;
  /** Used when type === "file". In-memory only — never persisted across a reload. */
  file?: File;
}

export interface BodyConfig {
  type: BodyType;
  rawText: string;
  formdata: FormDataPair[];
  urlencoded: KeyValuePair[];
  graphql: GraphQLBody;
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

export type OwaspApiCategory =
  | "API1_BOLA"
  | "API2_BROKEN_AUTH"
  | "API3_PROPERTY_AUTH"
  | "API4_RESOURCE_CONSUMPTION"
  | "API5_FUNCTION_AUTH"
  | "API6_SENSITIVE_FLOWS"
  | "API7_SSRF"
  | "API8_MISCONFIGURATION"
  | "API9_INVENTORY"
  | "API10_UNSAFE_CONSUMPTION";

export interface OwaspChecklistItem {
  category: OwaspApiCategory;
  status: "not_tested" | "pass" | "fail" | "n_a";
  notes: string;
}

export interface AuthMatrixSnapshot {
  profileId: string;
  status: number;
  timestamp: string;
}

export interface RequestSecurity {
  checklist: OwaspChecklistItem[];
  authMatrixBaseline?: AuthMatrixSnapshot[];
}

/** A named auth "role" (e.g. Admin/Regular User/Anonymous) tested across requests via the Authorization Matrix. */
export interface AuthProfile {
  id: string;
  name: string;
  auth: AuthConfig;
  /** Optional target status this role is expected to get; blank = no expectation set yet. */
  expectedStatus?: number;
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
  /** null/undefined = sits at the collection root, not inside any folder. */
  folderId?: string | null;
  security: RequestSecurity;
}

export interface Folder {
  id: string;
  name: string;
  /** null = sits at the collection root; otherwise the parent folder's id. */
  parentId: string | null;
}

export interface Collection {
  id: string;
  name: string;
  requests: ApiRequest[];
  variables: KeyValuePair[];
  folders: Folder[];
  authProfiles: AuthProfile[];
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

export const defaultOAuth2Config = (): OAuth2Config => ({
  grantType: "client_credentials",
  accessTokenUrl: "",
  authorizationUrl: "",
  clientId: "",
  clientSecret: "",
  scope: "",
  audience: "",
  redirectUri: "",
  usePkce: true,
  accessToken: "",
  tokenType: "Bearer",
  expiresAt: null,
  refreshToken: "",
});

const OWASP_API_CATEGORIES: OwaspApiCategory[] = [
  "API1_BOLA",
  "API2_BROKEN_AUTH",
  "API3_PROPERTY_AUTH",
  "API4_RESOURCE_CONSUMPTION",
  "API5_FUNCTION_AUTH",
  "API6_SENSITIVE_FLOWS",
  "API7_SSRF",
  "API8_MISCONFIGURATION",
  "API9_INVENTORY",
  "API10_UNSAFE_CONSUMPTION",
];

export const defaultOwaspChecklist = (): OwaspChecklistItem[] =>
  OWASP_API_CATEGORIES.map((category) => ({ category, status: "not_tested", notes: "" }));

const emptyAuth = (type: AuthType): AuthConfig => ({
  type,
  bearerToken: "",
  basicUser: "",
  basicPass: "",
  apiKeyName: "x-api-key",
  apiKeyValue: "",
  apiKeyLocation: "header",
  oauth2: defaultOAuth2Config(),
});

/**
 * A tester shouldn't have to build the "does this reject anonymous/lower-privilege
 * callers?" test from scratch every time — seed the three roles almost every API
 * needs checked. Tokens are left blank for the tester to fill in; Anonymous
 * defaults to "expect 401" since that's the one row nearly every secured
 * endpoint should satisfy out of the box.
 */
export const defaultAuthProfiles = (): AuthProfile[] => [
  { id: "authp_" + Date.now() + "_anon", name: "Anonymous", auth: emptyAuth("none"), expectedStatus: 401 },
  { id: "authp_" + Date.now() + "_user", name: "Regular User", auth: emptyAuth("bearer") },
  { id: "authp_" + Date.now() + "_admin", name: "Admin", auth: emptyAuth("bearer") },
];

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
    oauth2: defaultOAuth2Config(),
  },
  body: {
    type: "none",
    rawText: "{}",
    formdata: [],
    urlencoded: [],
    graphql: { query: "", variables: "{}" },
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
  security: { checklist: defaultOwaspChecklist(), authMatrixBaseline: [] },
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
  /** Inserts a fully-formed collection (e.g. from an import), activating it. */
  importCollection: (collection: Collection) => void;
  importEnvironments: (environments: Environment[]) => void;

  // Folders (nested within collections, flat with parent pointers)
  addFolder: (collectionId: string, name?: string, parentId?: string | null) => string;
  renameFolder: (collectionId: string, folderId: string, name: string) => void;
  deleteFolder: (collectionId: string, folderId: string) => void;

  // Auth profiles (named roles tested via the Authorization Matrix)
  addAuthProfile: (collectionId: string, name?: string) => string;
  updateAuthProfile: (collectionId: string, profileId: string, updates: Partial<AuthProfile>) => void;
  deleteAuthProfile: (collectionId: string, profileId: string) => void;
  /** Backfills the default role templates for collections persisted before this feature existed (or since emptied out by hand — a no-op once any profile exists). */
  ensureDefaultAuthProfiles: (collectionId: string) => void;

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
    collections: [{ id: DEFAULT_COLLECTION_ID, name: "My Collection", requests: [defaultReq], variables: [], folders: [], authProfiles: defaultAuthProfiles() }],
    activeCollectionId: DEFAULT_COLLECTION_ID,
    activeRequestId: DEFAULT_REQUEST_ID,
    environments: [{ id: "env_globals", name: "Globals", variables: [] }],
    activeEnvironmentId: null,
    history: [],
  };
};

/**
 * File/Blob attachments in formdata rows can't survive JSON.stringify (they
 * serialize to `{}`) or a page reload — they're intentionally session-only.
 * Strip them explicitly before persisting so a reload shows a clean "no file
 * selected" row instead of a resurrected-but-broken `{}` object.
 */
function stripFormDataFiles(serializedState: string): string {
  try {
    const parsed = JSON.parse(serializedState);
    const collections = parsed?.state?.collections;
    if (!Array.isArray(collections)) return serializedState;
    for (const col of collections) {
      for (const req of col.requests ?? []) {
        const formdata = req?.body?.formdata;
        if (Array.isArray(formdata)) {
          for (const fd of formdata) {
            if (fd && "file" in fd) delete fd.file;
          }
        }
      }
    }
    return JSON.stringify(parsed);
  } catch {
    return serializedState;
  }
}

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
            collections: [...state.collections, { id, name: colName, requests: [], variables: [], folders: [], authProfiles: defaultAuthProfiles() }],
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

      importCollection: (collection) => set((state) => ({
        collections: [...state.collections, collection],
        activeCollectionId: collection.id,
      })),

      importEnvironments: (environments) => set((state) => ({
        environments: [...state.environments, ...environments],
      })),

      // ── Folders ──
      addFolder: (collectionId, name, parentId) => {
        const id = "fld_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
        set((state) => {
          const targetCol = state.collections.find((c) => c.id === collectionId);
          if (!targetCol) return {};
          const folderName = name || `Folder ${targetCol.folders.length + 1}`;
          const newFolder: Folder = { id, name: folderName, parentId: parentId ?? null };
          return {
            collections: state.collections.map((c) =>
              c.id === collectionId ? { ...c, folders: [...c.folders, newFolder] } : c
            ),
          };
        });
        return id;
      },

      renameFolder: (collectionId, folderId, name) => set((state) => ({
        collections: state.collections.map((c) =>
          c.id === collectionId
            ? { ...c, folders: c.folders.map((f) => f.id === folderId ? { ...f, name } : f) }
            : c
        ),
      })),

      deleteFolder: (collectionId, folderId) => set((state) => ({
        collections: state.collections.map((c) => {
          if (c.id !== collectionId) return c;
          // Requests and child folders inside the deleted folder move up to its parent
          // (root, since folders are flat-with-parent-pointer) rather than being deleted.
          return {
            ...c,
            folders: c.folders
              .filter((f) => f.id !== folderId)
              .map((f) => f.parentId === folderId ? { ...f, parentId: null } : f),
            requests: c.requests.map((r) => r.folderId === folderId ? { ...r, folderId: null } : r),
          };
        }),
      })),

      // ── Auth profiles ──
      addAuthProfile: (collectionId, name) => {
        const id = "authp_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
        set((state) => {
          const targetCol = state.collections.find((c) => c.id === collectionId);
          if (!targetCol) return {};
          const profileName = name || `Role ${(targetCol.authProfiles ?? []).length + 1}`;
          const newProfile: AuthProfile = {
            id,
            name: profileName,
            auth: {
              type: "none",
              bearerToken: "",
              basicUser: "",
              basicPass: "",
              apiKeyName: "x-api-key",
              apiKeyValue: "",
              apiKeyLocation: "header",
              oauth2: defaultOAuth2Config(),
            },
          };
          return {
            collections: state.collections.map((c) =>
              c.id === collectionId ? { ...c, authProfiles: [...(c.authProfiles ?? []), newProfile] } : c
            ),
          };
        });
        return id;
      },

      updateAuthProfile: (collectionId, profileId, updates) => set((state) => ({
        collections: state.collections.map((c) =>
          c.id === collectionId
            ? { ...c, authProfiles: (c.authProfiles ?? []).map((p) => p.id === profileId ? { ...p, ...updates } : p) }
            : c
        ),
      })),

      deleteAuthProfile: (collectionId, profileId) => set((state) => ({
        collections: state.collections.map((c) =>
          c.id === collectionId ? { ...c, authProfiles: (c.authProfiles ?? []).filter((p) => p.id !== profileId) } : c
        ),
      })),

      ensureDefaultAuthProfiles: (collectionId) => set((state) => {
        const col = state.collections.find((c) => c.id === collectionId);
        if (!col || (col.authProfiles ?? []).length > 0) return {};
        return {
          collections: state.collections.map((c) =>
            c.id === collectionId ? { ...c, authProfiles: defaultAuthProfiles() } : c
          ),
        };
      }),

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
            const stripped = stripFormDataFiles(value);
            const encrypted = await encryptData(stripped);
            localStorage.setItem(name, encrypted);
          },
          removeItem: (name) => localStorage.removeItem(name),
        };
      }),
      version: 5,
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
            folders: [],
            authProfiles: defaultAuthProfiles(),
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

        // v1 → v2: backfill `folders: []` on any collection that's missing it
        if (fromVersion < 2 && Array.isArray(state.collections)) {
          state.collections = (state.collections as Array<Record<string, unknown>>).map((col) => ({
            ...col,
            folders: (col.folders as Folder[] | undefined) ?? [],
          }));
        }

        // v2 → v3: backfill `body.graphql`, `auth.oauth2`, and `formdata[].type` on every request
        if (fromVersion < 3 && Array.isArray(state.collections)) {
          state.collections = (state.collections as Array<Record<string, unknown>>).map((col) => {
            const requests = (col.requests as Array<Record<string, unknown>> | undefined) ?? [];
            return {
              ...col,
              requests: requests.map((req) => {
                const body = (req.body as Record<string, unknown> | undefined) ?? {};
                const auth = (req.auth as Record<string, unknown> | undefined) ?? {};
                const formdata = (body.formdata as Array<Record<string, unknown>> | undefined) ?? [];
                return {
                  ...req,
                  body: {
                    ...body,
                    graphql: (body.graphql as GraphQLBody | undefined) ?? { query: "", variables: "{}" },
                    formdata: formdata.map((fd) => ({ type: "text", ...fd })),
                  },
                  auth: {
                    ...auth,
                    oauth2: (auth.oauth2 as OAuth2Config | undefined) ?? defaultOAuth2Config(),
                  },
                };
              }),
            };
          });
        }

        // v3 → v4: backfill `security.checklist` on every request
        if (fromVersion < 4 && Array.isArray(state.collections)) {
          state.collections = (state.collections as Array<Record<string, unknown>>).map((col) => {
            const requests = (col.requests as Array<Record<string, unknown>> | undefined) ?? [];
            return {
              ...col,
              requests: requests.map((req) => {
                const security = (req.security as RequestSecurity | undefined) ?? undefined;
                return {
                  ...req,
                  security: security?.checklist ? security : { checklist: defaultOwaspChecklist() },
                };
              }),
            };
          });
        }

        // v4 → v5: backfill `authProfiles: []` on every collection, `security.authMatrixBaseline: []` on every request
        if (fromVersion < 5 && Array.isArray(state.collections)) {
          state.collections = (state.collections as Array<Record<string, unknown>>).map((col) => {
            const requests = (col.requests as Array<Record<string, unknown>> | undefined) ?? [];
            return {
              ...col,
              authProfiles: (col.authProfiles as AuthProfile[] | undefined) ?? defaultAuthProfiles(),
              requests: requests.map((req) => {
                const security = (req.security as RequestSecurity | undefined) ?? { checklist: defaultOwaspChecklist() };
                return {
                  ...req,
                  security: { ...security, authMatrixBaseline: security.authMatrixBaseline ?? [] },
                };
              }),
            };
          });
        }

        // Unconditional (not fromVersion-gated) safety net: a collection created
        // via `addCollection` while an older build of the app was still running
        // in the tab (e.g. mid hot-reload during development) can end up persisted
        // without `authProfiles` even though the store's version is already 5,
        // since the version-gated block above only runs once per store version.
        if (Array.isArray(state.collections)) {
          state.collections = (state.collections as Array<Record<string, unknown>>).map((col) => ({
            ...col,
            authProfiles: (col.authProfiles as AuthProfile[] | undefined) ?? defaultAuthProfiles(),
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
