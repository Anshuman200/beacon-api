import type { PreparedRequest, ResolvedFormDataEntry } from "@/lib/requestRunner";

// Reserved field names carrying request metadata alongside the actual form
// fields on the outgoing multipart body — /api/seed's route handler reads
// these to know where/how to relay the request, then rebuilds a clean
// FormData from everything else before forwarding it upstream.
const RESERVED_PREFIX = "__beacon_";

export function hasFileEntry(data: unknown): data is ResolvedFormDataEntry[] {
  return Array.isArray(data) && data.some((d) => d && typeof d === "object" && (d as { type?: string }).type === "file");
}

/** A user-defined field key colliding with our reserved metadata fields would be silently overwritten. */
export function findReservedKeyCollision(entries: ResolvedFormDataEntry[]): string | null {
  return entries.find((e) => e.key.startsWith(RESERVED_PREFIX))?.key ?? null;
}

export function buildMultipartRequest(prepared: PreparedRequest): FormData {
  const entries = prepared.data as ResolvedFormDataEntry[];
  const form = new FormData();

  form.append(`${RESERVED_PREFIX}url`, prepared.url);
  form.append(`${RESERVED_PREFIX}method`, prepared.method);
  form.append(`${RESERVED_PREFIX}content_type`, prepared.contentType);
  form.append(`${RESERVED_PREFIX}headers`, JSON.stringify(prepared.headers));

  for (const entry of entries) {
    if (entry.type === "file") {
      form.append(entry.key, entry.file);
    } else {
      form.append(entry.key, entry.value);
    }
  }

  return form;
}
