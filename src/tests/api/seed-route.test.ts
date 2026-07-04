import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import axios from "axios";
import dns from "node:dns/promises";

vi.mock("axios", () => ({ default: vi.fn() }));
const mockedAxios = vi.mocked(axios);

// The egress guard resolves hostnames via real DNS before allowing a request
// through — mock it so tests are hermetic/fast, defaulting to a safe public
// IP so every existing test (which uses placeholder hostnames like
// api.example.com) keeps passing without needing to know about the guard.
vi.mock("node:dns/promises", () => ({ default: { lookup: vi.fn() } }));
const mockedDnsLookup = vi.mocked(dns.lookup);

import { POST } from "@/app/api/seed/route";

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/seed", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function axiosResponse(overrides: Partial<{ status: number; statusText: string; headers: Record<string, string>; data: unknown }> = {}) {
  return { status: 200, statusText: "OK", headers: {}, data: { ok: true }, ...overrides };
}

beforeEach(() => {
  mockedAxios.mockReset();
  mockedDnsLookup.mockReset();
  // @ts-expect-error — overload resolution for the `{all:true}` shape isn't picked up from a plain mockResolvedValue
  mockedDnsLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});

describe("POST /api/seed — JSON path", () => {
  it("relays a request and returns the upstream status/data/headers/responseTime", async () => {
    mockedAxios.mockResolvedValue(axiosResponse({ data: { hello: "world" } }));

    const res = await POST(jsonRequest({ url: "https://api.example.com/data", method: "GET" }));
    const json = await res.json();

    expect(json.status).toBe(200);
    expect(json.data).toEqual({ hello: "world" });
    expect(typeof json.responseTime).toBe("number");
  });

  it("builds the target url from baseUrl + endpoint when url isn't given directly", async () => {
    mockedAxios.mockResolvedValue(axiosResponse());
    await POST(jsonRequest({ baseUrl: "https://api.example.com/", endpoint: "/users", method: "GET" }));

    expect(mockedAxios).toHaveBeenCalledWith(expect.objectContaining({ url: "https://api.example.com/users" }));
  });

  it("returns 500 with an error message when neither url nor baseUrl+endpoint is provided", async () => {
    const res = await POST(jsonRequest({ method: "GET" }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain("required");
    expect(mockedAxios).not.toHaveBeenCalled();
  });

  it("custom headers override the default ones", async () => {
    mockedAxios.mockResolvedValue(axiosResponse());
    await POST(jsonRequest({ url: "https://api.example.com/data", headers: { "User-Agent": "custom-agent" } }));

    const call = mockedAxios.mock.calls[0][0] as unknown as { headers: Record<string, string> };
    expect(call.headers["User-Agent"]).toBe("custom-agent");
  });

  it("serializes a plain-object urlencoded payload into a query string body", async () => {
    mockedAxios.mockResolvedValue(axiosResponse());
    await POST(jsonRequest({
      url: "https://api.example.com/login",
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      data: { username: "alice", password: "secret" },
    }));

    const call = mockedAxios.mock.calls[0][0] as unknown as { data: string };
    expect(call.data).toBe("username=alice&password=secret");
  });
});

describe("POST /api/seed — multipart path (real file uploads)", () => {
  function multipartRequest(fields: Record<string, string | File>): NextRequest {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return new NextRequest("http://localhost/api/seed", { method: "POST", body: form });
  }

  it("strips reserved __beacon_* fields from the outbound payload and relays everything else", async () => {
    mockedAxios.mockResolvedValue(axiosResponse());
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });

    await POST(multipartRequest({
      __beacon_url: "https://api.example.com/upload",
      __beacon_method: "POST",
      __beacon_content_type: "multipart/form-data",
      __beacon_headers: "{}",
      field: "value1",
      upload: file,
    }));

    const call = mockedAxios.mock.calls[0][0] as unknown as { url: string; data: FormData; headers: Record<string, string> };
    expect(call.url).toBe("https://api.example.com/upload");
    expect(call.data.get("__beacon_url")).toBeNull();
    expect(call.data.get("field")).toBe("value1");
    expect((call.data.get("upload") as File).name).toBe("hello.txt");
    // Content-Type is deleted so axios can compute its own multipart boundary.
    expect(call.headers["Content-Type"]).toBeUndefined();
  });

  it("returns 400 when the multipart request carries no target url", async () => {
    const res = await POST(multipartRequest({ __beacon_method: "POST", field: "value1" }));
    expect(res.status).toBe(400);
    expect(mockedAxios).not.toHaveBeenCalled();
  });
});

describe("POST /api/seed — egress guard (SSRF hardening)", () => {
  it("allows a normal public URL through (baseline — guard doesn't false-positive)", async () => {
    mockedAxios.mockResolvedValue(axiosResponse());
    const res = await POST(jsonRequest({ url: "https://api.example.com/data", method: "GET" }));
    expect(res.status).toBe(200);
    expect(mockedAxios).toHaveBeenCalledTimes(1);
  });

  it("blocks a literal cloud-metadata target with a structured 400, never reaching axios", async () => {
    const res = await POST(jsonRequest({ url: "http://169.254.169.254/latest/meta-data/", method: "GET" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe("blocked_private_ip");
    expect(mockedAxios).not.toHaveBeenCalled();
  });

  it("blocks a literal loopback/private target (127.0.0.1, 10.x, 192.168.x)", async () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.1"]) {
      mockedAxios.mockClear();
      const res = await POST(jsonRequest({ url: `http://${ip}/`, method: "GET" }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe("blocked_private_ip");
      expect(mockedAxios).not.toHaveBeenCalled();
    }
  });

  it("blocks a hostname that DNS resolves to a private IP", async () => {
    // @ts-expect-error — same overload-resolution note as the default mock above
    mockedDnsLookup.mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }]);

    const res = await POST(jsonRequest({ url: "https://internal.evil.example.com/", method: "GET" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe("blocked_private_ip");
    expect(mockedAxios).not.toHaveBeenCalled();
  });

  it("blocks a redirect from an allowed public host to a private IP, without following it", async () => {
    mockedAxios.mockResolvedValueOnce({
      status: 302,
      statusText: "Found",
      headers: { location: "http://169.254.169.254/secret" },
      data: null,
    });

    const res = await POST(jsonRequest({ url: "https://api.example.com/redirect-me", method: "GET" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe("blocked_private_ip");
    // The first hop (public, allowed) was requested; the guard must have
    // caught the redirect target before a second axios call was ever made.
    expect(mockedAxios).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-http(s) scheme (e.g. file://) with a structured 400", async () => {
    const res = await POST(jsonRequest({ url: "file:///etc/passwd", method: "GET" }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.code).toBe("invalid_scheme");
    expect(mockedAxios).not.toHaveBeenCalled();
  });
});
