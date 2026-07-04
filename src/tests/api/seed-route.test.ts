import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import axios from "axios";

vi.mock("axios", () => ({ default: vi.fn() }));
const mockedAxios = vi.mocked(axios);

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
