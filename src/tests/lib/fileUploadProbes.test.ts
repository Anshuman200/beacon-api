import { describe, it, expect } from "vitest";
import { runFileUploadProbes, FileProbeKind } from "@/lib/fileUploadProbes";
import { createDefaultRequest, ApiRequest } from "@/store/collectionStore";
import type { ProbeResponse, SendRequestFn } from "@/lib/securityProbes";

function makeRequestWithFileField(): ApiRequest {
  const req = createDefaultRequest("req_test", "Upload Test");
  return {
    ...req,
    body: {
      ...req.body,
      type: "formdata",
      formdata: [{ key: "upload", type: "file", value: "", enabled: true }],
    },
  };
}

function okResponse(): ProbeResponse {
  return { status: 200, statusText: "OK", headers: {}, data: { ok: true }, responseTime: 10 };
}

function rejectedResponse(): ProbeResponse {
  return { status: 415, statusText: "Unsupported Media Type", headers: {}, data: { error: "rejected" }, responseTime: 10 };
}

describe("runFileUploadProbes", () => {
  const kinds: FileProbeKind[] = ["doubleExtension", "pathTraversalName", "spoofedContentType", "oversized"];

  it("sends one request per kind, substituting a distinct File into the targeted field", async () => {
    const req = makeRequestWithFileField();
    const sentFiles: File[] = [];
    const sendFn: SendRequestFn = async (r) => {
      const entry = r.body.formdata.find((f) => f.key === "upload");
      if (entry?.file) sentFiles.push(entry.file);
      return okResponse();
    };

    await runFileUploadProbes(req, { formKey: "upload" }, kinds, sendFn);

    expect(sentFiles).toHaveLength(4);
    expect(sentFiles.map((f) => f.name)).toEqual([
      "probe.jpg.php",
      "../../../etc/passwd",
      "probe.jpg",
      "probe-oversized.bin",
    ]);
    expect(sentFiles[2].type).toBe("application/x-msdownload");
    expect(sentFiles[3].size).toBeGreaterThan(1024 * 1024);
  });

  it("flags a finding when the server accepts a suspicious file without rejection", async () => {
    const req = makeRequestWithFileField();
    const findings = await runFileUploadProbes(req, { formKey: "upload" }, ["doubleExtension"], async () => okResponse());
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("medium");
    expect(findings[0].title).toContain("Double extension");
  });

  it("uses low severity (not medium) for an accepted oversized file", async () => {
    const req = makeRequestWithFileField();
    const findings = await runFileUploadProbes(req, { formKey: "upload" }, ["oversized"], async () => okResponse());
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("low");
  });

  it("produces no findings when the server correctly rejects every probe", async () => {
    const req = makeRequestWithFileField();
    const findings = await runFileUploadProbes(req, { formKey: "upload" }, kinds, async () => rejectedResponse());
    expect(findings).toEqual([]);
  });

  it("leaves other formdata fields untouched", async () => {
    const req = makeRequestWithFileField();
    req.body.formdata.push({ key: "description", type: "text", value: "hello", enabled: true });
    let seenDescription: string | undefined;
    const sendFn: SendRequestFn = async (r) => {
      seenDescription = r.body.formdata.find((f) => f.key === "description")?.value;
      return okResponse();
    };
    await runFileUploadProbes(req, { formKey: "upload" }, ["doubleExtension"], sendFn);
    expect(seenDescription).toBe("hello");
  });
});
