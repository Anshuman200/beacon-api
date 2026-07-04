import { describe, it, expect, afterEach } from "vitest";
import { checkEgressAllowed, DnsLookupFn } from "@/lib/egressGuard";

function lookupReturning(...addresses: { address: string; family: number }[]): DnsLookupFn {
  return async () => addresses;
}

describe("checkEgressAllowed", () => {
  afterEach(() => {
    delete process.env.BEACON_PROXY_ALLOW_PRIVATE;
  });

  it("allows a normal public URL", async () => {
    const result = await checkEgressAllowed("https://93.184.216.34/data", lookupReturning());
    expect(result.allowed).toBe(true);
  });

  it("allows a public hostname that resolves to a public IP", async () => {
    const lookup = lookupReturning({ address: "93.184.216.34", family: 4 });
    const result = await checkEgressAllowed("https://api.example.com/data", lookup);
    expect(result.allowed).toBe(true);
    expect(result.resolvedIps).toEqual(["93.184.216.34"]);
  });

  it("blocks the AWS/GCP/Azure cloud metadata address (169.254.169.254)", async () => {
    const result = await checkEgressAllowed("http://169.254.169.254/latest/meta-data/", lookupReturning());
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("blocked_private_ip");
  });

  it.each([
    ["10.0.0.1", "10.x private range"],
    ["10.255.255.254", "10.x private range (upper bound)"],
    ["172.16.0.1", "172.16.x private range"],
    ["172.31.255.254", "172.16.x private range (upper bound)"],
    ["192.168.1.1", "192.168.x private range"],
    ["127.0.0.1", "loopback"],
    ["127.255.255.255", "loopback (upper bound)"],
    ["0.0.0.0", "this-network"],
  ])("blocks a literal IP in a private/reserved range: %s (%s)", async (ip) => {
    const result = await checkEgressAllowed(`http://${ip}/`, lookupReturning());
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("blocked_private_ip");
  });

  it("blocks IPv6 loopback (::1)", async () => {
    const result = await checkEgressAllowed("http://[::1]/", lookupReturning());
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("blocked_private_ip");
  });

  it("blocks IPv6 link-local (fe80::/10)", async () => {
    const result = await checkEgressAllowed("http://[fe80::1]/", lookupReturning());
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("blocked_private_ip");
  });

  it("blocks IPv6 unique-local (fc00::/7)", async () => {
    const result = await checkEgressAllowed("http://[fd12:3456:789a::1]/", lookupReturning());
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("blocked_private_ip");
  });

  it("blocks an IPv4-mapped IPv6 address that embeds a private IP", async () => {
    const result = await checkEgressAllowed("http://[::ffff:10.0.0.5]/", lookupReturning());
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("blocked_private_ip");
  });

  it("blocks decimal/hex/octal-encoded loopback IPs (normalized by the URL parser)", async () => {
    // 2130706433 and 0x7f000001 both decode to 127.0.0.1 — the WHATWG URL
    // parser normalizes these before we ever see `hostname`.
    const decimal = await checkEgressAllowed("http://2130706433/", lookupReturning());
    const hex = await checkEgressAllowed("http://0x7f000001/", lookupReturning());
    expect(decimal.allowed).toBe(false);
    expect(hex.allowed).toBe(false);
  });

  it("blocks a hostname that resolves to a private IP (DNS rebinding shape)", async () => {
    const lookup = lookupReturning({ address: "10.0.0.5", family: 4 });
    const result = await checkEgressAllowed("https://internal.evil.example.com/", lookup);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("blocked_private_ip");
    expect(result.message).toContain("10.0.0.5");
  });

  it("blocks if ANY of a hostname's multiple resolved IPs is private, even if others are public", async () => {
    const lookup = lookupReturning({ address: "93.184.216.34", family: 4 }, { address: "169.254.169.254", family: 4 });
    const result = await checkEgressAllowed("https://multi-homed.example.com/", lookup);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("blocked_private_ip");
  });

  it("rejects non-http(s) schemes", async () => {
    const result = await checkEgressAllowed("file:///etc/passwd", lookupReturning());
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("invalid_scheme");
  });

  it("rejects a URL that can't be parsed", async () => {
    const result = await checkEgressAllowed("not a url at all", lookupReturning());
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("invalid_url");
  });

  it("reports dns_resolution_failed when the lookup throws", async () => {
    const failingLookup: DnsLookupFn = async () => {
      throw new Error("ENOTFOUND");
    };
    const result = await checkEgressAllowed("https://does-not-resolve.example.com/", failingLookup);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("dns_resolution_failed");
  });

  it("BEACON_PROXY_ALLOW_PRIVATE=true bypasses the private-IP block", async () => {
    process.env.BEACON_PROXY_ALLOW_PRIVATE = "true";
    const result = await checkEgressAllowed("http://127.0.0.1:4000/", lookupReturning());
    expect(result.allowed).toBe(true);
  });

  it("BEACON_PROXY_ALLOW_PRIVATE still rejects invalid schemes (it only bypasses the IP check)", async () => {
    process.env.BEACON_PROXY_ALLOW_PRIVATE = "true";
    const result = await checkEgressAllowed("file:///etc/passwd", lookupReturning());
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("invalid_scheme");
  });
});
