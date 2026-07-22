/**
 * SSRF guard used by webhook creation, dispatch, and other org-configured
 * outbound URL flows. Duplicates the string-level check from data-sources.ts
 * without pulling in its search dependencies.
 *
 * Returns true only when `raw` is an https:// URL whose hostname is public.
 * Rejects http://, loopback, RFC1918, link-local, unique-local, IPv6
 * private ranges, and known cloud-metadata hosts.
 */
export function isPublicHttpsUrl(raw: unknown): boolean {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (!host) return false;
  if (host === "metadata.google.internal" || host === "metadata.aws.internal") return false;
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return false;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = parseInt(ipv4[1], 10);
    const b = parseInt(ipv4[2], 10);
    if (a === 10) return false;
    if (a === 127) return false;
    if (a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a >= 224) return false;
  }
  return true;
}
