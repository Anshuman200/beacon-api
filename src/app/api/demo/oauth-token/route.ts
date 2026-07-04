import { NextRequest, NextResponse } from "next/server";

// POST /api/demo/oauth-token — Mock OAuth2 token endpoint for trying out the
// Client Credentials / Authorization Code grant types against a real (if
// fake) IdP without needing external credentials.
export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") || "";
  let params: Record<string, string> = {};

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    params = Object.fromEntries(new URLSearchParams(text));
  } else if (contentType.includes("application/json")) {
    params = await req.json().catch(() => ({}));
  }

  const grantType = params.grant_type;
  if (grantType !== "client_credentials" && grantType !== "authorization_code") {
    return NextResponse.json(
      { error: "unsupported_grant_type", error_description: "grant_type must be client_credentials or authorization_code" },
      { status: 400 }
    );
  }
  if (!params.client_id) {
    return NextResponse.json({ error: "invalid_client", error_description: "client_id is required" }, { status: 401 });
  }
  if (grantType === "authorization_code" && !params.code) {
    return NextResponse.json({ error: "invalid_grant", error_description: "code is required" }, { status: 400 });
  }

  return NextResponse.json({
    access_token: "demo_" + grantType + "_" + Math.random().toString(36).slice(2, 18),
    token_type: "Bearer",
    expires_in: 3600,
    scope: params.scope || "",
  });
}
