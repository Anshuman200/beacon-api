import { describe, it, expect } from "vitest";
import { decodeJwtUnsafe, analyzeJwt, findAndAnalyzeJwts } from "@/lib/jwtInspector";

function base64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(header: object, payload: object): string {
  return `${base64url(header)}.${base64url(payload)}.fakesignature`;
}

describe("decodeJwtUnsafe", () => {
  it("decodes a well-formed JWT's header and payload", () => {
    const token = makeJwt({ alg: "HS256" }, { sub: "user1" });
    expect(decodeJwtUnsafe(token)).toEqual({ header: { alg: "HS256" }, payload: { sub: "user1" } });
  });

  it("returns null for a string that isn't three dot-separated segments", () => {
    expect(decodeJwtUnsafe("not-a-jwt")).toBeNull();
    expect(decodeJwtUnsafe("a.b")).toBeNull();
  });

  it("returns null when a segment isn't valid base64url JSON", () => {
    expect(decodeJwtUnsafe("not-json.not-json.sig")).toBeNull();
  });
});

describe("analyzeJwt", () => {
  const now = Math.floor(Date.now() / 1000);

  it("flags alg: none as high severity with fix guidance", () => {
    const token = makeJwt({ alg: "none" }, { exp: now + 3600, iat: now, iss: "x", aud: "y" });
    const findings = analyzeJwt(token, "test source");
    const finding = findings.find((f) => f.severity === "high" && f.title.includes("alg: none"));
    expect(finding).toBeTruthy();
    expect(finding?.recommendation).toMatch(/alg/i);
  });

  it("flags a missing exp claim", () => {
    const token = makeJwt({ alg: "HS256" }, { iat: now, iss: "x", aud: "y" });
    const findings = analyzeJwt(token, "test source");
    expect(findings.some((f) => f.title.includes("no exp claim"))).toBe(true);
  });

  it("flags an already-expired token", () => {
    const token = makeJwt({ alg: "HS256" }, { exp: now - 3600, iat: now - 7200, iss: "x", aud: "y" });
    const findings = analyzeJwt(token, "test source");
    expect(findings.some((f) => f.title.includes("is expired"))).toBe(true);
  });

  it("flags an unusually long lifetime", () => {
    const token = makeJwt({ alg: "HS256" }, { exp: now + 30 * 24 * 3600, iat: now, iss: "x", aud: "y" });
    const findings = analyzeJwt(token, "test source");
    expect(findings.some((f) => f.title.includes("unusually long lifetime"))).toBe(true);
  });

  it("flags missing iss/aud as info", () => {
    const token = makeJwt({ alg: "HS256" }, { exp: now + 3600, iat: now });
    const findings = analyzeJwt(token, "test source");
    expect(findings.some((f) => f.severity === "info" && f.title.includes("iss/aud"))).toBe(true);
  });

  it("flags sensitive-looking claim keys as high severity", () => {
    const token = makeJwt({ alg: "HS256" }, { exp: now + 3600, iat: now, iss: "x", aud: "y", password: "hunter2" });
    const findings = analyzeJwt(token, "test source");
    expect(findings.some((f) => f.severity === "high" && f.title.includes("sensitive-looking claims"))).toBe(true);
  });

  it("returns no findings for a well-formed, short-lived token with no issues", () => {
    const token = makeJwt({ alg: "HS256" }, { exp: now + 900, iat: now, iss: "x", aud: "y" });
    expect(analyzeJwt(token, "test source")).toEqual([]);
  });

  it("returns an empty array for a non-JWT string", () => {
    expect(analyzeJwt("not-a-jwt-at-all", "test source")).toEqual([]);
  });
});

describe("findAndAnalyzeJwts", () => {
  it("locates a JWT embedded in free text and analyzes it", () => {
    const token = makeJwt({ alg: "none" }, { exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), iss: "x", aud: "y" });
    const text = JSON.stringify({ access_token: token, other: "field" });
    const findings = findAndAnalyzeJwts(text, "response body");
    expect(findings.some((f) => f.title.includes("alg: none"))).toBe(true);
  });

  it("de-duplicates the same token appearing multiple times", () => {
    const token = makeJwt({ alg: "none" }, { exp: 1, iat: 1 });
    const text = `${token} ${token}`;
    const findings = findAndAnalyzeJwts(text, "response body");
    expect(findings.filter((f) => f.title.includes("alg: none")).length).toBe(1);
  });

  it("returns an empty array when no JWT-shaped substring is present", () => {
    expect(findAndAnalyzeJwts("plain text with no tokens", "response body")).toEqual([]);
  });
});
