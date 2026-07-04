import {
  Collection,
  ApiRequest,
  Environment,
  Folder,
  KeyValuePair,
  FormDataPair,
  AuthConfig,
  BodyConfig,
  defaultOAuth2Config,
  defaultOwaspChecklist,
} from "@/store/collectionStore";

const genId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

// ─────────────────────────────────────────────────────────────────────────
// Beacon-native export/import (round-trip, git-committable)
// ─────────────────────────────────────────────────────────────────────────

export interface BeaconExportFile {
  beaconExportVersion: 1;
  exportedAt: string;
  collection: Collection;
  environments: Environment[];
}

const redactSecrets = (vars: KeyValuePair[]): KeyValuePair[] =>
  (vars || []).map((v) => (v.secret ? { ...v, value: "" } : v));

/**
 * Redacts every credential field on an AuthConfig, not just secret-flagged
 * variables — bearerToken/basicPass/apiKeyValue/oauth2 tokens & client secret
 * all export empty. Keys/URLs/client IDs are kept so a re-import can prompt
 * for the missing values instead of losing the auth setup entirely.
 */
const redactAuthConfig = (auth: AuthConfig): AuthConfig => ({
  ...auth,
  bearerToken: "",
  basicPass: "",
  apiKeyValue: "",
  oauth2: {
    ...auth.oauth2,
    accessToken: "",
    refreshToken: "",
    clientSecret: "",
  },
});

const redactRequest = (req: ApiRequest): ApiRequest => ({
  ...req,
  auth: redactAuthConfig(req.auth),
});

/**
 * Serializes a collection (+ its environments) to pretty JSON for sharing via
 * git/Slack/etc. Variables flagged `secret` have their value redacted, and
 * every request's auth credentials (bearer/basic/API key/OAuth2) are always
 * redacted — the key is kept so a re-import can prompt for it, but the value
 * never leaves the machine that set it.
 */
export function exportCollection(collection: Collection, environments: Environment[]): string {
  const payload: BeaconExportFile = {
    beaconExportVersion: 1,
    exportedAt: new Date().toISOString(),
    collection: {
      ...collection,
      variables: redactSecrets(collection.variables),
      requests: collection.requests.map(redactRequest),
      authProfiles: (collection.authProfiles ?? []).map((p) => ({ ...p, auth: redactAuthConfig(p.auth) })),
    },
    environments: environments.map((e) => ({ ...e, variables: redactSecrets(e.variables) })),
  };
  return JSON.stringify(payload, null, 2);
}

export function downloadCollectionExport(collection: Collection, environments: Environment[]) {
  const json = exportCollection(collection, environments);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${collection.name.replace(/[^a-z0-9-_]+/gi, "_") || "collection"}.beacon.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface ImportResult {
  collection: Collection;
  environments: Environment[];
}

function isBeaconExport(data: unknown): data is BeaconExportFile {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { beaconExportVersion?: unknown }).beaconExportVersion === 1 &&
    typeof (data as { collection?: unknown }).collection === "object"
  );
}

/**
 * Re-assigns every id in an imported collection/environment set so importing
 * never collides with ids already present in the destination workspace,
 * while preserving folder parent/child and request/folder relationships.
 */
function remapIds(collection: Collection, environments: Environment[]): ImportResult {
  const folderIdMap = new Map<string, string>();
  const newFolders: Folder[] = collection.folders.map((f) => {
    const newId = genId("fld");
    folderIdMap.set(f.id, newId);
    return { ...f, id: newId };
  });
  newFolders.forEach((f) => {
    f.parentId = f.parentId ? folderIdMap.get(f.parentId) ?? null : null;
  });

  const newRequests: ApiRequest[] = collection.requests.map((r) => ({
    ...r,
    id: genId("req"),
    folderId: r.folderId ? folderIdMap.get(r.folderId) ?? null : null,
  }));

  return {
    collection: {
      ...collection,
      id: genId("col"),
      folders: newFolders,
      requests: newRequests,
    },
    environments: environments.map((e) => ({ ...e, id: genId("env") })),
  };
}

/** Older/hand-edited export files may predate the `folders`/`authProfiles` fields. */
function withFolders(collection: Collection): Collection {
  return { ...collection, folders: collection.folders ?? [], authProfiles: collection.authProfiles ?? [] };
}

export function importBeaconCollection(json: string): ImportResult {
  const data = JSON.parse(json);
  if (!isBeaconExport(data)) {
    throw new Error("Not a Beacon collection export");
  }
  return remapIds(withFolders(data.collection), data.environments || []);
}

// ─────────────────────────────────────────────────────────────────────────
// Postman Collection v2.1 import (read-only — export deferred, Beacon's own
// format round-trips fine for Beacon-to-Beacon sharing)
// ─────────────────────────────────────────────────────────────────────────

interface PostmanKV {
  key: string;
  value?: string;
  disabled?: boolean;
}

interface PostmanUrl {
  raw?: string;
  query?: PostmanKV[];
}

interface PostmanAuth {
  type: string;
  bearer?: PostmanKV[];
  basic?: PostmanKV[];
  apikey?: PostmanKV[];
  oauth2?: PostmanKV[];
}

interface PostmanBody {
  mode?: "raw" | "urlencoded" | "formdata" | "graphql" | "none";
  raw?: string;
  options?: { raw?: { language?: string } };
  urlencoded?: PostmanKV[];
  formdata?: PostmanKV[];
  graphql?: { query?: string; variables?: string };
}

interface PostmanEvent {
  listen: "prerequest" | "test";
  script?: { exec?: string[] };
}

interface PostmanRequest {
  method?: string;
  header?: PostmanKV[];
  url?: PostmanUrl | string;
  auth?: PostmanAuth;
  body?: PostmanBody;
}

interface PostmanItem {
  name?: string;
  item?: PostmanItem[];
  request?: PostmanRequest;
  event?: PostmanEvent[];
}

interface PostmanCollection {
  info?: { name?: string; schema?: string };
  item?: PostmanItem[];
  variable?: PostmanKV[];
}

function isPostmanExport(data: unknown): data is PostmanCollection {
  const schema = (data as { info?: { schema?: string } })?.info?.schema;
  return typeof schema === "string" && schema.includes("schema.getpostman.com");
}

function toKeyValuePairs(items?: PostmanKV[]): KeyValuePair[] {
  return (items || [])
    .filter((i) => i.key)
    .map((i) => ({ key: i.key, value: i.value || "", enabled: !i.disabled }));
}

function toFormDataPairs(items?: PostmanKV[]): FormDataPair[] {
  return toKeyValuePairs(items).map((kv) => ({ ...kv, type: "text" as const }));
}

function resolveAuth(auth?: PostmanAuth): AuthConfig {
  const base: AuthConfig = {
    type: "none",
    bearerToken: "",
    basicUser: "",
    basicPass: "",
    apiKeyName: "x-api-key",
    apiKeyValue: "",
    apiKeyLocation: "header",
    oauth2: defaultOAuth2Config(),
  };
  if (!auth) return base;
  const findVal = (arr: PostmanKV[] | undefined, key: string) => arr?.find((v) => v.key === key)?.value || "";

  if (auth.type === "bearer") {
    return { ...base, type: "bearer", bearerToken: findVal(auth.bearer, "token") };
  }
  if (auth.type === "basic") {
    return { ...base, type: "basic", basicUser: findVal(auth.basic, "username"), basicPass: findVal(auth.basic, "password") };
  }
  if (auth.type === "apikey") {
    const location = findVal(auth.apikey, "in");
    return {
      ...base,
      type: "apikey",
      apiKeyName: findVal(auth.apikey, "key") || base.apiKeyName,
      apiKeyValue: findVal(auth.apikey, "value"),
      apiKeyLocation: location === "query" ? "query" : "header",
    };
  }
  if (auth.type === "oauth2") {
    return {
      ...base,
      type: "oauth2",
      oauth2: {
        ...defaultOAuth2Config(),
        grantType: findVal(auth.oauth2, "grant_type") === "authorization_code" ? "authorization_code" : "client_credentials",
        accessTokenUrl: findVal(auth.oauth2, "accessTokenUrl"),
        authorizationUrl: findVal(auth.oauth2, "authUrl"),
        clientId: findVal(auth.oauth2, "clientId"),
        clientSecret: findVal(auth.oauth2, "clientSecret"),
        scope: findVal(auth.oauth2, "scope"),
        accessToken: findVal(auth.oauth2, "accessToken"),
      },
    };
  }
  return base;
}

function resolveBody(body?: PostmanBody): BodyConfig {
  const base: BodyConfig = { type: "none", rawText: "", formdata: [], urlencoded: [], graphql: { query: "", variables: "{}" } };
  if (!body || !body.mode || body.mode === "none") return base;

  if (body.mode === "raw") {
    const isJson = body.options?.raw?.language === "json";
    return { ...base, type: isJson ? "json" : "raw", rawText: body.raw || "" };
  }
  if (body.mode === "urlencoded") {
    return { ...base, type: "urlencoded", urlencoded: toKeyValuePairs(body.urlencoded) };
  }
  if (body.mode === "formdata") {
    return { ...base, type: "formdata", formdata: toFormDataPairs(body.formdata) };
  }
  if (body.mode === "graphql" && body.graphql) {
    return { ...base, type: "graphql", graphql: { query: body.graphql.query || "", variables: body.graphql.variables || "{}" } };
  }
  return base;
}

function resolveUrl(url?: PostmanUrl | string): { baseUrl: string; endpoint: string; params: KeyValuePair[] } {
  const raw = typeof url === "string" ? url : url?.raw || "";
  const query = typeof url === "string" ? [] : toKeyValuePairs(url?.query);
  // Strip the query string from `raw` — Postman keeps it in both `raw` and `query`,
  // Beacon's `params[]` is the single source of truth for query params.
  const withoutQuery = raw.split("?")[0];
  return { baseUrl: withoutQuery, endpoint: "", params: query };
}

function scriptFor(events: PostmanEvent[] | undefined, listen: "prerequest" | "test"): string {
  const evt = events?.find((e) => e.listen === listen);
  return evt?.script?.exec?.join("\n") || "";
}

function flattenItems(
  items: PostmanItem[],
  folders: Folder[],
  requests: ApiRequest[],
  parentId: string | null
) {
  for (const item of items) {
    if (item.item) {
      // Folder (Postman nests folders/requests together under `item`)
      const folderId = genId("fld");
      folders.push({ id: folderId, name: item.name || "Folder", parentId });
      flattenItems(item.item, folders, requests, folderId);
      continue;
    }
    if (!item.request) continue;
    const { baseUrl, endpoint, params } = resolveUrl(item.request.url);
    requests.push({
      id: genId("req"),
      name: item.name || "Imported Request",
      method: (item.request.method || "GET").toUpperCase(),
      baseUrl,
      endpoint,
      contentType: "application/json",
      params,
      headers: toKeyValuePairs(item.request.header),
      auth: resolveAuth(item.request.auth),
      body: resolveBody(item.request.body),
      assertions: [],
      seedMode: "repeat",
      repeatCount: 1,
      delay: 100,
      jsonItems: "[]",
      preRequestScript: scriptFor(item.event, "prerequest"),
      postResponseScript: scriptFor(item.event, "test"),
      folderId: parentId,
      security: { checklist: defaultOwaspChecklist() },
    });
  }
}

export function importPostmanCollection(json: string): ImportResult {
  const data = JSON.parse(json);
  if (!isPostmanExport(data)) {
    throw new Error("Not a Postman v2.1 collection export");
  }

  const folders: Folder[] = [];
  const requests: ApiRequest[] = [];
  flattenItems(data.item || [], folders, requests, null);

  const collection: Collection = {
    id: genId("col"),
    name: data.info?.name || "Imported Collection",
    requests,
    folders,
    variables: toKeyValuePairs(data.variable),
    authProfiles: [],
  };

  return { collection, environments: [] };
}

/** Auto-detects the export format and imports accordingly. */
export function importCollectionFile(json: string): ImportResult {
  const data = JSON.parse(json);
  if (isBeaconExport(data)) {
    return remapIds(withFolders(data.collection), data.environments || []);
  }
  if (isPostmanExport(data)) {
    return importPostmanCollection(json);
  }
  throw new Error("Unrecognized collection format — expected a Beacon or Postman v2.1 export");
}
