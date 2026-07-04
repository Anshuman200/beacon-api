import type { ApiRequest, FormDataPair } from "@/store/collectionStore";
import type { SecurityFinding } from "@/lib/securityAnalysis";
import type { SendRequestFn } from "@/lib/securityProbes";

export type FileProbeKind = "doubleExtension" | "pathTraversalName" | "spoofedContentType" | "oversized";

export interface FileUploadProbeTarget {
  formKey: string;
}

const FILE_PROBE_LABEL: Record<FileProbeKind, string> = {
  doubleExtension: "Double extension filename",
  pathTraversalName: "Path traversal filename",
  spoofedContentType: "Spoofed Content-Type",
  oversized: "Oversized file",
};

const FILE_PROBE_RECOMMENDATION: Record<Exclude<FileProbeKind, "oversized">, string> = {
  doubleExtension: "Generate a random filename server-side (don't trust the client's filename) and validate the file's actual content/magic bytes, not just its extension.",
  pathTraversalName: "Never use the client-supplied filename directly in a filesystem path — generate a random filename server-side and store the original only as metadata.",
  spoofedContentType: "Validate the file's actual content (magic bytes) server-side instead of trusting the client-supplied Content-Type/extension.",
};

const OVERSIZED_FILE_BYTES = 6 * 1024 * 1024; // 6MB — large enough to trip most default upload limits

// Minimal valid-looking JPEG header bytes so a naive magic-byte sniff would
// also see plausible image data, even though the declared type below is not.
const FAKE_IMAGE_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function buildProbeFile(kind: FileProbeKind): File {
  switch (kind) {
    case "doubleExtension":
      return new File([FAKE_IMAGE_BYTES], "probe.jpg.php", { type: "image/jpeg" });
    case "pathTraversalName":
      return new File([FAKE_IMAGE_BYTES], "../../../etc/passwd", { type: "image/jpeg" });
    case "spoofedContentType":
      return new File([FAKE_IMAGE_BYTES], "probe.jpg", { type: "application/x-msdownload" });
    case "oversized":
      return new File([new Uint8Array(OVERSIZED_FILE_BYTES)], "probe-oversized.bin", { type: "application/octet-stream" });
  }
}

function substitute(req: ApiRequest, target: FileUploadProbeTarget, kind: FileProbeKind): ApiRequest {
  const file = buildProbeFile(kind);
  const formdata: FormDataPair[] = req.body.formdata.map((f) =>
    f.key === target.formKey ? { ...f, type: "file", file, value: file.name } : f
  );
  return { ...req, body: { ...req.body, formdata } };
}

let findingCounter = 0;
const nextId = () => `file_probe_finding_${Date.now()}_${(findingCounter++).toString(36)}`;

/**
 * One request per kind, targeting a single formdata file field. Findings are
 * intentionally worded as "worth a manual follow-up" — a 2xx response only
 * shows the upload was *accepted*, not that the file is stored/served/executed
 * unsafely, which this client-side tool has no way to confirm.
 */
export async function runFileUploadProbes(
  req: ApiRequest,
  target: FileUploadProbeTarget,
  kinds: FileProbeKind[],
  sendFn: SendRequestFn
): Promise<SecurityFinding[]> {
  const findings: SecurityFinding[] = [];

  for (const kind of kinds) {
    const probeReq = substitute(req, target, kind);
    const result = await sendFn(probeReq);
    const label = FILE_PROBE_LABEL[kind];

    if (result.status >= 200 && result.status < 300) {
      if (kind === "oversized") {
        findings.push({
          id: nextId(),
          category: "resource-consumption",
          severity: "low",
          title: `${label}: server accepted a ${(OVERSIZED_FILE_BYTES / 1024 / 1024).toFixed(0)}MB upload`,
          description: "No visible size-limit rejection (expected 413) — worth confirming the server enforces a maximum upload size.",
          recommendation: "Enforce a maximum request/file size at the proxy or framework level and return 413 Payload Too Large beyond it.",
        });
      } else {
        findings.push({
          id: nextId(),
          category: "request-hygiene",
          severity: "medium",
          title: `${label}: server accepted the file without visible rejection`,
          description: `A file crafted to test "${label.toLowerCase()}" was accepted with ${result.status}. Worth a manual follow-up: confirm the server doesn't store or serve this filename/type as-is.`,
          recommendation: FILE_PROBE_RECOMMENDATION[kind],
        });
      }
    }
  }

  return findings;
}
