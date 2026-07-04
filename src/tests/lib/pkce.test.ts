import { describe, it, expect } from "vitest";
import { generateCodeVerifier, generateCodeChallenge, generateState } from "@/lib/pkce";

describe("generateCodeVerifier", () => {
  it("produces a base64url string within the RFC 7636 length bounds (43-128 chars)", () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it("only contains base64url-safe characters (no +, /, or = padding)", () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces distinct values across calls", () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });
});

describe("generateCodeChallenge", () => {
  it("matches the canonical RFC 7636 Appendix B S256 test vector", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = await generateCodeChallenge(verifier);
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("produces a base64url string with no padding", async () => {
    const challenge = await generateCodeChallenge(generateCodeVerifier());
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).not.toContain("=");
  });

  it("is deterministic for the same verifier", async () => {
    const verifier = generateCodeVerifier();
    expect(await generateCodeChallenge(verifier)).toBe(await generateCodeChallenge(verifier));
  });
});

describe("generateState", () => {
  it("produces distinct values across calls", () => {
    expect(generateState()).not.toBe(generateState());
  });

  it("only contains base64url-safe characters", () => {
    expect(generateState()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
