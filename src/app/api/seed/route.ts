import { NextRequest, NextResponse } from "next/server";
import axios, { AxiosError } from "axios";
import net from "node:net";
import { checkEgressAllowed, EgressBlockReason } from "@/lib/egressGuard";

/**
 * Thrown when a target (the initial URL or a redirect hop) fails the egress
 * guard — caught specially in the route handler to return a structured 400
 * instead of the generic 500 used for upstream request failures.
 */
class EgressBlockedError extends Error {
  reason: EgressBlockReason;
  constructor(reason: EgressBlockReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

/**
 * Pins the actual TCP connection to the exact IP(s) already validated by the
 * egress guard, instead of letting Node re-resolve the hostname when it
 * connects. Without this, a DNS-rebinding attacker could return a safe IP for
 * our check and a private one moments later for the real connection — the
 * `lookup` option is honored by Node's http/https client for the connection
 * itself, while TLS SNI/cert validation still uses the original hostname, so
 * this is transparent for legitimate targets.
 */
type LookupAddress = { address: string; family: 4 | 6 };
type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: 4 | 6) => void;

function familyOf(address: string): 4 | 6 {
  return net.isIP(address) === 6 ? 6 : 4;
}

function pinnedLookup(validatedIps: string[]) {
  return (hostname: string, options: { all?: boolean } | LookupCallback, callback?: LookupCallback) => {
    const cb = typeof options === "function" ? options : callback!;
    const wantsAll = typeof options === "object" && !!options.all;
    if (wantsAll) {
      cb(null, validatedIps.map((address) => ({ address, family: familyOf(address) })));
    } else {
      const address = validatedIps[0];
      cb(null, address, familyOf(address));
    }
  };
}

// ── Recursively follow redirects while preserving the HTTP method ──────────────
// axios (and browsers) convert POST → GET on 301/302 redirects (RFC 7231 §6.4).
// We override that so POST stays POST through the entire redirect chain.
async function makeRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  payload: unknown,
  hopsLeft = 5
): Promise<{
  status: number;
  statusText: string;
  data: unknown;
  headers: Record<string, string>;
  redirectChain: string[];
}> {
  const redirectChain: string[] = [];

  // Re-run on every hop (this function recurses per redirect below), not just
  // the first request — an SSRF guard that only checks the initial URL is
  // trivially bypassed by a 302 to an internal address.
  const guard = await checkEgressAllowed(url);
  if (!guard.allowed) {
    throw new EgressBlockedError(guard.reason!, guard.message || "Target address is not allowed.");
  }

  const response = await axios({
    method,
    url,
    headers,
    data: ["GET", "HEAD"].includes(method.toUpperCase()) ? undefined : payload,
    timeout: 30_000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: () => true, // never throw on HTTP errors
    maxRedirects: 0,            // we handle redirects ourselves
    decompress: true,
    lookup: pinnedLookup(guard.resolvedIps!),
  });

  // ── Follow redirect preserving method ─────────────────────────────────────
  if (
    [301, 302, 307, 308].includes(response.status) &&
    response.headers["location"] &&
    hopsLeft > 0
  ) {
    const location = response.headers["location"] as string;
    // Resolve relative redirect URLs
    const nextUrl = location.startsWith("http")
      ? location
      : new URL(location, url).toString();

    redirectChain.push(`${response.status} → ${nextUrl}`);

    // 303 must become GET; everything else keeps original method
    const nextMethod = response.status === 303 ? "GET" : method;
    const nextPayload = response.status === 303 ? undefined : payload;

    const inner = await makeRequest(nextMethod, nextUrl, headers, nextPayload, hopsLeft - 1);
    return { ...inner, redirectChain: [...redirectChain, ...inner.redirectChain] };
  }

  return {
    status: response.status,
    statusText: response.statusText,
    data: response.data,
    headers: Object.fromEntries(
      Object.entries(response.headers).map(([k, v]) => [k, String(v)])
    ),
    redirectChain,
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────
interface RequestPayloadItem {
  key: string;
  value?: string;
  enabled?: boolean;
}

interface ParsedRequestBody {
  url: string;
  method: string;
  contentType: string | undefined;
  customHeaders: Record<string, string>;
  data: unknown;
}

const RESERVED_PREFIX = "__beacon_";

/**
 * Real file uploads arrive as a native multipart/form-data body (a File
 * object can't survive JSON.stringify) — reserved __beacon_* fields carry the
 * target url/method/contentType/headers alongside the actual form fields.
 */
async function parseMultipartBody(req: NextRequest): Promise<{ parsed: ParsedRequestBody; outboundForm: FormData }> {
  const form = await req.formData();
  const url = String(form.get(`${RESERVED_PREFIX}url`) || "");
  const method = String(form.get(`${RESERVED_PREFIX}method`) || "POST");
  const contentType = String(form.get(`${RESERVED_PREFIX}content_type`) || "multipart/form-data");
  const customHeaders = JSON.parse(String(form.get(`${RESERVED_PREFIX}headers`) || "{}"));

  const outboundForm = new FormData();
  for (const [key, value] of form.entries()) {
    if (key.startsWith(RESERVED_PREFIX)) continue;
    outboundForm.append(key, value);
  }

  return { parsed: { url, method, contentType, customHeaders, data: null }, outboundForm };
}

async function parseJsonBody(req: NextRequest): Promise<ParsedRequestBody> {
  const body = await req.json();
  const { baseUrl, endpoint, method = "POST", contentType, headers: customHeaders, data } = body;

  let url = body.url;
  if (!url) {
    if (!baseUrl || !endpoint) {
      throw new Error("baseUrl and endpoint (or url) are required");
    }
    url = `${baseUrl.replace(/\/$/, "")}/${endpoint.replace(/^\//, "")}`;
  }

  return { url, method, contentType, customHeaders: customHeaders || {}, data };
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  try {
    const incomingContentType = req.headers.get("content-type") || "";
    const isMultipart = incomingContentType.startsWith("multipart/form-data");

    const { parsed, outboundForm } = isMultipart
      ? await parseMultipartBody(req)
      : { parsed: await parseJsonBody(req), outboundForm: null };

    const { url, method, contentType, customHeaders, data } = parsed;
    if (!url) {
      return NextResponse.json({ error: "baseUrl and endpoint (or url) are required" }, { status: 400 });
    }

    // Derive origin so nginx/proxy treats this as a legit browser request
    const origin = new URL(url).origin;

    const headers: Record<string, string> = {
      "Content-Type"   : contentType || "application/json",
      "Accept"         : "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Origin"         : origin,
      "Referer"        : `${origin}/`,
      "User-Agent"     : "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Cache-Control"  : "no-cache",
      "Pragma"         : "no-cache",
      // Custom headers override the above
      ...customHeaders,
    };

    let payload: unknown = outboundForm ?? data;

    if (outboundForm) {
      // Let axios compute its own multipart boundary header.
      delete headers["Content-Type"];
    } else if (contentType === "application/x-www-form-urlencoded") {
      // Handle structured URL-encoded payloads (array of {key,value,enabled} or a plain object)
      if (Array.isArray(data)) {
        const params = new URLSearchParams();
        data.forEach((item: RequestPayloadItem) => {
          if (item && item.enabled !== false && item.key) {
            params.append(item.key, item.value || "");
          }
        });
        payload = params.toString();
      } else if (typeof data === "object" && data !== null) {
        payload = new URLSearchParams(data as Record<string, string>).toString();
      }
    } else if (contentType?.startsWith("multipart/form-data")) {
      // Legacy JSON-path multipart (text-only fields, no real files)
      if (Array.isArray(data)) {
        const form = new FormData();
        data.forEach((item: RequestPayloadItem) => {
          if (item && item.enabled !== false && item.key) {
            form.append(item.key, item.value || "");
          }
        });
        delete headers["Content-Type"];
        payload = form;
      }
    }

    const result = await makeRequest(method, url, headers, payload);
    const responseTime = Date.now() - startTime;

    return NextResponse.json({
      status       : result.status,
      statusText   : result.statusText,
      data         : result.data,
      headers      : result.headers,
      redirectChain: result.redirectChain,
      responseTime : responseTime,
    });
  } catch (err) {
    if (err instanceof EgressBlockedError) {
      const responseTime = Date.now() - startTime;
      return NextResponse.json(
        { error: err.message, code: err.reason, responseTime },
        { status: 400 }
      );
    }
    const e = err as AxiosError;
    const responseTime = Date.now() - startTime;
    return NextResponse.json(
      { error: e.message || "Request failed", code: e.code, responseTime },
      { status: 500 }
    );
  }
}

