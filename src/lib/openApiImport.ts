import { load as loadYaml } from "js-yaml";
import {
  ApiRequest,
  Collection,
  Environment,
  Folder,
  KeyValuePair,
  FormDataPair,
  AuthConfig,
  AuthType,
  BodyConfig,
  defaultOAuth2Config,
  defaultOwaspChecklist,
} from "@/store/collectionStore";
import type { ImportResult } from "@/lib/importExport";

// Deliberately not shared with importExport.ts's identical helper — importing
// it (a runtime value) from there would create a circular module dependency
// once importExport.ts imports this file's parseOpenApiDocument for its
// format-auto-detect dispatcher. `ImportResult` above is a type-only import,
// which is erased at compile time and carries no such risk.
const genId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

// ─────────────────────────────────────────────────────────────────────────
// OpenAPI 3.x / Swagger 2.0 import (read-only) — parsed entirely client-side,
// same as the Postman importer in importExport.ts. Every path+method becomes
// one ApiRequest, with auth resolved *per operation* (a spec can freely mix
// public and protected endpoints — see mapSecurityToAuthConfig below).
// ─────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
type JsonObject = Record<string, any>;

export function isOpenApi3(doc: unknown): boolean {
  const v = (doc as JsonObject)?.openapi;
  return typeof v === "string" && v.startsWith("3.");
}

export function isSwagger2(doc: unknown): boolean {
  return (doc as JsonObject)?.swagger === "2.0";
}

/**
 * Resolves internal `$ref` pointers (`#/components/schemas/Foo`,
 * `#/definitions/Foo`) in place. External refs (a URL or another file) are
 * left untouched — out of scope, matches the Postman importer's precedent of
 * not chasing anything outside the single document handed to it. A depth cap
 * (not a visited-set) guards against self-referential schemas, since the same
 * $ref legitimately appears many times in one document (a shared "Error"
 * schema, for instance) — a visited-set would incorrectly refuse to resolve
 * the second legitimate use.
 */
export function resolveRefs(doc: JsonObject, maxDepth = 12): JsonObject {
  function resolve(node: any, depth: number): any {
    if (depth > maxDepth || node === null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map((item) => resolve(item, depth + 1));

    if (typeof node.$ref === "string" && node.$ref.startsWith("#/")) {
      const path = node.$ref.slice(2).split("/");
      let target: any = doc;
      for (const segment of path) {
        target = target?.[segment];
        if (target === undefined) break;
      }
      if (target !== undefined) return resolve(target, depth + 1);
      return node;
    }

    const out: JsonObject = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = resolve(value, depth + 1);
    }
    return out;
  }
  return resolve(doc, 0);
}

// ─────────────────────────────────────────────────────────────────────────
// Normalized shape both formats convert into, so one builder handles both.
// ─────────────────────────────────────────────────────────────────────────

interface SecurityScheme {
  type: "apiKey" | "http" | "oauth2" | "openIdConnect" | string;
  scheme?: string; // http: "bearer" | "basic"
  in?: "header" | "query" | "cookie";
  name?: string; // apiKey header/query param name
  flows?: JsonObject; // oauth2 (OpenAPI 3)
  flow?: string; // oauth2 (Swagger 2): "implicit" | "password" | "application" | "accessCode"
  authorizationUrl?: string; // Swagger 2 oauth2
  tokenUrl?: string; // Swagger 2 oauth2
}

interface NormalizedParam {
  name: string;
  in: "query" | "header" | "path" | "cookie";
  example?: unknown;
}

interface NormalizedOperation {
  method: string;
  path: string;
  summary?: string;
  operationId?: string;
  tags?: string[];
  parameters: NormalizedParam[];
  /** Keyed by content-type, e.g. "application/json" -> schema. */
  requestBodyContent?: Record<string, JsonObject>;
  /** undefined = inherit the document's global default; [] = explicitly no auth. */
  security?: JsonObject[];
}

interface NormalizedDoc {
  baseUrl: string;
  operations: NormalizedOperation[];
  securitySchemes: Record<string, SecurityScheme>;
  globalSecurity?: JsonObject[];
}

/**
 * OpenAPI/Swagger explicitly allow a relative `servers[].url` (e.g. "/api/v1")
 * — meaning "relative to wherever this document itself is hosted." Testers
 * routinely paste the *docs* URL, whose origin is exactly that host, so we
 * resolve relative URLs against `sourceUrl` (the spec's own fetch URL) rather
 * than saving the literal relative path as base_url, which would produce an
 * unusable environment variable like "/api/v1".
 */
function resolveBaseUrl(rawBaseUrl: string, sourceUrl?: string): string {
  if (!rawBaseUrl) return sourceUrl ? new URL(sourceUrl).origin : "";
  try {
    new URL(rawBaseUrl); // already absolute — has its own scheme
    return rawBaseUrl.replace(/\/$/, "");
  } catch {
    if (!sourceUrl) return rawBaseUrl; // nothing to resolve a relative URL against
    return new URL(rawBaseUrl, sourceUrl).toString().replace(/\/$/, "");
  }
}

function normalizeOpenApi3(doc: JsonObject, sourceUrl?: string): NormalizedDoc {
  const baseUrl = resolveBaseUrl(doc.servers?.[0]?.url || "", sourceUrl);
  const securitySchemes: Record<string, SecurityScheme> = doc.components?.securitySchemes || {};
  const operations: NormalizedOperation[] = [];

  for (const [path, pathItem] of Object.entries<JsonObject>(doc.paths || {})) {
    for (const method of ["get", "post", "put", "patch", "delete", "head", "options"]) {
      const op: JsonObject | undefined = pathItem[method];
      if (!op) continue;

      const parameters: NormalizedParam[] = [...(pathItem.parameters || []), ...(op.parameters || [])]
        .filter((p: JsonObject) => p.in === "query" || p.in === "header" || p.in === "path")
        .map((p: JsonObject) => ({
          name: p.name,
          in: p.in,
          example: p.example ?? p.schema?.example ?? p.schema?.default ?? p.schema?.enum?.[0],
        }));

      let requestBodyContent: Record<string, JsonObject> | undefined;
      if (op.requestBody?.content) {
        requestBodyContent = {};
        for (const [ct, media] of Object.entries<JsonObject>(op.requestBody.content)) {
          requestBodyContent[ct] = media.schema || {};
        }
      }

      operations.push({
        method,
        path,
        summary: op.summary,
        operationId: op.operationId,
        tags: op.tags,
        parameters,
        requestBodyContent,
        security: op.security,
      });
    }
  }

  return { baseUrl, operations, securitySchemes, globalSecurity: doc.security };
}

function normalizeSwagger2(doc: JsonObject, sourceUrl?: string): NormalizedDoc {
  const scheme = doc.schemes?.[0] || (sourceUrl ? new URL(sourceUrl).protocol.replace(":", "") : "https");
  const rawBaseUrl = doc.host ? `${scheme}://${doc.host}${doc.basePath || ""}` : (doc.basePath || "");
  const baseUrl = resolveBaseUrl(rawBaseUrl, sourceUrl);
  const securitySchemes: Record<string, SecurityScheme> = doc.securityDefinitions || {};
  const operations: NormalizedOperation[] = [];

  for (const [path, pathItem] of Object.entries<JsonObject>(doc.paths || {})) {
    for (const method of ["get", "post", "put", "patch", "delete", "head", "options"]) {
      const op: JsonObject | undefined = pathItem[method];
      if (!op) continue;

      const allParams: JsonObject[] = [...(pathItem.parameters || []), ...(op.parameters || [])];
      const parameters: NormalizedParam[] = allParams
        .filter((p) => p.in === "query" || p.in === "header" || p.in === "path")
        .map((p) => ({ name: p.name, in: p.in, example: p["x-example"] ?? p.default ?? p.enum?.[0] }));

      let requestBodyContent: Record<string, JsonObject> | undefined;
      const bodyParam = allParams.find((p) => p.in === "body");
      const formParams = allParams.filter((p) => p.in === "formData");
      if (bodyParam?.schema) {
        requestBodyContent = { "application/json": bodyParam.schema };
      } else if (formParams.length > 0) {
        const properties: JsonObject = {};
        for (const p of formParams) properties[p.name] = { type: p.type, example: p["x-example"] ?? p.default };
        requestBodyContent = { "application/x-www-form-urlencoded": { type: "object", properties } };
      }

      operations.push({
        method,
        path,
        summary: op.summary,
        operationId: op.operationId,
        tags: op.tags,
        parameters,
        requestBodyContent,
        security: op.security,
      });
    }
  }

  return { baseUrl, operations, securitySchemes, globalSecurity: doc.security };
}

// ─────────────────────────────────────────────────────────────────────────
// Example-body generation from a JSON Schema (best-effort, never throws).
// ─────────────────────────────────────────────────────────────────────────

export function exampleFromSchema(schema: JsonObject | undefined, depth = 0): unknown {
  if (!schema || depth > 8) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  switch (schema.type) {
    case "object": {
      const out: JsonObject = {};
      for (const [key, propSchema] of Object.entries<JsonObject>(schema.properties || {})) {
        out[key] = exampleFromSchema(propSchema, depth + 1);
      }
      return out;
    }
    case "array":
      return [exampleFromSchema(schema.items, depth + 1)];
    case "string":
      return "";
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    default:
      // Untyped schema with only `properties` (common in loose specs).
      if (schema.properties) return exampleFromSchema({ ...schema, type: "object" }, depth);
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Security scheme → Beacon AuthConfig
// ─────────────────────────────────────────────────────────────────────────

function emptyAuth(type: AuthType = "none"): AuthConfig {
  return {
    type,
    bearerToken: "",
    basicUser: "",
    basicPass: "",
    apiKeyName: "x-api-key",
    apiKeyValue: "",
    apiKeyLocation: "header",
    oauth2: defaultOAuth2Config(),
  };
}

function mapSecurityToAuthConfig(
  security: JsonObject[] | undefined,
  securitySchemes: Record<string, SecurityScheme>
): AuthConfig {
  // Explicitly empty (`security: []`) means this operation is public — an
  // OpenAPI author uses this specifically to override a global default.
  if (security && security.length === 0) return emptyAuth("none");
  if (!security || security.length === 0) return emptyAuth("none");

  const schemeName = Object.keys(security[0] || {})[0];
  const scheme = schemeName ? securitySchemes[schemeName] : undefined;
  if (!scheme) return emptyAuth("none");

  if (scheme.type === "http" && scheme.scheme === "bearer") {
    return emptyAuth("bearer");
  }
  if (scheme.type === "http" && scheme.scheme === "basic") {
    return emptyAuth("basic");
  }
  if (scheme.type === "apiKey") {
    return {
      ...emptyAuth("apikey"),
      apiKeyName: scheme.name || "x-api-key",
      apiKeyLocation: scheme.in === "query" ? "query" : "header",
    };
  }
  if (scheme.type === "oauth2") {
    const flows = scheme.flows || (scheme.flow ? { [scheme.flow]: { authorizationUrl: scheme.authorizationUrl, tokenUrl: scheme.tokenUrl } } : {});
    const clientCreds = flows.clientCredentials || flows.application;
    const authCode = flows.authorizationCode || flows.accessCode;
    const flow = clientCreds || authCode;
    return {
      ...emptyAuth("oauth2"),
      oauth2: {
        ...defaultOAuth2Config(),
        grantType: authCode && !clientCreds ? "authorization_code" : "client_credentials",
        accessTokenUrl: flow?.tokenUrl || "",
        authorizationUrl: flow?.authorizationUrl || "",
        scope: flow?.scopes ? Object.keys(flow.scopes)[0] || "" : "",
      },
    };
  }
  // openIdConnect (and anything unrecognized) has no Beacon equivalent — fall
  // back to none rather than guess at credentials that don't exist.
  return emptyAuth("none");
}

// ─────────────────────────────────────────────────────────────────────────
// Build the Beacon collection from a normalized document.
// ─────────────────────────────────────────────────────────────────────────

function toKeyValuePairs(params: NormalizedParam[], location: "query" | "header"): KeyValuePair[] {
  return params
    .filter((p) => p.in === location)
    .map((p) => ({ key: p.name, value: p.example !== undefined ? String(p.example) : "", enabled: true }));
}

function buildBody(content: Record<string, JsonObject> | undefined): { body: BodyConfig; contentType: string } {
  const empty: BodyConfig = { type: "none", rawText: "", formdata: [], urlencoded: [], graphql: { query: "", variables: "{}" } };
  if (!content) return { body: empty, contentType: "application/json" };

  if (content["application/json"]) {
    const example = exampleFromSchema(content["application/json"]);
    return { body: { ...empty, type: "json", rawText: JSON.stringify(example ?? {}, null, 2) }, contentType: "application/json" };
  }
  if (content["application/x-www-form-urlencoded"]) {
    const schema = content["application/x-www-form-urlencoded"];
    const urlencoded: KeyValuePair[] = Object.entries<JsonObject>(schema.properties || {}).map(([key, propSchema]) => ({
      key,
      value: propSchema.example !== undefined ? String(propSchema.example) : "",
      enabled: true,
    }));
    return { body: { ...empty, type: "urlencoded", urlencoded }, contentType: "application/x-www-form-urlencoded" };
  }
  if (content["multipart/form-data"]) {
    const schema = content["multipart/form-data"];
    const formdata: FormDataPair[] = Object.entries<JsonObject>(schema.properties || {}).map(([key, propSchema]) => ({
      key,
      type: "text" as const,
      value: propSchema.example !== undefined ? String(propSchema.example) : "",
      enabled: true,
    }));
    return { body: { ...empty, type: "formdata", formdata }, contentType: "multipart/form-data" };
  }
  const firstKey = Object.keys(content)[0];
  if (firstKey) {
    const example = exampleFromSchema(content[firstKey]);
    return { body: { ...empty, type: "raw", rawText: typeof example === "string" ? example : JSON.stringify(example ?? "") }, contentType: firstKey };
  }
  return { body: empty, contentType: "application/json" };
}

function buildCollectionFromNormalized(name: string, normalized: NormalizedDoc): ImportResult {
  const folders: Folder[] = [];
  const folderIdByTag = new Map<string, string>();
  const requests: ApiRequest[] = [];
  const pathVarNames = new Set<string>();

  for (const op of normalized.operations) {
    // Convert /users/{id} -> /users/{{id}}, collecting "id" as a collection variable.
    const endpoint = op.path
      .replace(/^\//, "")
      .replace(/\{([^}]+)\}/g, (_match, name: string) => {
        pathVarNames.add(name);
        return `{{${name}}}`;
      });

    let folderId: string | null = null;
    const tag = op.tags?.[0];
    if (tag) {
      folderId = folderIdByTag.get(tag) || null;
      if (!folderId) {
        folderId = genId("fld");
        folderIdByTag.set(tag, folderId);
        folders.push({ id: folderId, name: tag, parentId: null });
      }
    }

    const { body, contentType } = buildBody(op.requestBodyContent);
    const auth = mapSecurityToAuthConfig(op.security ?? normalized.globalSecurity, normalized.securitySchemes);

    requests.push({
      id: genId("req"),
      name: op.summary || op.operationId || `${op.method.toUpperCase()} ${op.path}`,
      method: op.method.toUpperCase(),
      baseUrl: "{{base_url}}",
      endpoint,
      contentType,
      params: toKeyValuePairs(op.parameters, "query"),
      headers: toKeyValuePairs(op.parameters, "header"),
      auth,
      body,
      assertions: [],
      seedMode: "repeat",
      repeatCount: 1,
      delay: 10,
      jsonItems: "[]",
      preRequestScript: "",
      postResponseScript: "",
      folderId,
      security: { checklist: defaultOwaspChecklist() },
    });
  }

  const variables: KeyValuePair[] = Array.from(pathVarNames).map((name) => ({ key: name, value: "", enabled: true }));

  const collection: Collection = {
    id: genId("col"),
    name,
    requests,
    folders,
    variables,
    authProfiles: [],
  };

  // The base URL is environment-scoped (not a collection variable) so it
  // matches Beacon's existing convention (see demoData.ts's DEMO_ENVIRONMENT)
  // and so switching servers (dev/staging/prod) doesn't require editing every
  // request — every request references it as `{{base_url}}`.
  const environment: Environment = {
    id: genId("env"),
    name: `${name} — Imported`,
    variables: [{ key: "base_url", value: normalized.baseUrl, enabled: true }],
  };

  return { collection, environments: [environment] };
}

/**
 * Parses a raw OpenAPI 3.x or Swagger 2.0 document (JSON or YAML text) into a
 * Beacon collection. `sourceUrl` — the URL the spec was actually fetched from
 * — is used to resolve a relative `servers[].url`/`basePath` into a usable
 * absolute base_url; omit it for file uploads, where no such origin exists.
 */
export function parseOpenApiDocument(raw: string, name?: string, sourceUrl?: string): ImportResult {
  let doc: JsonObject;
  try {
    doc = JSON.parse(raw);
  } catch {
    try {
      doc = loadYaml(raw) as JsonObject;
    } catch {
      throw new Error("Could not parse the document as JSON or YAML.");
    }
  }
  if (!doc || typeof doc !== "object") {
    throw new Error("Could not parse the document as JSON or YAML.");
  }

  const resolved = resolveRefs(doc);
  const collectionName = name || resolved.info?.title || "Imported API";

  if (isOpenApi3(resolved)) {
    return buildCollectionFromNormalized(collectionName, normalizeOpenApi3(resolved, sourceUrl));
  }
  if (isSwagger2(resolved)) {
    return buildCollectionFromNormalized(collectionName, normalizeSwagger2(resolved, sourceUrl));
  }
  throw new Error("Not an OpenAPI 3.x or Swagger 2.0 document.");
}

export function isOpenApiDocument(data: unknown): boolean {
  return isOpenApi3(data) || isSwagger2(data);
}

// ─────────────────────────────────────────────────────────────────────────
// Fetch a spec from a URL through Beacon's existing proxy (so it inherits the
// SSRF egress guard for free) with optional credentials used only to fetch
// the spec itself — separate from whatever auth each imported request needs.
// ─────────────────────────────────────────────────────────────────────────

export type SpecFetchCredentials =
  | { type: "none" }
  | { type: "basic"; username: string; password: string }
  | { type: "header"; name: string; value: string };

function toBase64(input: string): string {
  if (typeof btoa === "function") return btoa(input);
  return Buffer.from(input, "utf-8").toString("base64");
}

async function rawFetchViaProxy(url: string, headers: Record<string, string>): Promise<string> {
  const res = await fetch("/api/seed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, method: "GET", headers }),
  });
  const result = await res.json();
  if (result.error) throw new Error(result.error);
  if (result.status >= 400) throw new Error(`Fetching ${url} failed with ${result.status} ${result.statusText}`);
  return typeof result.data === "string" ? result.data : JSON.stringify(result.data);
}

function looksLikeHtml(text: string): boolean {
  // Anchoring strictly at index 0 misses real-world pages that lead with an
  // HTML comment (e.g. swagger-ui's own static build: `<!-- ... --><!DOCTYPE html>`).
  return /<!doctype html|<html[\s>]/i.test(text.slice(0, 500));
}

/**
 * Swagger UI's own HTML page embeds the *actual* spec URL somewhere — either
 * inline (`swaggerOptions = { url: "/swagger.json", ... }`) or, in the very
 * common `swagger-ui-express` layout, in a separately-loaded init script
 * (`swagger-ui-init.js`) that sets `"url": "/swagger/swagger.json"`. A tester
 * pasting the human-facing docs URL (e.g. one ending in a client-side `#/`
 * route, which browsers never even send to the server) is the norm, not the
 * exception — so this is worth digging for rather than just failing.
 */
function extractSpecUrlFromConfig(text: string): string | null {
  const match = text.match(/["']url["']\s*:\s*["']([^"']+)["']/);
  return match ? match[1] : null;
}

function extractInitScriptSrc(html: string): string | null {
  const match = html.match(/<script[^>]+src=["']([^"']*(?:init|config)[^"']*\.js)["']/i);
  return match ? match[1] : null;
}

const COMMON_SPEC_PATHS = ["swagger.json", "swagger/swagger.json", "v3/api-docs", "v2/api-docs", "openapi.json", "api-docs"];

async function discoverSpecFromHtmlPage(pageUrl: string, html: string, headers: Record<string, string>): Promise<{ text: string; url: string }> {
  let discovered = extractSpecUrlFromConfig(html);

  if (!discovered) {
    const scriptSrc = extractInitScriptSrc(html);
    if (scriptSrc) {
      const scriptUrl = new URL(scriptSrc, pageUrl).toString();
      const scriptText = await rawFetchViaProxy(scriptUrl, headers).catch(() => null);
      if (scriptText) discovered = extractSpecUrlFromConfig(scriptText);
    }
  }

  if (discovered) {
    const resolvedUrl = new URL(discovered, pageUrl).toString();
    const specText = await rawFetchViaProxy(resolvedUrl, headers);
    if (!looksLikeHtml(specText)) return { text: specText, url: resolvedUrl };
  }

  // Last resort: try the handful of conventional paths real-world frameworks
  // use (swagger-ui-express, springdoc, etc.) at the same origin.
  const origin = new URL(pageUrl).origin;
  for (const path of COMMON_SPEC_PATHS) {
    try {
      const candidateUrl = `${origin}/${path}`;
      const candidate = await rawFetchViaProxy(candidateUrl, headers);
      if (looksLikeHtml(candidate)) continue;
      const parsed = tryParseJsonOrYaml(candidate);
      if (parsed && isOpenApiDocument(parsed)) return { text: candidate, url: candidateUrl };
    } catch {
      // Try the next candidate path.
    }
  }

  throw new Error(
    "That URL returned an HTML docs page, not the spec itself, and the actual spec URL couldn't be auto-discovered. " +
    "Look for a direct link on the docs page (often shown near the title, usually ending in swagger.json or openapi.json) and paste that instead."
  );
}

function tryParseJsonOrYaml(text: string): JsonObject | null {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return loadYaml(text) as JsonObject;
    } catch {
      return null;
    }
  }
}

/**
 * Fetches a spec through Beacon's existing `/api/seed` proxy — a plain GET,
 * no need for the full request-runner machinery (env var resolution, scripts,
 * OAuth2 refresh) that a real `ApiRequest` carries for one-off spec fetch.
 * Going through the proxy (rather than fetching directly from the browser)
 * both sidesteps CORS and inherits the SSRF egress guard for free.
 * Auto-discovers the real spec URL if the given one turns out to serve the
 * human-facing Swagger UI HTML page instead of the spec document. Returns the
 * URL the spec was *actually* fetched from alongside its text, since that can
 * differ from the input (via discovery) and is needed to resolve a relative
 * `servers[].url`/`basePath` in the spec itself.
 */
export async function fetchOpenApiSpecFromUrl(url: string, credentials: SpecFetchCredentials): Promise<{ text: string; url: string }> {
  const headers: Record<string, string> = {};
  if (credentials.type === "basic") {
    headers["Authorization"] = `Basic ${toBase64(`${credentials.username}:${credentials.password}`)}`;
  } else if (credentials.type === "header" && credentials.name) {
    headers[credentials.name] = credentials.value;
  }

  const text = await rawFetchViaProxy(url, headers);
  if (looksLikeHtml(text)) {
    return discoverSpecFromHtmlPage(url, text, headers);
  }
  return { text, url };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
