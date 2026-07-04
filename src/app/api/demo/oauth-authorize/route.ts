import { NextRequest, NextResponse } from "next/server";

// GET /api/demo/oauth-authorize — Mock OAuth2 authorization endpoint. Pairs
// with /api/demo/oauth-token to let the Authorization Code + PKCE flow be
// tried end-to-end without a real IdP: simulates instant user consent by
// redirecting straight back to redirect_uri with a fake code.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const redirectUri = searchParams.get("redirect_uri");
  const state = searchParams.get("state");

  if (!redirectUri) {
    return NextResponse.json({ error: "invalid_request", error_description: "redirect_uri is required" }, { status: 400 });
  }

  const callback = new URL(redirectUri);
  callback.searchParams.set("code", "demo_auth_code_" + Math.random().toString(36).slice(2, 12));
  if (state) callback.searchParams.set("state", state);

  return NextResponse.redirect(callback.toString());
}
