import { NextRequest, NextResponse } from "next/server";

// GET /api/demo/echo — Echo back request info (great for debugging headers & params)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const params: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    params[key] = value;
  });

  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const delay = parseInt(searchParams.get("delay") || "0", 10);
  if (delay > 0 && delay <= 5000) {
    await new Promise((r) => setTimeout(r, delay));
  }

  return NextResponse.json({
    success: true,
    message: "Echo endpoint — your request is reflected back",
    echo: {
      method: "GET",
      params,
      headers,
      timestamp: new Date().toISOString(),
    },
  });
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const params: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    params[key] = value;
  });

  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const body = await req.json().catch(() => null);

  const delay = parseInt(searchParams.get("delay") || "0", 10);
  if (delay > 0 && delay <= 5000) {
    await new Promise((r) => setTimeout(r, delay));
  }

  return NextResponse.json({
    success: true,
    message: "Echo endpoint — your request is reflected back",
    echo: {
      method: "POST",
      params,
      headers,
      body,
      timestamp: new Date().toISOString(),
    },
  });
}
