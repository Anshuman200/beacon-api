import { describe, it, expect } from "vitest";
import { hasFileEntry, findReservedKeyCollision, buildMultipartRequest } from "@/lib/multipartRequest";
import { PreparedRequest, ResolvedFormDataEntry } from "@/lib/requestRunner";

describe("hasFileEntry", () => {
  it("returns true when at least one entry is type file", () => {
    const entries: ResolvedFormDataEntry[] = [
      { key: "a", type: "text", value: "1" },
      { key: "upload", type: "file", file: new File(["x"], "x.txt") },
    ];
    expect(hasFileEntry(entries)).toBe(true);
  });

  it("returns false for text-only entries", () => {
    const entries: ResolvedFormDataEntry[] = [{ key: "a", type: "text", value: "1" }];
    expect(hasFileEntry(entries)).toBe(false);
  });

  it("returns false for non-array data (e.g. a JSON body object)", () => {
    expect(hasFileEntry({ query: "x" })).toBe(false);
    expect(hasFileEntry(null)).toBe(false);
    expect(hasFileEntry("plain string")).toBe(false);
  });
});

describe("findReservedKeyCollision", () => {
  it("detects a user field colliding with a reserved metadata key", () => {
    const entries: ResolvedFormDataEntry[] = [{ key: "__beacon_url", type: "text", value: "evil" }];
    expect(findReservedKeyCollision(entries)).toBe("__beacon_url");
  });

  it("returns null when no field collides", () => {
    const entries: ResolvedFormDataEntry[] = [{ key: "normal_field", type: "text", value: "x" }];
    expect(findReservedKeyCollision(entries)).toBeNull();
  });
});

describe("buildMultipartRequest", () => {
  it("carries url/method/contentType/headers as reserved metadata fields", () => {
    const prepared: PreparedRequest = {
      url: "https://api.example.com/upload",
      method: "POST",
      contentType: "multipart/form-data",
      headers: { "X-Custom": "1" },
      data: [{ key: "field", type: "text", value: "value1" }] as ResolvedFormDataEntry[],
    };
    const form = buildMultipartRequest(prepared);

    expect(form.get("__beacon_url")).toBe("https://api.example.com/upload");
    expect(form.get("__beacon_method")).toBe("POST");
    expect(form.get("__beacon_content_type")).toBe("multipart/form-data");
    expect(JSON.parse(form.get("__beacon_headers") as string)).toEqual({ "X-Custom": "1" });
  });

  it("appends text entries as strings and file entries as real File objects", () => {
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    const prepared: PreparedRequest = {
      url: "https://api.example.com/upload",
      method: "POST",
      contentType: "multipart/form-data",
      headers: {},
      data: [
        { key: "field", type: "text", value: "value1" },
        { key: "upload", type: "file", file },
      ] as ResolvedFormDataEntry[],
    };
    const form = buildMultipartRequest(prepared);

    expect(form.get("field")).toBe("value1");
    const uploaded = form.get("upload") as File;
    expect(uploaded).toBeInstanceOf(File);
    expect(uploaded.name).toBe("hello.txt");
  });
});
