import type { OwaspApiCategory, OwaspChecklistItem } from "@/store/collectionStore";

export interface OwaspCategoryMeta {
  category: OwaspApiCategory;
  code: string;
  name: string;
  description: string;
  guidance: string;
  /** True for the categories that get an automated hint from passive analysis / auth helpers below. */
  hasAutomatedHint: boolean;
}

// OWASP API Security Top 10 (2023): https://owasp.org/API-Security/editions/2023/en/0x11-t10/
export const OWASP_CATEGORIES: OwaspCategoryMeta[] = [
  {
    category: "API1_BOLA",
    code: "API1:2023",
    name: "Broken Object Level Authorization",
    description: "APIs expose endpoints that handle object identifiers, creating a wide attack surface for access-control issues.",
    guidance: "Try requesting another user's object ID (e.g. /orders/123 → /orders/124) with your own credentials — you should be denied.",
    hasAutomatedHint: false,
  },
  {
    category: "API2_BROKEN_AUTH",
    code: "API2:2023",
    name: "Broken Authentication",
    description: "Authentication mechanisms are often implemented incorrectly, allowing attackers to compromise tokens or exploit implementation flaws.",
    guidance: "Auto-hinted from the Auth Helpers (missing/malformed token handling) and any JWT issues found in Response Analysis (alg:none, missing exp, etc.).",
    hasAutomatedHint: true,
  },
  {
    category: "API3_PROPERTY_AUTH",
    code: "API3:2023",
    name: "Broken Object Property Level Authorization",
    description: "Lack of validation at the property level lets attackers view or modify properties they shouldn't have access to (excessive data exposure / mass assignment).",
    guidance: "Auto-hinted when Response Analysis finds credential/secret-shaped fields in the body. Also manually check for fields a normal user shouldn't see, and try submitting extra/unexpected fields on write requests.",
    hasAutomatedHint: true,
  },
  {
    category: "API4_RESOURCE_CONSUMPTION",
    code: "API4:2023",
    name: "Unrestricted Resource Consumption",
    description: "APIs without rate limiting or resource quotas are vulnerable to DoS and cost-amplification attacks.",
    guidance: "Auto-hinted from missing rate-limit headers and an accepted oversized file upload (File Upload Probes). Also confirm large/expensive requests are bounded.",
    hasAutomatedHint: true,
  },
  {
    category: "API5_FUNCTION_AUTH",
    code: "API5:2023",
    name: "Broken Function Level Authorization",
    description: "Complex access-control policies with different roles/hierarchies lead to authorization flaws — e.g. a regular user reaching admin-only endpoints.",
    guidance: "Auto-hinted from the Authorization Matrix — run this request as your Regular User / Anonymous profiles and confirm the response matches what that role should get.",
    hasAutomatedHint: true,
  },
  {
    category: "API6_SENSITIVE_FLOWS",
    code: "API6:2023",
    name: "Unrestricted Access to Sensitive Business Flows",
    description: "Business flows (purchases, sign-ups, etc.) exposed without protection against excessive automated use can be abused at scale.",
    guidance: "Consider whether this flow needs CAPTCHA, device fingerprinting, or stricter rate limits given its business value.",
    hasAutomatedHint: false,
  },
  {
    category: "API7_SSRF",
    code: "API7:2023",
    name: "Server Side Request Forgery",
    description: "Endpoints that fetch a remote resource based on a user-supplied URL can be tricked into reaching internal services.",
    guidance: "If this endpoint accepts a URL/webhook parameter, test whether it can be pointed at an internal address (e.g. 169.254.169.254, localhost).",
    hasAutomatedHint: false,
  },
  {
    category: "API8_MISCONFIGURATION",
    code: "API8:2023",
    name: "Security Misconfiguration",
    description: "Missing hardening, verbose errors, permissive CORS, and outdated components are common and often automatable to detect.",
    guidance: "Auto-hinted from Response Analysis (missing headers, CORS misconfig, server info/error disclosure, credentials in the URL) and the Hygiene Helpers (unexpected method/Content-Type accepted).",
    hasAutomatedHint: true,
  },
  {
    category: "API9_INVENTORY",
    code: "API9:2023",
    name: "Improper Inventory Management",
    description: "Old API versions or undocumented/debug endpoints left reachable expand the attack surface unnecessarily.",
    guidance: "Confirm this endpoint's version is current and there isn't an older, less-protected version still live.",
    hasAutomatedHint: false,
  },
  {
    category: "API10_UNSAFE_CONSUMPTION",
    code: "API10:2023",
    name: "Unsafe Consumption of APIs",
    description: "Data pulled in from third-party/upstream APIs is often trusted more than user input and validated less.",
    guidance: "If this endpoint's response is built from another API's data, confirm that upstream data is validated/sanitized before use.",
    hasAutomatedHint: false,
  },
];

export function getOwaspCategoryMeta(category: OwaspApiCategory): OwaspCategoryMeta {
  const meta = OWASP_CATEGORIES.find((c) => c.category === category);
  if (!meta) throw new Error(`Unknown OWASP category: ${category}`);
  return meta;
}

export function updateChecklistItem(
  checklist: OwaspChecklistItem[],
  category: OwaspApiCategory,
  updates: Partial<Pick<OwaspChecklistItem, "status" | "notes">>
): OwaspChecklistItem[] {
  return checklist.map((item) => (item.category === category ? { ...item, ...updates } : item));
}
