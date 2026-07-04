import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ensureOAuth2Token, fetchClientCredentialsToken, exchangeAuthorizationCode } from "@/lib/oauth2";
import { ApiRequest, createDefaultRequest, defaultOAuth2Config } from "@/store/collectionStore";

const identityResolve = (v: string) => v;

function mockFetchOnce(jsonBody: unknown) {
  const fn = vi.fn().mockResolvedValue({ json: () => Promise.resolve(jsonBody) });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchClientCredentialsToken", () => {
  it("sends the correct request shape to /api/seed", async () => {
    const fetchMock = mockFetchOnce({ data: { access_token: "tok_abc", token_type: "Bearer", expires_in: 3600 } });
    const oauth2 = { ...defaultOAuth2Config(), accessTokenUrl: "https://auth.example.com/token", clientId: "cid", clientSecret: "csecret", scope: "read write" };

    await fetchClientCredentialsToken(oauth2, identityResolve);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/seed");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.url).toBe("https://auth.example.com/token");
    expect(body.contentType).toBe("application/x-www-form-urlencoded");
    expect(body.data).toEqual({
      grant_type: "client_credentials",
      client_id: "cid",
      client_secret: "csecret",
      scope: "read write",
    });
  });

  it("computes expiresAt from expires_in and returns the token", async () => {
    mockFetchOnce({ data: { access_token: "tok_abc", token_type: "Bearer", expires_in: 3600 } });
    const before = Date.now();
    const result = await fetchClientCredentialsToken(defaultOAuth2Config(), identityResolve);

    expect(result.accessToken).toBe("tok_abc");
    expect(result.oauth2Updates.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(result.oauth2Updates.tokenType).toBe("Bearer");
  });

  it("throws when /api/seed itself reports an error", async () => {
    mockFetchOnce({ error: "Request failed" });
    await expect(fetchClientCredentialsToken(defaultOAuth2Config(), identityResolve)).rejects.toThrow("Request failed");
  });

  it("throws with the IdP's error_description when the token endpoint rejects the request", async () => {
    mockFetchOnce({ data: { error: "invalid_client", error_description: "Unknown client_id" } });
    await expect(fetchClientCredentialsToken(defaultOAuth2Config(), identityResolve)).rejects.toThrow("Unknown client_id");
  });

  it("omits scope/audience from the request when not configured", async () => {
    const fetchMock = mockFetchOnce({ data: { access_token: "t" } });
    await fetchClientCredentialsToken(defaultOAuth2Config(), identityResolve);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.data.scope).toBeUndefined();
    expect(body.data.audience).toBeUndefined();
  });
});

describe("exchangeAuthorizationCode", () => {
  it("includes code_verifier only when PKCE was used", async () => {
    const fetchMock = mockFetchOnce({ data: { access_token: "t" } });
    await exchangeAuthorizationCode(defaultOAuth2Config(), "auth_code_123", "verifier_xyz", identityResolve);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.data.grant_type).toBe("authorization_code");
    expect(body.data.code).toBe("auth_code_123");
    expect(body.data.code_verifier).toBe("verifier_xyz");
  });

  it("omits code_verifier when PKCE wasn't used", async () => {
    const fetchMock = mockFetchOnce({ data: { access_token: "t" } });
    await exchangeAuthorizationCode(defaultOAuth2Config(), "auth_code_123", null, identityResolve);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.data.code_verifier).toBeUndefined();
  });
});

describe("ensureOAuth2Token", () => {
  function reqWithOAuth2(overrides: Partial<ReturnType<typeof defaultOAuth2Config>>): ApiRequest {
    const req = createDefaultRequest("req_1");
    req.auth = { ...req.auth, type: "oauth2", oauth2: { ...defaultOAuth2Config(), ...overrides } };
    return req;
  }

  it("returns the cached token with no fetch call when it's unexpired", async () => {
    const fetchMock = mockFetchOnce({});
    const req = reqWithOAuth2({ accessToken: "cached_tok", expiresAt: Date.now() + 60_000 });

    const result = await ensureOAuth2Token(req, identityResolve);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result?.accessToken).toBe("cached_tok");
    expect(result?.oauth2Updates).toEqual({});
  });

  it("treats a null expiresAt as never-expiring — no fetch call", async () => {
    const fetchMock = mockFetchOnce({});
    const req = reqWithOAuth2({ accessToken: "cached_tok", expiresAt: null });

    await ensureOAuth2Token(req, identityResolve);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches a new client_credentials token when the cached one is within the clock-skew buffer of expiring", async () => {
    const fetchMock = mockFetchOnce({ data: { access_token: "fresh_tok", expires_in: 3600 } });
    const req = reqWithOAuth2({ accessToken: "stale_tok", expiresAt: Date.now() + 5_000, grantType: "client_credentials" });

    const result = await ensureOAuth2Token(req, identityResolve);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result?.accessToken).toBe("fresh_tok");
  });

  it("fetches a new client_credentials token when none is cached yet", async () => {
    const fetchMock = mockFetchOnce({ data: { access_token: "first_tok", expires_in: 3600 } });
    const req = reqWithOAuth2({ accessToken: "", expiresAt: null, grantType: "client_credentials" });

    const result = await ensureOAuth2Token(req, identityResolve);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result?.accessToken).toBe("first_tok");
  });

  it("never auto-refreshes an expired authorization_code token — returns it as-is with no fetch call", async () => {
    const fetchMock = mockFetchOnce({});
    const req = reqWithOAuth2({ accessToken: "expired_auth_code_tok", expiresAt: Date.now() - 1000, grantType: "authorization_code" });

    const result = await ensureOAuth2Token(req, identityResolve);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result?.accessToken).toBe("expired_auth_code_tok");
  });

  it("returns null when the request has no oauth2 config", async () => {
    const req = createDefaultRequest("req_1");
    // @ts-expect-error deliberately simulating a malformed/missing oauth2 config
    req.auth.oauth2 = undefined;
    const result = await ensureOAuth2Token(req, identityResolve);
    expect(result).toBeNull();
  });
});
