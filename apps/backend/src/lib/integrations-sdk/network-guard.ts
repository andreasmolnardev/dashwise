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
  fetchImpl?: (request: Request, destination: { url: URL; address: string }) => Promise<Response>;
  /** URL endpoints explicitly supplied in this integration instance's config. */
  allowedPrivateUrls?: readonly (string | URL)[];
};

type ResolveHost = (hostname: string) => Promise<readonly string[]>;
const resolveHost: ResolveHost = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address);

/** Validate a configured outbound HTTP or WebSocket URL while allowing private homelab hosts. */
export async function assertSafeIntegrationUrl(
  value: string | URL,
  protocols: readonly string[] = ["http:", "https:"],
  resolve: ResolveHost = resolveHost,
  allowedPrivateUrls: readonly (string | URL)[] = [],
): Promise<URL> {
  return (await resolveSafeIntegrationUrl(value, protocols, resolve, allowedPrivateUrls)).url;
}

async function resolveSafeIntegrationUrl(
  value: string | URL,
  protocols: readonly string[],
  resolve: ResolveHost,
  allowedPrivateUrls: readonly (string | URL)[],
): Promise<{ url: URL; address: string }> {
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

  let addresses: readonly string[];
  if (isIP(hostname)) {
    addresses = [hostname];
  } else {
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
  if (addresses.some((address) => isNonPublicIp(normalizeHostname(address))) && !isExplicitlyConfigured(url, allowedPrivateUrls)) {
    throw new Error("Integration URL targets a private network address that is not explicitly configured");
  }
  return { url, address: normalizeHostname(addresses[0]!) };
}

/** Fetch with manual redirects so an integration cannot forward a request across origins. */
export async function guardedIntegrationFetch(
  input: string | URL | Request,
  init: RequestInit = {},
  options: NetworkGuardOptions = {},
): Promise<Response> {
  const resolve = options.resolveHost ?? resolveHost;
  let request = input instanceof Request
    ? new Request(input, { redirect: "manual" })
    : new Request(input.toString(), { ...init, redirect: "manual" });
  let destination = await resolveSafeIntegrationUrl(request.url, ["http:", "https:"], resolve, options.allowedPrivateUrls ?? []);

  for (let redirects = 0; ; redirects++) {
    const response = options.fetchImpl
      ? await options.fetchImpl(request.clone() as unknown as Request, destination)
      : await fetchPinnedRequest(request, destination.url, destination.address);
    if (!redirectStatuses.has(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    if (redirects >= maxRedirects) throw new Error("Integration request exceeded the redirect limit");

    const nextDestination = await resolveSafeIntegrationUrl(new URL(location, destination.url), ["http:", "https:"], resolve, options.allowedPrivateUrls ?? []);
    if (nextDestination.url.origin !== destination.url.origin) throw new Error("Integration request attempted a cross-origin redirect");
    try { await response.body?.cancel(); } catch { /* the redirect body is not needed */ }

    const method = request.method.toUpperCase();
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
      request = new Request(nextDestination.url.href, {
        method: "GET",
        headers: request.headers,
        signal: request.signal,
        redirect: "manual",
      });
    } else {
      request = new Request(nextDestination.url.href, {
        method: request.method,
        headers: request.headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.clone().body,
        signal: request.signal,
        redirect: "manual",
      });
    }
    destination = nextDestination;
  }
}

/** Validate a WebSocket destination while preserving its configured hostname for the connection. */
export async function createGuardedIntegrationWebSocket(
  value: string | URL,
  protocols?: string | string[],
  options: Pick<NetworkGuardOptions, "resolveHost" | "allowedPrivateUrls"> & {
    webSocketFactory?: (url: string | URL, options: Bun.WebSocketOptions) => WebSocket;
  } = {},
): Promise<WebSocket> {
  const destination = await resolveSafeIntegrationUrl(
    value,
    ["ws:", "wss:"],
    options.resolveHost ?? resolveHost,
    options.allowedPrivateUrls ?? [],
  );
  const socketOptions: Bun.WebSocketOptions = {
    headers: { Host: destination.url.host },
    ...(protocols ? { protocols } : {}),
    ...(destination.url.protocol === "wss:"
      ? { tls: { serverName: normalizeHostname(destination.url.hostname) } }
      : {}),
  };
  const defaultWebSocketFactory: NonNullable<typeof options.webSocketFactory> = (url, init) =>
    new (WebSocket as unknown as new (url: string | URL, options: Bun.WebSocketOptions) => WebSocket)(url, init);
  return (options.webSocketFactory ?? defaultWebSocketFactory)(destination.url, socketOptions);
}

async function fetchPinnedRequest(request: Request, url: URL, address: string): Promise<Response> {
  const pinned = pinIntegrationHttpRequest(request, url, address);
  return fetch(pinned.request, pinned.init);
}

export function pinIntegrationHttpRequest(request: Request, url: URL, address: string) {
  const headers = new Headers(request.headers);
  headers.set("Host", url.host);
  const requestInit = {
    method: request.method,
    headers: Object.fromEntries(headers.entries()),
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.clone().body,
    signal: request.signal,
    redirect: "manual",
  } as unknown as RequestInit;
  const pinnedRequest = new Request(withIpAddress(url, address).href, requestInit);
  const init: RequestInit & { proxy: false; tls?: { serverName: string } } = {
    redirect: "manual",
    proxy: false,
    ...(url.protocol === "https:" ? { tls: { serverName: normalizeHostname(url.hostname) } } : {}),
  };
  return { request: pinnedRequest, init };
}

function withIpAddress(url: URL, address: string) {
  const pinnedUrl = new URL(url);
  const ipHost = isIP(address) === 6 ? `[${address}]` : address;
  pinnedUrl.hostname = ipHost;
  return pinnedUrl;
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

function isExplicitlyConfigured(url: URL, configuredUrls: readonly (string | URL)[]) {
  const endpoint = privateEndpointKey(url);
  if (!endpoint) return false;
  return configuredUrls.some((value) => {
    try {
      const configured = new URL(value.toString());
      if (configured.username || configured.password) return false;
      return privateEndpointKey(configured) === endpoint;
    } catch {
      return false;
    }
  });
}

function privateEndpointKey(url: URL) {
  if (!supportedProtocols.has(url.protocol)) return null;
  const family = url.protocol === "http:" || url.protocol === "ws:" ? "insecure" : "secure";
  const defaultPort = family === "insecure" ? "80" : "443";
  return `${family}://${normalizeHostname(url.hostname)}:${url.port || defaultPort}`;
}

/** Treat special-use and non-global IP ranges as private destinations. */
function isNonPublicIp(hostname: string) {
  const version = isIP(hostname);
  if (version === 4) {
    const octets = hostname.split(".").map(Number);
    const address = (((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0);
    const ranges: Array<[string, number]> = [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
      ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
      ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
    ];
    return ranges.some(([base, prefix]) => {
      const baseAddress = base.split(".").map(Number).reduce((value, octet) => ((value << 8) | octet) >>> 0, 0);
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      return (address & mask) === (baseAddress & mask);
    });
  }
  if (version !== 6) return false;

  const groups = ipv6ToGroups(hostname);
  if (!groups) return true;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return isNonPublicIp(`${groups[6]! >>> 8}.${groups[6]! & 255}.${groups[7]! >>> 8}.${groups[7]! & 255}`);
  }
  // Global unicast currently occupies 2000::/3. Treat all other ranges as
  // special-use, including loopback, link-local, unique-local and multicast.
  if (groups[0]! < 0x2000 || groups[0]! > 0x3fff) return true;
  // Documentation and benchmarking ranges are not routable public destinations.
  if (groups[0] === 0x2001 && (groups[1] === 0x0db8 || (groups[1]! & 0xfff0) === 0x0010)) return true;
  return false;
}

function ipv6ToGroups(hostname: string) {
  const normalized = hostname.split("%")[0]!.toLowerCase();
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const parseHalf = (half: string) => half ? half.split(":").flatMap((part) => {
    if (part.includes(".")) {
      const octets = part.split(".").map(Number);
      if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return [];
      return [((octets[0]! << 8) | octets[1]!).toString(16), ((octets[2]! << 8) | octets[3]!).toString(16)];
    }
    return [part];
  }) : [];
  const left = parseHalf(halves[0]!);
  const right = parseHalf(halves[1] ?? "");
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[\da-f]{1,4}$/i.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}
