import { describe, it, expect } from "vitest";
import { exportCollection, importBeaconCollection, importPostmanCollection, importCollectionFile } from "@/lib/importExport";
import { Collection, Environment, createDefaultRequest, defaultOAuth2Config } from "@/store/collectionStore";

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: "col_1",
    name: "My Collection",
    requests: [createDefaultRequest("req_1", "Req 1")],
    folders: [],
    variables: [],
    authProfiles: [],
    ...overrides,
  };
}

describe("exportCollection", () => {
  it("redacts secret-flagged variables but keeps non-secret ones", () => {
    const collection = makeCollection({
      variables: [
        { key: "public", value: "visible", enabled: true },
        { key: "apiKey", value: "super-secret", enabled: true, secret: true },
      ],
    });
    const json = JSON.parse(exportCollection(collection, []));
    const vars = json.collection.variables;
    expect(vars.find((v: { key: string }) => v.key === "public").value).toBe("visible");
    expect(vars.find((v: { key: string }) => v.key === "apiKey").value).toBe("");
    expect(vars.find((v: { key: string }) => v.key === "apiKey").secret).toBe(true);
  });

  it("redacts every auth credential field on every request, keeping non-secret fields", () => {
    const req = createDefaultRequest("req_1");
    req.auth = {
      type: "bearer",
      bearerToken: "tok_secret",
      basicUser: "alice",
      basicPass: "pw_secret",
      apiKeyName: "X-Api-Key",
      apiKeyValue: "key_secret",
      apiKeyLocation: "header",
      oauth2: { ...defaultOAuth2Config(), clientId: "client-123", clientSecret: "secret", accessToken: "at_secret", refreshToken: "rt_secret" },
    };
    const collection = makeCollection({ requests: [req] });
    const json = JSON.parse(exportCollection(collection, []));
    const exportedAuth = json.collection.requests[0].auth;

    expect(exportedAuth.bearerToken).toBe("");
    expect(exportedAuth.basicPass).toBe("");
    expect(exportedAuth.apiKeyValue).toBe("");
    expect(exportedAuth.oauth2.clientSecret).toBe("");
    expect(exportedAuth.oauth2.accessToken).toBe("");
    expect(exportedAuth.oauth2.refreshToken).toBe("");
    // Non-secret identifying fields survive so a re-import doesn't lose the auth setup entirely.
    expect(exportedAuth.basicUser).toBe("alice");
    expect(exportedAuth.apiKeyName).toBe("X-Api-Key");
    expect(exportedAuth.oauth2.clientId).toBe("client-123");
  });

  it("redacts secret environment variables", () => {
    const env: Environment = { id: "env_1", name: "Prod", variables: [{ key: "token", value: "hidden", enabled: true, secret: true }] };
    const json = JSON.parse(exportCollection(makeCollection(), [env]));
    expect(json.environments[0].variables[0].value).toBe("");
  });

  it("stamps a beaconExportVersion marker", () => {
    const json = JSON.parse(exportCollection(makeCollection(), []));
    expect(json.beaconExportVersion).toBe(1);
  });
});

describe("importBeaconCollection", () => {
  it("round-trips a collection and assigns fresh ids to everything", () => {
    const original = makeCollection({
      id: "col_original",
      folders: [{ id: "fld_a", name: "Folder A", parentId: null }],
      requests: [{ ...createDefaultRequest("req_original"), folderId: "fld_a" }],
    });
    const exported = exportCollection(original, [{ id: "env_original", name: "Env", variables: [] }]);
    const { collection, environments } = importBeaconCollection(exported);

    expect(collection.id).not.toBe("col_original");
    expect(collection.folders[0].id).not.toBe("fld_a");
    expect(collection.requests[0].id).not.toBe("req_original");
    expect(environments[0].id).not.toBe("env_original");
    // The request's folderId is remapped to the *new* folder id, not left dangling.
    expect(collection.requests[0].folderId).toBe(collection.folders[0].id);
  });

  it("throws on a non-Beacon-export file", () => {
    expect(() => importBeaconCollection(JSON.stringify({ foo: "bar" }))).toThrow();
  });

  it("backfills folders: [] for a pre-folders export file", () => {
    const legacyExport = {
      beaconExportVersion: 1,
      exportedAt: new Date().toISOString(),
      collection: { id: "col_1", name: "Legacy", requests: [], variables: [] },
      environments: [],
    };
    const { collection } = importBeaconCollection(JSON.stringify(legacyExport));
    expect(collection.folders).toEqual([]);
  });
});

describe("importPostmanCollection", () => {
  const fixture = {
    info: { name: "Postman Fixture", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
    variable: [{ key: "baseUrl", value: "https://api.example.com" }],
    item: [
      {
        name: "Auth Folder",
        item: [
          {
            name: "Bearer Request",
            request: {
              method: "get",
              header: [{ key: "X-Test", value: "1" }],
              url: { raw: "https://api.example.com/me?x=1", query: [{ key: "x", value: "1" }] },
              auth: { type: "bearer", bearer: [{ key: "token", value: "tok" }] },
              body: { mode: "raw", raw: '{"a":1}', options: { raw: { language: "json" } } },
            },
            event: [
              { listen: "prerequest", script: { exec: ["console.log('pre')"] } },
              { listen: "test", script: { exec: ["pm.test('ok', () => {})"] } },
            ],
          },
        ],
      },
      {
        name: "OAuth2 Request",
        request: {
          method: "POST",
          url: "https://api.example.com/data",
          auth: {
            type: "oauth2",
            oauth2: [
              { key: "grant_type", value: "client_credentials" },
              { key: "accessTokenUrl", value: "https://auth.example.com/token" },
              { key: "clientId", value: "cid" },
            ],
          },
          body: { mode: "formdata", formdata: [{ key: "f", value: "v" }] },
        },
      },
      {
        name: "Basic + Urlencoded",
        request: {
          method: "POST",
          url: "https://api.example.com/login",
          auth: { type: "basic", basic: [{ key: "username", value: "alice" }, { key: "password", value: "pw" }] },
          body: { mode: "urlencoded", urlencoded: [{ key: "u", value: "alice" }] },
        },
      },
    ],
  };

  it("maps nested folders correctly", () => {
    const { collection } = importPostmanCollection(JSON.stringify(fixture));
    expect(collection.folders).toHaveLength(1);
    expect(collection.folders[0].name).toBe("Auth Folder");
  });

  it("maps a nested request's folderId, method, headers, query params, bearer auth, JSON body, and scripts", () => {
    const { collection } = importPostmanCollection(JSON.stringify(fixture));
    const req = collection.requests.find((r) => r.name === "Bearer Request")!;
    expect(req.method).toBe("GET");
    expect(req.folderId).toBe(collection.folders[0].id);
    expect(req.headers).toEqual([{ key: "X-Test", value: "1", enabled: true }]);
    expect(req.params).toEqual([{ key: "x", value: "1", enabled: true }]);
    expect(req.auth.type).toBe("bearer");
    expect(req.auth.bearerToken).toBe("tok");
    expect(req.body.type).toBe("json");
    expect(req.body.rawText).toBe('{"a":1}');
    expect(req.preRequestScript).toBe("console.log('pre')");
    expect(req.postResponseScript).toBe("pm.test('ok', () => {})");
  });

  it("maps oauth2 auth (client_credentials fields) on a root-level request", () => {
    const { collection } = importPostmanCollection(JSON.stringify(fixture));
    const req = collection.requests.find((r) => r.name === "OAuth2 Request")!;
    expect(req.folderId).toBeNull();
    expect(req.auth.type).toBe("oauth2");
    expect(req.auth.oauth2.grantType).toBe("client_credentials");
    expect(req.auth.oauth2.accessTokenUrl).toBe("https://auth.example.com/token");
    expect(req.auth.oauth2.clientId).toBe("cid");
    expect(req.body.type).toBe("formdata");
    expect(req.body.formdata).toEqual([{ key: "f", value: "v", enabled: true, type: "text" }]);
  });

  it("maps basic auth and urlencoded body", () => {
    const { collection } = importPostmanCollection(JSON.stringify(fixture));
    const req = collection.requests.find((r) => r.name === "Basic + Urlencoded")!;
    expect(req.auth.type).toBe("basic");
    expect(req.auth.basicUser).toBe("alice");
    expect(req.auth.basicPass).toBe("pw");
    expect(req.body.type).toBe("urlencoded");
    expect(req.body.urlencoded).toEqual([{ key: "u", value: "alice", enabled: true }]);
  });

  it("imports collection-level variables", () => {
    const { collection } = importPostmanCollection(JSON.stringify(fixture));
    expect(collection.variables).toEqual([{ key: "baseUrl", value: "https://api.example.com", enabled: true }]);
  });

  it("throws on a non-Postman file", () => {
    expect(() => importPostmanCollection(JSON.stringify({ foo: "bar" }))).toThrow();
  });
});

describe("importCollectionFile — format auto-detection", () => {
  it("routes a Beacon export to the Beacon importer", () => {
    const exported = exportCollection(makeCollection(), []);
    const { collection } = importCollectionFile(exported);
    expect(collection.name).toBe("My Collection");
  });

  it("routes a Postman export to the Postman importer", () => {
    const postman = { info: { name: "P", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" }, item: [] };
    const { collection } = importCollectionFile(JSON.stringify(postman));
    expect(collection.name).toBe("P");
  });

  it("throws on an unrecognized format", () => {
    expect(() => importCollectionFile(JSON.stringify({ nothing: "here" }))).toThrow();
  });
});
