import { resolveTemplates } from "@/lib/variables";
import { ApiRequest, Environment } from "@/store/collectionStore";

export interface PreparedRequest {
  url: string;
  method: string;
  contentType: string;
  headers: Record<string, string>;
  data: unknown;
}

/**
 * Resolves env templates and formats request components for execution
 */
export function prepareRequest(
  req: ApiRequest,
  activeEnv: Environment | null,
  globalsEnv: Environment | null
): PreparedRequest {
  const resolve = (val: string) => resolveTemplates(val, activeEnv, globalsEnv);

  // 1. Resolve URL base and path
  const resolvedBaseUrl = resolve(req.baseUrl || "").replace(/\/$/, "");
  const resolvedEndpoint = resolve(req.endpoint || "").replace(/^\//, "");
  let fullUrl = resolvedEndpoint 
    ? `${resolvedBaseUrl}/${resolvedEndpoint}` 
    : resolvedBaseUrl;

  // 2. Resolve query parameters
  const activeParams = req.params?.filter((p) => p.enabled && p.key.trim()) || [];
  if (activeParams.length > 0) {
    const searchParams = new URLSearchParams();
    activeParams.forEach((p) => {
      searchParams.append(resolve(p.key), resolve(p.value));
    });
    const connector = fullUrl.includes("?") ? "&" : "?";
    fullUrl += `${connector}${searchParams.toString()}`;
  }

  // 3. Resolve Custom Headers
  const resolvedHeaders: Record<string, string> = {};
  const activeHeaders = req.headers?.filter((h) => h.enabled && h.key.trim()) || [];
  activeHeaders.forEach((h) => {
    resolvedHeaders[resolve(h.key)] = resolve(h.value);
  });

  // 4. Resolve Auth Settings
  if (req.auth) {
    const { type, bearerToken, basicUser, basicPass, apiKeyName, apiKeyValue, apiKeyLocation } = req.auth;
    if (type === "bearer" && bearerToken) {
      resolvedHeaders["Authorization"] = `Bearer ${resolve(bearerToken)}`;
    } else if (type === "basic" && basicUser) {
      const creds = btoa(`${resolve(basicUser)}:${resolve(basicPass)}`);
      resolvedHeaders["Authorization"] = `Basic ${creds}`;
    } else if (type === "apikey" && apiKeyName && apiKeyValue) {
      const name = resolve(apiKeyName);
      const val = resolve(apiKeyValue);
      if (apiKeyLocation === "header") {
        resolvedHeaders[name] = val;
      } else {
        const connector = fullUrl.includes("?") ? "&" : "?";
        fullUrl += `${connector}${name}=${encodeURIComponent(val)}`;
      }
    }
  }

  // 5. Resolve Body payloads
  let resolvedData: unknown = null;
  const bodyType = req.body?.type || "none";
  
  if (bodyType === "json" && req.body.rawText) {
    const rawResolved = resolve(req.body.rawText);
    try {
      resolvedData = JSON.parse(rawResolved);
    } catch {
      resolvedData = rawResolved; // Fallback to string if parsing fails
    }
  } else if (bodyType === "raw" && req.body.rawText) {
    resolvedData = resolve(req.body.rawText);
  } else if (bodyType === "formdata" && req.body.formdata) {
    resolvedData = req.body.formdata
      .filter((fd) => fd.enabled && fd.key.trim())
      .map((fd) => ({
        key: resolve(fd.key),
        value: resolve(fd.value),
        enabled: true,
      }));
  } else if (bodyType === "urlencoded" && req.body.urlencoded) {
    resolvedData = req.body.urlencoded
      .filter((ue) => ue.enabled && ue.key.trim())
      .map((ue) => ({
        key: resolve(ue.key),
        value: resolve(ue.value),
        enabled: true,
      }));
  }

  return {
    url: fullUrl,
    method: req.method || "GET",
    contentType: req.contentType || "application/json",
    headers: resolvedHeaders,
    data: resolvedData,
  };
}
