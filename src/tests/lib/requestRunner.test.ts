import { describe, it, expect } from "vitest";
import { prepareRequest, ResolvedFormDataEntry } from "@/lib/requestRunner";
import { ApiRequest, Environment, createDefaultRequest, defaultOAuth2Config } from "@/store/collectionStore";

function makeRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return { ...createDefaultRequest("req_test", "Test Request"), ...overrides };
}

const noEnv: Environment | null = null;

describe("prepareRequest — URL, params, headers", () => {
  it("joins baseUrl and endpoint and resolves templates in both", () => {
    const activeEnv: Environment = { id: "e1", name: "Active", variables: [{ key: "base", value: "https://api.example.com", enabled: true }] };
    const req = makeRequest({ baseUrl: "{{base}}", endpoint: "users/1" });
    const prepared = prepareRequest(req, activeEnv, null);
    expect(prepared.url).toBe("https://api.example.com/users/1");
  });

  it("appends enabled, resolved query params", () => {
    const req = makeRequest({
      baseUrl: "https://api.example.com",
      endpoint: "search",
      params: [
        { key: "q", value: "test", enabled: true },
        { key: "disabled", value: "x", enabled: false },
      ],
    });
    const prepared = prepareRequest(req, noEnv, null);
    expect(prepared.url).toBe("https://api.example.com/search?q=test");
  });

  it("resolves enabled custom headers, skips disabled ones", () => {
    const req = makeRequest({
      headers: [
        { key: "X-Custom", value: "yes", enabled: true },
        { key: "X-Skip", value: "no", enabled: false },
      ],
    });
    const prepared = prepareRequest(req, noEnv, null);
    expect(prepared.headers["X-Custom"]).toBe("yes");
    expect(prepared.headers["X-Skip"]).toBeUndefined();
  });
});

describe("prepareRequest — auth resolution", () => {
  it("type none sets no Authorization header", () => {
    const req = makeRequest({ auth: { ...createDefaultRequest("x").auth, type: "none" } });
    const prepared = prepareRequest(req, noEnv, null);
    expect(prepared.headers["Authorization"]).toBeUndefined();
  });

  it("bearer sets 'Bearer <token>'", () => {
    const req = makeRequest({ auth: { ...createDefaultRequest("x").auth, type: "bearer", bearerToken: "abc123" } });
    const prepared = prepareRequest(req, noEnv, null);
    expect(prepared.headers["Authorization"]).toBe("Bearer abc123");
  });

  it("basic base64-encodes user:pass", () => {
    const req = makeRequest({ auth: { ...createDefaultRequest("x").auth, type: "basic", basicUser: "alice", basicPass: "wonderland" } });
    const prepared = prepareRequest(req, noEnv, null);
    expect(prepared.headers["Authorization"]).toBe(`Basic ${btoa("alice:wonderland")}`);
  });

  it("apikey in header location sets a header named after the key", () => {
    const req = makeRequest({
      auth: { ...createDefaultRequest("x").auth, type: "apikey", apiKeyName: "X-Api-Key", apiKeyValue: "secret", apiKeyLocation: "header" },
    });
    const prepared = prepareRequest(req, noEnv, null);
    expect(prepared.headers["X-Api-Key"]).toBe("secret");
  });

  it("apikey in query location appends to the URL instead of headers", () => {
    const req = makeRequest({
      baseUrl: "https://api.example.com",
      endpoint: "data",
      auth: { ...createDefaultRequest("x").auth, type: "apikey", apiKeyName: "key", apiKeyValue: "secret", apiKeyLocation: "query" },
    });
    const prepared = prepareRequest(req, noEnv, null);
    expect(prepared.url).toBe("https://api.example.com/data?key=secret");
    expect(prepared.headers["key"]).toBeUndefined();
  });

  it("oauth2 with a cached access token sets '<tokenType> <token>'", () => {
    const req = makeRequest({
      auth: {
        ...createDefaultRequest("x").auth,
        type: "oauth2",
        oauth2: { ...defaultOAuth2Config(), accessToken: "tok_abc", tokenType: "Bearer" },
      },
    });
    const prepared = prepareRequest(req, noEnv, null);
    expect(prepared.headers["Authorization"]).toBe("Bearer tok_abc");
  });

  it("oauth2 without a cached token sets no Authorization header (caller is expected to have refreshed first)", () => {
    const req = makeRequest({
      auth: { ...createDefaultRequest("x").auth, type: "oauth2", oauth2: defaultOAuth2Config() },
    });
    const prepared = prepareRequest(req, noEnv, null);
    expect(prepared.headers["Authorization"]).toBeUndefined();
  });
});

describe("prepareRequest — body resolution", () => {
  it("json body parses valid JSON after template resolution", () => {
    const activeEnv: Environment = { id: "e1", name: "Active", variables: [{ key: "name", value: "Alice", enabled: true }] };
    const req = makeRequest({ body: { ...createDefaultRequest("x").body, type: "json", rawText: '{"name": "{{name}}"}' } });
    const prepared = prepareRequest(req, activeEnv, null);
    expect(prepared.data).toEqual({ name: "Alice" });
  });

  it("json body falls back to the raw resolved string when parsing fails", () => {
    const req = makeRequest({ body: { ...createDefaultRequest("x").body, type: "json", rawText: "{not valid json" } });
    const prepared = prepareRequest(req, noEnv, null);
    expect(prepared.data).toBe("{not valid json");
  });

  it("raw body is template-resolved but not parsed", () => {
    const req = makeRequest({ body: { ...createDefaultRequest("x").body, type: "raw", rawText: "plain text body" } });
    const prepared = prepareRequest(req, noEnv, null);
    expect(prepared.data).toBe("plain text body");
  });

  it("formdata resolves text entries and passes through file entries untouched", () => {
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    const req = makeRequest({
      body: {
        ...createDefaultRequest("x").body,
        type: "formdata",
        formdata: [
          { key: "field", type: "text", value: "value1", enabled: true },
          { key: "upload", type: "file", value: "", enabled: true, file },
          { key: "disabled_field", type: "text", value: "skip", enabled: false },
        ],
      },
    });
    const prepared = prepareRequest(req, noEnv, null);
    const data = prepared.data as ResolvedFormDataEntry[];
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({ key: "field", type: "text", value: "value1" });
    expect(data[1]).toEqual({ key: "upload", type: "file", file });
  });

  it("urlencoded resolves enabled entries only", () => {
    const req = makeRequest({
      body: {
        ...createDefaultRequest("x").body,
        type: "urlencoded",
        urlencoded: [
          { key: "a", value: "1", enabled: true },
          { key: "b", value: "2", enabled: false },
        ],
      },
    });
    const prepared = prepareRequest(req, noEnv, null);
    expect(prepared.data).toEqual([{ key: "a", value: "1", enabled: true }]);
  });

  it("graphql body resolves query templates and parses variables JSON", () => {
    const activeEnv: Environment = { id: "e1", name: "Active", variables: [{ key: "id", value: "42", enabled: true }] };
    const req = makeRequest({
      body: { ...createDefaultRequest("x").body, type: "graphql", graphql: { query: "query { user(id: {{id}}) { name } }", variables: '{"id": "{{id}}"}' } },
    });
    const prepared = prepareRequest(req, activeEnv, null);
    expect(prepared.data).toEqual({ query: "query { user(id: 42) { name } }", variables: { id: "42" } });
  });

  it("graphql body falls back to an empty variables object on invalid JSON", () => {
    const req = makeRequest({
      body: { ...createDefaultRequest("x").body, type: "graphql", graphql: { query: "{ me { name } }", variables: "{not valid" } },
    });
    const prepared = prepareRequest(req, noEnv, null);
    expect(prepared.data).toEqual({ query: "{ me { name } }", variables: {} });
  });

  it("body type none leaves data null", () => {
    const req = makeRequest({ body: { ...createDefaultRequest("x").body, type: "none" } });
    const prepared = prepareRequest(req, noEnv, null);
    expect(prepared.data).toBeNull();
  });
});

describe("prepareRequest — collection variable cascade", () => {
  it("resolves a template from collectionVars when no env is active", () => {
    const req = makeRequest({ baseUrl: "{{base}}", endpoint: "" });
    const prepared = prepareRequest(req, noEnv, null, [{ key: "base", value: "https://collection.example.com", enabled: true }]);
    expect(prepared.url).toBe("https://collection.example.com");
  });
});
