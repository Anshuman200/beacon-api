import { describe, it, expect } from "vitest";
import { resolveTemplates } from "@/lib/variables";
import { Environment, KeyValuePair } from "@/store/collectionStore";

const kv = (key: string, value: string, enabled = true): KeyValuePair => ({ key, value, enabled });

describe("resolveTemplates", () => {
  it("returns an empty string for empty/undefined input", () => {
    expect(resolveTemplates("", null, null)).toBe("");
  });

  it("leaves text with no templates unchanged", () => {
    expect(resolveTemplates("https://example.com/path", null, null)).toBe("https://example.com/path");
  });

  it("leaves an unresolved {{var}} untouched when the key isn't found anywhere", () => {
    expect(resolveTemplates("{{missing}}", null, null)).toBe("{{missing}}");
  });

  it("resolves from the active environment", () => {
    const activeEnv: Environment = { id: "e1", name: "Active", variables: [kv("host", "active.example.com")] };
    expect(resolveTemplates("{{host}}", activeEnv, null)).toBe("active.example.com");
  });

  it("falls back to globals when not in the active environment", () => {
    const activeEnv: Environment = { id: "e1", name: "Active", variables: [] };
    const globals: Environment = { id: "env_globals", name: "Globals", variables: [kv("host", "global.example.com")] };
    expect(resolveTemplates("{{host}}", activeEnv, globals)).toBe("global.example.com");
  });

  it("falls back to collection variables when not in env or globals", () => {
    const collectionVars = [kv("host", "collection.example.com")];
    expect(resolveTemplates("{{host}}", null, null, collectionVars)).toBe("collection.example.com");
  });

  it("active environment takes precedence over globals", () => {
    const activeEnv: Environment = { id: "e1", name: "Active", variables: [kv("host", "active.example.com")] };
    const globals: Environment = { id: "env_globals", name: "Globals", variables: [kv("host", "global.example.com")] };
    expect(resolveTemplates("{{host}}", activeEnv, globals)).toBe("active.example.com");
  });

  it("globals take precedence over collection variables", () => {
    const globals: Environment = { id: "env_globals", name: "Globals", variables: [kv("host", "global.example.com")] };
    const collectionVars = [kv("host", "collection.example.com")];
    expect(resolveTemplates("{{host}}", null, globals, collectionVars)).toBe("global.example.com");
  });

  it("active environment takes precedence over collection variables", () => {
    const activeEnv: Environment = { id: "e1", name: "Active", variables: [kv("host", "active.example.com")] };
    const collectionVars = [kv("host", "collection.example.com")];
    expect(resolveTemplates("{{host}}", activeEnv, null, collectionVars)).toBe("active.example.com");
  });

  it("skips disabled variables at every level", () => {
    const activeEnv: Environment = { id: "e1", name: "Active", variables: [kv("host", "active.example.com", false)] };
    const globals: Environment = { id: "env_globals", name: "Globals", variables: [kv("host", "global.example.com")] };
    expect(resolveTemplates("{{host}}", activeEnv, globals)).toBe("global.example.com");
  });

  it("resolves multiple templates in the same string", () => {
    const activeEnv: Environment = { id: "e1", name: "Active", variables: [kv("scheme", "https"), kv("host", "example.com")] };
    expect(resolveTemplates("{{scheme}}://{{host}}/api", activeEnv, null)).toBe("https://example.com/api");
  });

  it("trims whitespace inside the template braces", () => {
    const activeEnv: Environment = { id: "e1", name: "Active", variables: [kv("host", "example.com")] };
    expect(resolveTemplates("{{ host }}", activeEnv, null)).toBe("example.com");
  });
});
