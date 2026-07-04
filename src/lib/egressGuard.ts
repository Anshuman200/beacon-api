import dns from "node:dns/promises";
import net, { BlockList } from "node:net";

export type EgressBlockReason =
  | "invalid_url"
  | "invalid_scheme"
  | "blocked_private_ip"
  | "dns_resolution_failed";

export interface EgressGuardResult {
  allowed: boolean;
  reason?: EgressBlockReason;
  message?: string;
  /** Every IP the hostname resolved to (or the single literal IP), already validated. */
  resolvedIps?: string[];
}

type LookupAddress = { address: string; family: number };
export type DnsLookupFn = (hostname: string, options: { all: true; verbatim?: boolean }) => Promise<LookupAddress[]>;

/**
 * Loopback, RFC 1918 private ranges, link-local (this is what covers cloud
 * metadata services at 169.254.169.254), and the "this network" 0.0.0.0/8
 * block. Built once and reused — `BlockList.check` also correctly unwraps
 * IPv4-mapped IPv6 addresses (e.g. ::ffff:10.0.0.1) against the ipv4 rules.
 */
function buildBlockList(): BlockList {
  const bl = new BlockList();
  bl.addSubnet("127.0.0.0", 8, "ipv4");
  bl.addAddress("::1", "ipv6");
  bl.addSubnet("10.0.0.0", 8, "ipv4");
  bl.addSubnet("172.16.0.0", 12, "ipv4");
  bl.addSubnet("192.168.0.0", 16, "ipv4");
  bl.addSubnet("fc00::", 7, "ipv6");
  bl.addSubnet("169.254.0.0", 16, "ipv4");
  bl.addSubnet("fe80::", 10, "ipv6");
  bl.addSubnet("0.0.0.0", 8, "ipv4");
  return bl;
}

const blockList = buildBlockList();

function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return blockList.check(address, "ipv4");
  if (family === 6) return blockList.check(address, "ipv6");
  return true; // Not a recognizable IP at all — fail closed rather than guess.
}

function stripBrackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/**
 * Validates a target URL is safe for this server to request on a client's
 * behalf: http(s) only, and every IP its hostname resolves to — not just the
 * hostname string, which is what defeats DNS rebinding and decimal/hex/octal
 * IP-literal tricks (the WHATWG URL parser already normalizes those into a
 * dotted-decimal `hostname` before this ever runs) — falls outside
 * loopback/private/link-local/0.0.0.0 ranges.
 *
 * Set `BEACON_PROXY_ALLOW_PRIVATE=true` to bypass the IP check for explicit
 * local/dev use (e.g. testing an internal service from a local checkout).
 * Defaults to blocked; do not set this in a publicly deployed instance.
 */
export async function checkEgressAllowed(
  targetUrl: string,
  lookupFn: DnsLookupFn = dns.lookup as unknown as DnsLookupFn
): Promise<EgressGuardResult> {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return { allowed: false, reason: "invalid_url", message: "Target URL could not be parsed." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      allowed: false,
      reason: "invalid_scheme",
      message: `Scheme "${parsed.protocol}" is not allowed — only http/https are permitted.`,
    };
  }

  const hostname = stripBrackets(parsed.hostname);

  let resolvedIps: string[];
  if (net.isIP(hostname)) {
    resolvedIps = [hostname];
  } else {
    try {
      const records = await lookupFn(hostname, { all: true, verbatim: true });
      resolvedIps = records.map((r) => r.address);
    } catch {
      return {
        allowed: false,
        reason: "dns_resolution_failed",
        message: `Could not resolve host "${hostname}".`,
      };
    }
  }

  const allowPrivate = process.env.BEACON_PROXY_ALLOW_PRIVATE === "true";
  if (!allowPrivate) {
    const blocked = resolvedIps.find(isBlockedAddress);
    if (blocked) {
      return {
        allowed: false,
        reason: "blocked_private_ip",
        message: `Target host "${hostname}" resolves to ${blocked}, a private/loopback/link-local address — this is blocked to prevent SSRF. Set BEACON_PROXY_ALLOW_PRIVATE=true to allow this for local development only.`,
      };
    }
  }

  return { allowed: true, resolvedIps };
}
