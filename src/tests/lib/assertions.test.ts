import { describe, it, expect } from "vitest";
import { evaluateAssertions, getValueByPath, ProxyResponse } from "@/lib/assertions";
import { Assertion } from "@/store/collectionStore";

const baseResponse: ProxyResponse = {
  status: 200,
  statusText: "OK",
  headers: { "Content-Type": "application/json", "X-Request-Id": "abc123" },
  data: { success: true, items: [{ name: "first" }, { name: "second" }], count: 2 },
  responseTime: 120,
};

function makeAssertion(overrides: Partial<Assertion>): Assertion {
  return {
    id: "a1",
    target: "status_code",
    property: "",
    operator: "equals",
    value: "",
    ...overrides,
  };
}

describe("getValueByPath", () => {
  it("returns the root object for an empty or $ path", () => {
    expect(getValueByPath(baseResponse.data, "")).toBe(baseResponse.data);
    expect(getValueByPath(baseResponse.data, "$")).toBe(baseResponse.data);
  });

  it("resolves dotted paths", () => {
    expect(getValueByPath(baseResponse.data, "$.count")).toBe(2);
  });

  it("resolves array bracket notation", () => {
    expect(getValueByPath(baseResponse.data, "$.items[0].name")).toBe("first");
    expect(getValueByPath(baseResponse.data, "items[1].name")).toBe("second");
  });

  it("returns undefined for a path that doesn't exist", () => {
    expect(getValueByPath(baseResponse.data, "$.nope.nested")).toBeUndefined();
  });
});

describe("evaluateAssertions", () => {
  it("returns an empty array when assertions is missing or not an array", () => {
    expect(evaluateAssertions(baseResponse, undefined as unknown as Assertion[])).toEqual([]);
    expect(evaluateAssertions(baseResponse, null as unknown as Assertion[])).toEqual([]);
  });

  it("status_code + equals passes on a match and fails on a mismatch", () => {
    const pass = evaluateAssertions(baseResponse, [makeAssertion({ target: "status_code", operator: "equals", value: "200" })]);
    expect(pass[0].passed).toBe(true);

    const fail = evaluateAssertions(baseResponse, [makeAssertion({ target: "status_code", operator: "equals", value: "404" })]);
    expect(fail[0].passed).toBe(false);
    expect(fail[0].message).toContain("expected to equal");
  });

  it("response_time + less_than / greater_than", () => {
    const lt = evaluateAssertions(baseResponse, [makeAssertion({ target: "response_time", operator: "less_than", value: "1000" })]);
    expect(lt[0].passed).toBe(true);

    const gt = evaluateAssertions(baseResponse, [makeAssertion({ target: "response_time", operator: "greater_than", value: "1000" })]);
    expect(gt[0].passed).toBe(false);
  });

  it("content_type + contains is case-insensitive on the header name", () => {
    const result = evaluateAssertions(baseResponse, [makeAssertion({ target: "content_type", operator: "contains", value: "application/json" })]);
    expect(result[0].passed).toBe(true);
  });

  it("header target finds a header case-insensitively by property name", () => {
    const result = evaluateAssertions(baseResponse, [makeAssertion({ target: "header", property: "x-request-id", operator: "equals", value: "abc123" })]);
    expect(result[0].passed).toBe(true);
  });

  it("body_text + not_contains", () => {
    const result = evaluateAssertions(baseResponse, [makeAssertion({ target: "body_text", operator: "not_contains", value: "error" })]);
    expect(result[0].passed).toBe(true);
  });

  it("json_path + equals resolves nested values", () => {
    const result = evaluateAssertions(baseResponse, [makeAssertion({ target: "json_path", property: "$.items[0].name", operator: "equals", value: "first" })]);
    expect(result[0].passed).toBe(true);
  });

  it("exists passes when the value is present and fails when it's not, with a distinct message", () => {
    const found = evaluateAssertions(baseResponse, [makeAssertion({ target: "json_path", property: "$.count", operator: "exists", value: "" })]);
    expect(found[0].passed).toBe(true);

    const missing = evaluateAssertions(baseResponse, [makeAssertion({ target: "json_path", property: "$.nope", operator: "exists", value: "" })]);
    expect(missing[0].passed).toBe(false);
    expect(missing[0].message).toBe("JSON Path [$.nope] does not exist");
  });

  it("matches_regex passes on a match and fails gracefully on an invalid pattern", () => {
    const match = evaluateAssertions(baseResponse, [makeAssertion({ target: "body_text", operator: "matches_regex", value: '"success":\\s*true' })]);
    expect(match[0].passed).toBe(true);

    const invalidPattern = evaluateAssertions(baseResponse, [makeAssertion({ target: "body_text", operator: "matches_regex", value: "(unclosed" })]);
    expect(invalidPattern[0].passed).toBe(false);
  });
});
