"use client";

import { useEffect, useState } from "react";
import { OAUTH_CALLBACK_MESSAGE_SOURCE } from "@/lib/oauth2";

export default function OAuthCallbackPage() {
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error");
    const errorDescription = params.get("error_description");

    if (window.opener) {
      window.opener.postMessage(
        { source: OAUTH_CALLBACK_MESSAGE_SOURCE, code, state, error, errorDescription },
        window.location.origin
      );
    }

    // Some browsers block a script-initiated close if there's any doubt the
    // window wasn't opened by script — it was (via window.open in oauth2.ts),
    // but keep a visible fallback in case it's blocked anyway.
    window.close();
    const t = setTimeout(() => setClosed(true), 300);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "sans-serif", color: "#64748b" }}>
      <p>{closed ? "You can close this window now." : "Authenticating…"}</p>
    </div>
  );
}
