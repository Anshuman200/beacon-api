import { NextRequest, NextResponse } from "next/server";
import axios, { AxiosError } from "axios";

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

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  try {
    const body = await req.json();
    const { baseUrl, endpoint, method = "POST", contentType, headers: customHeaders, data } = body;

    let url = body.url;
    if (!url) {
      if (!baseUrl || !endpoint) {
        return NextResponse.json({ error: "baseUrl and endpoint (or url) are required" }, { status: 400 });
      }
      url = `${baseUrl.replace(/\/$/, "")}/${endpoint.replace(/^\//, "")}`;
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

    let payload = data;

    // Handle structured URL-encoded and Multipart Form Data
    if (contentType === "application/x-www-form-urlencoded") {
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
      if (Array.isArray(data)) {
        const form = new FormData();
        data.forEach((item: RequestPayloadItem) => {
          if (item && item.enabled !== false && item.key) {
            form.append(item.key, item.value || "");
          }
        });
        // Delete Content-Type so Axios handles the multipart boundary header creation automatically
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
    const e = err as AxiosError;
    const responseTime = Date.now() - startTime;
    return NextResponse.json(
      { error: e.message || "Request failed", code: e.code, responseTime },
      { status: 500 }
    );
  }
}

