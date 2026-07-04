import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isOpenApi3,
  isSwagger2,
  isOpenApiDocument,
  resolveRefs,
  exampleFromSchema,
  parseOpenApiDocument,
  fetchOpenApiSpecFromUrl,
} from "@/lib/openApiImport";

const openApi3Doc = {
  openapi: "3.0.0",
  info: { title: "Sample API" },
  servers: [{ url: "https://api.example.com/v1" }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
    },
    schemas: {
      NewOrder: {
        type: "object",
        properties: {
          item: { type: "string", example: "widget" },
          quantity: { type: "integer", example: 2 },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        summary: "Health check",
        security: [], // explicitly public — overrides the global bearerAuth default
        parameters: [],
        responses: {},
      },
    },
    "/users/{id}": {
      get: {
        summary: "Get a user",
        tags: ["Users"],
        parameters: [{ name: "id", in: "path" }, { name: "verbose", in: "query", example: "true" }],
        responses: {},
      },
    },
    "/orders": {
      post: {
        summary: "Create an order",
        tags: ["Orders"],
        // No operation-level `security` — inherits the document's global bearerAuth.
        requestBody: {
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/NewOrder" } },
          },
        },
        responses: {},
      },
    },
  },
};

const swagger2Doc = {
  swagger: "2.0",
  info: { title: "Legacy API" },
  host: "legacy.example.com",
  basePath: "/api",
  schemes: ["https"],
  securityDefinitions: {
    apiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" },
  },
  security: [{ apiKeyAuth: [] }],
  paths: {
    "/items": {
      get: {
        summary: "List items",
        parameters: [{ name: "page", in: "query", default: "1" }],
        responses: {},
      },
    },
  },
};

describe("format detection", () => {
  it("identifies an OpenAPI 3.x document", () => {
    expect(isOpenApi3(openApi3Doc)).toBe(true);
    expect(isSwagger2(openApi3Doc)).toBe(false);
  });

  it("identifies a Swagger 2.0 document", () => {
    expect(isSwagger2(swagger2Doc)).toBe(true);
    expect(isOpenApi3(swagger2Doc)).toBe(false);
  });

  it("isOpenApiDocument recognizes either", () => {
    expect(isOpenApiDocument(openApi3Doc)).toBe(true);
    expect(isOpenApiDocument(swagger2Doc)).toBe(true);
    expect(isOpenApiDocument({ foo: "bar" })).toBe(false);
  });
});

describe("resolveRefs", () => {
  it("resolves an internal $ref to its target object", () => {
    const resolved = resolveRefs(openApi3Doc);
    const orderSchema = resolved.paths["/orders"].post.requestBody.content["application/json"].schema;
    expect(orderSchema).toEqual({
      type: "object",
      properties: {
        item: { type: "string", example: "widget" },
        quantity: { type: "integer", example: 2 },
      },
    });
  });

  it("leaves external refs untouched", () => {
    const doc = { $ref: "https://example.com/other.yaml#/Foo" };
    expect(resolveRefs(doc)).toEqual(doc);
  });
});

describe("exampleFromSchema", () => {
  it("prefers an explicit example over generating one", () => {
    expect(exampleFromSchema({ type: "string", example: "hi" })).toBe("hi");
  });

  it("builds a nested object example from properties", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string", example: "Ada" },
        age: { type: "integer" },
        active: { type: "boolean" },
      },
    };
    expect(exampleFromSchema(schema)).toEqual({ name: "Ada", age: 0, active: false });
  });

  it("builds an array example from items", () => {
    expect(exampleFromSchema({ type: "array", items: { type: "string", example: "x" } })).toEqual(["x"]);
  });

  it("returns null for an undefined schema rather than throwing", () => {
    expect(exampleFromSchema(undefined)).toBeNull();
  });
});

describe("parseOpenApiDocument — OpenAPI 3.x", () => {
  const result = parseOpenApiDocument(JSON.stringify(openApi3Doc));

  it("uses the document title as the collection name", () => {
    expect(result.collection.name).toBe("Sample API");
  });

  it("creates one request per operation", () => {
    expect(result.collection.requests).toHaveLength(3);
  });

  it("marks an operation with security: [] as public (auth: none), overriding the global default", () => {
    const health = result.collection.requests.find((r) => r.endpoint === "health");
    expect(health?.auth.type).toBe("none");
  });

  it("applies the document's global security to an operation with no security of its own", () => {
    const orders = result.collection.requests.find((r) => r.endpoint === "orders");
    expect(orders?.auth.type).toBe("bearer");
  });

  it("converts a {param} path segment to {{param}} and creates a collection variable for it", () => {
    const userReq = result.collection.requests.find((r) => r.name === "Get a user");
    expect(userReq?.endpoint).toBe("users/{{id}}");
    expect(result.collection.variables.some((v) => v.key === "id")).toBe(true);
  });

  it("maps query parameters with their example value", () => {
    const userReq = result.collection.requests.find((r) => r.name === "Get a user");
    expect(userReq?.params).toEqual([{ key: "verbose", value: "true", enabled: true }]);
  });

  it("generates an example JSON body from the (ref-resolved) request schema", () => {
    const orders = result.collection.requests.find((r) => r.endpoint === "orders");
    expect(orders?.body.type).toBe("json");
    expect(JSON.parse(orders!.body.rawText)).toEqual({ item: "widget", quantity: 2 });
  });

  it("groups operations into folders by their first tag", () => {
    const userReq = result.collection.requests.find((r) => r.name === "Get a user");
    const orders = result.collection.requests.find((r) => r.endpoint === "orders");
    expect(userReq?.folderId).not.toBeNull();
    expect(orders?.folderId).not.toBeNull();
    expect(userReq?.folderId).not.toBe(orders?.folderId);
    expect(result.collection.folders.map((f) => f.name).sort()).toEqual(["Orders", "Users"]);
  });

  it("points every request's baseUrl at {{base_url}} rather than hardcoding the literal server URL", () => {
    expect(result.collection.requests.every((r) => r.baseUrl === "{{base_url}}")).toBe(true);
  });

  it("creates an environment carrying the real server URL as base_url, so switching servers doesn't require editing every request", () => {
    expect(result.environments).toHaveLength(1);
    expect(result.environments[0].variables).toEqual([{ key: "base_url", value: "https://api.example.com/v1", enabled: true }]);
  });
});

describe("parseOpenApiDocument — relative servers[].url (real-world bug)", () => {
  // OpenAPI explicitly permits a relative `servers[].url` (e.g. "/api/v1"),
  // meaning "relative to wherever this document is hosted." Without a
  // sourceUrl to resolve against, that literal relative path used to get
  // saved as base_url — producing an unusable environment variable.
  const docWithRelativeServer = {
    ...openApi3Doc,
    servers: [{ url: "/api/v1" }],
  };

  it("resolves a relative server URL against the sourceUrl the spec was fetched from", () => {
    const result = parseOpenApiDocument(
      JSON.stringify(docWithRelativeServer),
      undefined,
      "https://apiauthdev.datacollect.equalyz.ai/swagger/swagger.json"
    );
    expect(result.environments[0].variables[0]).toEqual({
      key: "base_url",
      value: "https://apiauthdev.datacollect.equalyz.ai/api/v1",
      enabled: true,
    });
  });

  it("leaves the relative URL as a literal best-effort fallback when no sourceUrl is available (e.g. file upload)", () => {
    const result = parseOpenApiDocument(JSON.stringify(docWithRelativeServer));
    expect(result.environments[0].variables[0].value).toBe("/api/v1");
  });
});

describe("parseOpenApiDocument — Swagger 2.0", () => {
  const result = parseOpenApiDocument(JSON.stringify(swagger2Doc));

  it("builds the base URL from scheme + host + basePath and stores it as an environment variable", () => {
    expect(result.collection.requests[0].baseUrl).toBe("{{base_url}}");
    expect(result.environments[0].variables).toEqual([{ key: "base_url", value: "https://legacy.example.com/api", enabled: true }]);
  });

  it("maps an apiKey security definition to Beacon's apikey auth type", () => {
    expect(result.collection.requests[0].auth.type).toBe("apikey");
    expect(result.collection.requests[0].auth.apiKeyName).toBe("X-API-Key");
    expect(result.collection.requests[0].auth.apiKeyLocation).toBe("header");
  });

  it("maps a query parameter's default value", () => {
    expect(result.collection.requests[0].params).toEqual([{ key: "page", value: "1", enabled: true }]);
  });
});

describe("parseOpenApiDocument — YAML input", () => {
  it("parses a YAML-formatted OpenAPI document", () => {
    const yamlDoc = `
openapi: 3.0.0
info:
  title: YAML API
servers:
  - url: https://yaml.example.com
paths:
  /ping:
    get:
      summary: Ping
      responses: {}
`;
    const result = parseOpenApiDocument(yamlDoc);
    expect(result.collection.name).toBe("YAML API");
    expect(result.collection.requests).toHaveLength(1);
    expect(result.collection.requests[0].baseUrl).toBe("{{base_url}}");
    expect(result.environments[0].variables[0]).toEqual({ key: "base_url", value: "https://yaml.example.com", enabled: true });
  });
});

describe("parseOpenApiDocument — invalid input", () => {
  it("throws a clear error for unparseable text", () => {
    expect(() => parseOpenApiDocument("not json, not yaml: {{{")).toThrow();
  });

  it("throws for a well-formed JSON document that isn't OpenAPI/Swagger", () => {
    expect(() => parseOpenApiDocument(JSON.stringify({ hello: "world" }))).toThrow(/not an openapi/i);
  });
});

describe("fetchOpenApiSpecFromUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("encodes Basic auth credentials into the Authorization header sent to /api/seed", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ status: 200, statusText: "OK", data: JSON.stringify(openApi3Doc) }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchOpenApiSpecFromUrl("https://api.example.com/swagger.json", {
      type: "basic",
      username: "alice",
      password: "secret",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/seed",
      expect.objectContaining({ method: "POST" })
    );
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.headers.Authorization).toBe(`Basic ${Buffer.from("alice:secret").toString("base64")}`);
  });

  it("sends no extra headers when credentials type is none", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ status: 200, statusText: "OK", data: "{}" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchOpenApiSpecFromUrl("https://api.example.com/swagger.json", { type: "none" });

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.headers).toEqual({});
  });

  it("throws when the proxy reports an error (e.g. blocked by the egress guard)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ error: "Target host resolves to a private IP", code: "blocked_private_ip" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchOpenApiSpecFromUrl("http://169.254.169.254/", { type: "none" })).rejects.toThrow(/private IP/);
  });

  function proxyMockFor(responses: Record<string, string>) {
    return vi.fn(async (_input: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const text = responses[body.url];
      if (text === undefined) throw new Error(`no mock response for ${body.url}`);
      return { json: async () => ({ status: 200, statusText: "OK", data: text }) };
    });
  }

  it("discovers the real spec via a swagger-ui-express-style init script when the given URL serves the docs HTML", async () => {
    const html = `<!doctype html><html><head><script src="./swagger-ui-init.js"></script></head><body></body></html>`;
    const initScript = `window.ui = SwaggerUIBundle({ "customOptions": { "url": "/swagger/swagger.json" } });`;
    const fetchMock = proxyMockFor({
      "https://api.example.com/swagger/": html,
      "https://api.example.com/swagger/swagger-ui-init.js": initScript,
      "https://api.example.com/swagger/swagger.json": JSON.stringify(openApi3Doc),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { text, url } = await fetchOpenApiSpecFromUrl("https://api.example.com/swagger/", { type: "none" });
    expect(JSON.parse(text)).toEqual(openApi3Doc);
    expect(url).toBe("https://api.example.com/swagger/swagger.json");
  });

  it("discovers the real spec from an inline url config in the HTML page itself", async () => {
    const html = `<!doctype html><html><body><script>const ui = SwaggerUIBundle({"url": "/openapi.json"});</script></body></html>`;
    const fetchMock = proxyMockFor({
      "https://api.example.com/docs": html,
      "https://api.example.com/openapi.json": JSON.stringify(openApi3Doc),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { text, url } = await fetchOpenApiSpecFromUrl("https://api.example.com/docs", { type: "none" });
    expect(JSON.parse(text)).toEqual(openApi3Doc);
    expect(url).toBe("https://api.example.com/openapi.json");
  });

  it("falls back to conventional spec paths when no config URL can be found in the HTML", async () => {
    const html = `<!doctype html><html><body>No config here</body></html>`;
    const fetchMock = proxyMockFor({
      "https://api.example.com/docs": html,
      "https://api.example.com/swagger.json": "<!doctype html>not found either",
      "https://api.example.com/swagger/swagger.json": "<!doctype html>not found either",
      "https://api.example.com/v3/api-docs": JSON.stringify(openApi3Doc),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { text, url } = await fetchOpenApiSpecFromUrl("https://api.example.com/docs", { type: "none" });
    expect(JSON.parse(text)).toEqual(openApi3Doc);
    expect(url).toBe("https://api.example.com/v3/api-docs");
  });

  it("throws a clear, actionable error when the HTML page's spec can't be discovered at all", async () => {
    const html = `<!doctype html><html><body>No config here</body></html>`;
    const fetchMock = vi.fn(async () => ({ json: async () => ({ status: 200, statusText: "OK", data: html }) }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchOpenApiSpecFromUrl("https://api.example.com/docs", { type: "none" })).rejects.toThrow(
      /couldn't be auto-discovered/
    );
  });
});
