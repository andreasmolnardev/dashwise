import { extname, resolve } from "node:path";

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};

function encodingQuality(header: string, encoding: string) {
  const entries = header.toLowerCase().split(",").map((part) => {
    const [name, ...parameters] = part.trim().split(";");
    const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
    const value = quality ? Number(quality.trim().slice(2)) : 1;
    return { name, quality: Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0 };
  });
  const explicit = entries.find(({ name }) => name === encoding);
  const wildcard = entries.find(({ name }) => name === "*");
  if (encoding === "identity" && !explicit) return wildcard?.quality === 0 ? 0 : 1;
  return (explicit ?? wildcard)?.quality ?? 0;
}

/** Serve public assets without compressing them on the request path. */
export function createPublicFileServer(publicDir: string) {
  const root = resolve(publicDir);
  return async function servePublicFile(requestPath: string, request?: Request) {
    const relativePath = requestPath.replace(/^\/+/, "");
    const assetPath = resolve(root, relativePath);
    if (!relativePath || !assetPath.startsWith(`${root}/`)) {
      return new Response("Not found", { status: 404 });
    }
    const original = Bun.file(assetPath);
    if (!await original.exists()) return new Response("Not found", { status: 404 });

    let file = original;
    let encoding: string | undefined;
    const extension = extname(assetPath).toLowerCase();
    const compressible = [".js", ".mjs", ".css", ".html", ".json", ".svg", ".txt", ".xml"].includes(extension);
    const accepted = request?.headers.get("accept-encoding") ?? "";
    if (compressible && !request?.headers.has("range")) {
      const candidates = [{ name: "br", suffix: ".br" }, { name: "gzip", suffix: ".gz" }]
        .map((candidate) => ({ ...candidate, quality: encodingQuality(accepted, candidate.name) }))
        .filter(({ quality }) => quality > 0)
        .sort((left, right) => right.quality - left.quality);
      for (const candidate of candidates) {
        const compressed = Bun.file(`${assetPath}${candidate.suffix}`);
        if (await compressed.exists()) {
          file = compressed;
          encoding = candidate.name;
          break;
        }
      }
    }
    if (!encoding && encodingQuality(accepted, "identity") === 0) {
      return new Response(null, { status: 406, headers: { Vary: "Accept-Encoding" } });
    }

    const fingerprinted = /^assets\/.+-[\w-]{8,}\.[^/]+$/.test(relativePath);
    const isFont = [".ttf", ".woff", ".woff2"].includes(extension);
    const headers = new Headers({
      "Content-Type": contentTypes[extension] ?? "application/octet-stream",
      "Cache-Control": fingerprinted || isFont ? "public, max-age=31536000, immutable" : "no-cache",
      ETag: `W/"${file.size.toString(16)}-${file.lastModified.toString(16)}-${encoding ?? "identity"}"`,
    });
    if (compressible) headers.set("Vary", "Accept-Encoding");
    if (encoding) headers.set("Content-Encoding", encoding);

    const validators = request?.headers.get("if-none-match")?.split(",").map((value) => value.trim().replace(/^W\//, ""));
    if (validators?.includes("*") || validators?.includes(headers.get("etag")!.replace(/^W\//, ""))) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(request?.method === "HEAD" ? null : file, { headers });
  };
}
