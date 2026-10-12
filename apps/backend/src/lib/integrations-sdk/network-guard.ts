import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const metadataHosts = new Set([
  "metadata",
  "metadata.google.internal",
  "metadata.google",
  "metadata.goog",
  "instance-data.ec2.internal",
]);
const metadataIpv4 = new Set(["169.254.169.254", "169.254.170.2", "100.100.100.200", "192.0.0.192"]);
const metadataIpv6 = new Set(["fd00:ec2::254", "fe80::a9fe:a9fe"]);
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const maxRedirects = 5;
const supportedProtocols = new Set(["http:", "https:", "ws:", "wss:"]);

export type NetworkGuardOptions = {
  resolveHost?: (hostname: string) => Promise<readonly string[]>;
  fetchImpl?: (request: Request) => Promise<Response>;
};

type ResolveHost = (hostname: string) => Promise<readonly string[]>;
const resolveHost: ResolveHost = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address);

/** Validate a configured outbound HTTP or WebSocket URL while allowing private homelab hosts. */
export async function assertSafeIntegrationUrl(
  value: string | URL,
  protocols: readonly string[] = ["http:", "https:"],
  resolve: ResolveHost = resolveHost,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value.toString());
  } catch {
    throw new Error("Integration URL is invalid");
  }

  if (!supportedProtocols.has(url.protocol) || !protocols.includes(url.protocol)) {
    throw new Error("Integration URL uses an unsupported protocol");
  }
  if (url.username || url.password) throw new Error("Integration URL must not contain credentials");

  const hostname = normalizeHostname(url.hostname);
  if (metadataHosts.has(hostname) || isMetadataIp(hostname)) {
    throw new Error("Integration URL targets a cloud metadata endpoint");
  }

  if (!isIP(hostname)) {
    let addresses: readonly string[];
    try {
      addresses = await resolve(hostname);
    } catch {
      throw new Error("Integration URL hostname could not be resolved");
    }
    if (addresses.length === 0) throw new Error("Integration URL hostname could not be resolved");
    if (addresses.some((address) => isMetadataIp(normalizeHostname(address)))) {
      throw new Error("Integration URL resolves to a cloud metadata endpoint");
    }
  }
  return url;
}

/** Fetch with manual redirects so an integration cannot forward a request across origins. */
export async function guardedIntegrationFetch(
  input: string | URL | Request,
  init: RequestInit = {},
  options: NetworkGuardOptions = {},
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? ((request) => fetch(request as unknown as Parameters<typeof fetch>[0]));
  const resolve = options.resolveHost ?? resolveHost;
  let request = input instanceof Request
    ? new Request(input)
    : new Request(input.toString(), init);
  let url = await assertSafeIntegrationUrl(request.url, ["http:", "https:"], resolve);

  for (let redirects = 0; ; redirects++) {
    const response = await fetchImpl(request.clone() as unknown as Request);
    if (!redirectStatuses.has(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    if (redirects >= maxRedirects) throw new Error("Integration request exceeded the redirect limit");

    const nextUrl = await assertSafeIntegrationUrl(new URL(location, url), ["http:", "https:"], resolve);
    if (nextUrl.origin !== url.origin) throw new Error("Integration request attempted a cross-origin redirect");
    try { await response.body?.cancel(); } catch { /* the redirect body is not needed */ }

    const method = request.method.toUpperCase();
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
      request = new Request(nextUrl.href, {
        method: "GET",
        headers: request.headers,
        signal: request.signal,
        redirect: "manual",
      });
    } else {
      request = new Request(nextUrl.href, {
        method: request.method,
        headers: request.headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.clone().body,
        signal: request.signal,
        redirect: "manual",
      });
    }
    url = nextUrl;
  }
}

function normalizeHostname(hostname: string) {
  return hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

function isMetadataIp(hostname: string) {
  if (metadataIpv4.has(hostname) || metadataIpv6.has(hostname)) return true;
  const mappedIpv6 = hostname.match(/^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/i);
  if (mappedIpv6) {
    const high = Number.parseInt(mappedIpv6[1], 16);
    const low = Number.parseInt(mappedIpv6[2], 16);
    return isMetadataIp([high >>> 8, high & 255, low >>> 8, low & 255].join("."));
  }
  if (isIP(hostname) === 4) {
    const [first, second] = hostname.split(".").map(Number);
    return first === 169 && second === 254;
  }
  return false;
}
