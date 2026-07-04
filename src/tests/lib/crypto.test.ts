// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, it, expect, vi } from "vitest";
import { encryptData, decryptData } from "@/lib/crypto";

describe("encryptData / decryptData", () => {
  it("round-trips a string through AES-GCM encryption", async () => {
    const plaintext = "the quick brown fox";
    const encrypted = await encryptData(plaintext);

    expect(encrypted).not.toBe(plaintext); // confirms real encryption happened, not the passthrough fallback
    expect(await decryptData(encrypted)).toBe(plaintext);
  });

  it("round-trips a JSON blob (the actual shape this protects — a serialized zustand store)", async () => {
    const payload = JSON.stringify({ state: { collections: [{ id: "col_1" }] }, version: 3 });
    const encrypted = await encryptData(payload);
    expect(await decryptData(encrypted)).toBe(payload);
  });

  it("produces different ciphertext for the same plaintext each time (random IV)", async () => {
    const a = await encryptData("same input");
    const b = await encryptData("same input");
    expect(a).not.toBe(b);
  });

  it("fails closed on tampered ciphertext instead of returning garbage or throwing", async () => {
    const encrypted = await encryptData("sensitive data");
    const tampered = encrypted.slice(0, -4) + "XXXX";
    // Tampered AES-GCM ciphertext fails auth-tag verification; decryptData catches
    // that and returns "null" (a safe, parseable placeholder) rather than crashing
    // or silently returning corrupted plaintext.
    const result = await decryptData(tampered);
    expect(result).not.toBe("sensitive data");
  });

  it("reuses the cached key across multiple calls in the same session (no repeated key generation)", async () => {
    await encryptData("warm the cache");
    const generateKeySpy = vi.spyOn(window.crypto.subtle, "generateKey");

    await encryptData("second call");
    await encryptData("third call");

    expect(generateKeySpy).not.toHaveBeenCalled();
    generateKeySpy.mockRestore();
  });

  it("treats an empty ciphertext as a no-op for decryptData", async () => {
    expect(await decryptData("")).toBe("");
  });
});
