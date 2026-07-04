import type { ApiRequest, OAuth2Config } from "@/store/collectionStore";
import { generateCodeVerifier, generateCodeChallenge, generateState } from "@/lib/pkce";

export interface OAuth2TokenResult {
  accessToken: string;
  oauth2Updates: Partial<OAuth2Config>;
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

const CLOCK_SKEW_BUFFER_MS = 30_000;

/**
 * POSTs a token request through /api/seed — reusing the existing generic proxy
 * rather than a dedicated route, since it already avoids CORS for any URL/method/body.
 */
async function requestToken(url: string, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("/api/seed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      data: params,
    }),
  });
  const result = await res.json();
  if (result.error) {
    throw new Error(result.error);
  }
  const data = result.data as TokenResponse;
  if (data?.error) {
    throw new Error(data.error_description || data.error);
  }
  return data;
}

function toOAuth2Updates(data: TokenResponse, fallbackRefreshToken: string): { accessToken: string; oauth2Updates: Partial<OAuth2Config> } {
  const accessToken = data.access_token || "";
  return {
    accessToken,
    oauth2Updates: {
      accessToken,
      tokenType: data.token_type || "Bearer",
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
      refreshToken: data.refresh_token || fallbackRefreshToken,
    },
  };
}

/** Always fetches a fresh token — used by the manual "Get New Access Token" button. */
export async function fetchClientCredentialsToken(
  oauth2: OAuth2Config,
  resolve: (v: string) => string
): Promise<OAuth2TokenResult> {
  const data = await requestToken(resolve(oauth2.accessTokenUrl), {
    grant_type: "client_credentials",
    client_id: resolve(oauth2.clientId),
    client_secret: resolve(oauth2.clientSecret),
    ...(oauth2.scope ? { scope: resolve(oauth2.scope) } : {}),
    ...(oauth2.audience ? { audience: resolve(oauth2.audience) } : {}),
  });
  return toOAuth2Updates(data, oauth2.refreshToken);
}

/**
 * Exchanges an authorization code for a token — used both by the popup flow
 * and (in the future) by a refresh_token exchange.
 */
export async function exchangeAuthorizationCode(
  oauth2: OAuth2Config,
  code: string,
  codeVerifier: string | null,
  resolve: (v: string) => string
): Promise<OAuth2TokenResult> {
  const data = await requestToken(resolve(oauth2.accessTokenUrl), {
    grant_type: "authorization_code",
    code,
    redirect_uri: oauth2.redirectUri,
    client_id: resolve(oauth2.clientId),
    ...(oauth2.clientSecret ? { client_secret: resolve(oauth2.clientSecret) } : {}),
    ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
  });
  return toOAuth2Updates(data, oauth2.refreshToken);
}

interface OAuthCallbackMessage {
  source: string;
  code: string | null;
  state: string | null;
  error: string | null;
  errorDescription: string | null;
}

export const OAUTH_CALLBACK_MESSAGE_SOURCE = "beacon-oauth-callback";

function isCallbackMessage(data: unknown): data is OAuthCallbackMessage {
  return typeof data === "object" && data !== null && (data as { source?: unknown }).source === OAUTH_CALLBACK_MESSAGE_SOURCE;
}

/**
 * Runs the Authorization Code (+ optional PKCE) popup flow end-to-end: opens
 * the popup, waits for the same-origin callback page to postMessage the
 * result, validates origin/state, then exchanges the code for a token.
 *
 * Must be called directly from a user-gesture handler (e.g. a button's
 * onClick) — the popup is opened before any `await`, which keeps it inside
 * the synchronous call stack popup blockers look for.
 */
export async function runAuthorizationCodeFlow(
  oauth2: OAuth2Config,
  resolve: (v: string) => string
): Promise<OAuth2TokenResult> {
  const popup = window.open("about:blank", "beacon-oauth", "width=520,height=680");
  if (!popup) {
    throw new Error("Popup blocked — allow popups for this site and try again.");
  }

  const state = generateState();
  const codeVerifier = oauth2.usePkce ? generateCodeVerifier() : null;
  const codeChallenge = codeVerifier ? await generateCodeChallenge(codeVerifier) : null;
  const redirectUri = oauth2.redirectUri || `${window.location.origin}/oauth/callback`;

  const authUrl = new URL(resolve(oauth2.authorizationUrl));
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", resolve(oauth2.clientId));
  authUrl.searchParams.set("redirect_uri", redirectUri);
  if (oauth2.scope) authUrl.searchParams.set("scope", resolve(oauth2.scope));
  if (oauth2.audience) authUrl.searchParams.set("audience", resolve(oauth2.audience));
  authUrl.searchParams.set("state", state);
  if (codeChallenge) {
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
  }

  popup.location.href = authUrl.toString();

  const code = await new Promise<string>((resolvePromise, rejectPromise) => {
    let settled = false;

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      clearInterval(pollTimer);
    };

    const onMessage = (event: MessageEvent) => {
      // Only trust same-origin messages carrying our own tagged shape —
      // otherwise any other tab/frame could forge a code/state.
      if (event.origin !== window.location.origin || settled) return;
      if (!isCallbackMessage(event.data)) return;

      const msg = event.data;
      if (msg.state !== state) {
        settled = true;
        cleanup();
        rejectPromise(new Error("OAuth state mismatch — possible CSRF, aborting."));
      } else if (msg.error) {
        settled = true;
        cleanup();
        rejectPromise(new Error(msg.errorDescription || msg.error));
      } else if (msg.code) {
        settled = true;
        cleanup();
        resolvePromise(msg.code);
      }
    };

    window.addEventListener("message", onMessage);

    const pollTimer = setInterval(() => {
      if (popup.closed && !settled) {
        settled = true;
        cleanup();
        rejectPromise(new Error("Authorization window was closed before completing."));
      }
    }, 500);
  });

  return exchangeAuthorizationCode(oauth2, code, codeVerifier, resolve);
}

/**
 * Called automatically before sending a request with oauth2 auth. For
 * client_credentials, transparently fetches/refreshes the token when missing
 * or expired (30s clock-skew buffer) — no network call if the cached token is
 * still valid. Authorization Code tokens are never auto-refreshed here (that
 * requires a popup + user interaction); an expired one is returned as-is and
 * the UI surfaces a "re-authorize" prompt instead.
 */
export async function ensureOAuth2Token(
  req: ApiRequest,
  resolve: (v: string) => string
): Promise<OAuth2TokenResult | null> {
  const oauth2 = req.auth.oauth2;
  if (!oauth2) return null;

  const isValid = oauth2.accessToken && (oauth2.expiresAt === null || oauth2.expiresAt > Date.now() + CLOCK_SKEW_BUFFER_MS);
  if (isValid) {
    return { accessToken: oauth2.accessToken, oauth2Updates: {} };
  }

  if (oauth2.grantType === "authorization_code") {
    return { accessToken: oauth2.accessToken, oauth2Updates: {} };
  }

  return fetchClientCredentialsToken(oauth2, resolve);
}
