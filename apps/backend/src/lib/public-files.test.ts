import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, brotliDecompressSync, gzipSync, gunzipSync } from "node:zlib";
import { createPublicFileServer } from "./public-files";

let directory: string;
let serve: ReturnType<typeof createPublicFileServer>;
const script = "console.log('dashboard');".repeat(100);
const asset = "/assets/index-Abc123_X.js";
const request = (headers: Record<string, string> = {}, method = "GET") => new Request(`http://localhost${asset}`, { headers, method });

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "dashwise-public-"));
  await Promise.all([
    Bun.write(join(directory, asset), script),
    Bun.write(join(directory, `${asset}.br`), brotliCompressSync(script)),
    Bun.write(join(directory, `${asset}.gz`), gzipSync(script)),
    Bun.write(join(directory, "index.html"), "<html>dashboard</html>"),
    Bun.write(join(directory, "sw.js"), "// service worker"),
    Bun.write(join(directory, "fonts/clock.woff2"), "font"),
  ]);
  serve = createPublicFileServer(directory);
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

describe("public asset delivery", () => {
  test("serves immutable fingerprinted assets and revalidates HTML and service workers", async () => {
    const response = await serve(asset, request());
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("content-type")).toContain("javascript");
    expect(await response.text()).toBe(script);
    for (const path of ["/index.html", "/sw.js"]) {
      const response = await serve(path);
      expect(response.headers.get("cache-control")).toBe("no-cache");
    }
    expect((await serve("/fonts/clock.woff2")).headers.get("cache-control")).toContain("immutable");
  });

  test("negotiates Brotli and preserves the original MIME type", async () => {
    const response = await serve(asset, request({ "accept-encoding": "gzip, br" }));
    expect(response.headers.get("content-encoding")).toBe("br");
    expect(response.headers.get("vary")).toBe("Accept-Encoding");
    expect(response.headers.get("content-type")).toContain("javascript");
    expect(brotliDecompressSync(await response.bytes()).toString()).toBe(script);
  });

  test("honors gzip preference and disabled encodings", async () => {
    const response = await serve(asset, request({ "accept-encoding": "br;q=0.5, gzip;q=1" }));
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(gunzipSync(await response.bytes()).toString()).toBe(script);
    const identity = await serve(asset, request({ "accept-encoding": "br;q=0,gzip;q=0" }));
    expect(identity.headers.get("content-encoding")).toBeNull();
    expect(await identity.text()).toBe(script);
  });

  test("supports wildcard encodings without overriding explicit exclusions", async () => {
    const response = await serve(asset, request({ "accept-encoding": "*;q=0.8, br;q=0" }));
    expect(response.headers.get("content-encoding")).toBe("gzip");
  });

  test("falls back to the original when a compressed sibling does not exist", async () => {
    const response = await serve("/index.html", request({ "accept-encoding": "gzip,br" }));
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(await response.text()).toBe("<html>dashboard</html>");
    const unacceptable = await serve("/index.html", request({ "accept-encoding": "gzip,identity;q=0" }));
    expect(unacceptable.status).toBe(406);
  });

  test("returns 304 for matching validators but keeps representations distinct", async () => {
    const initial = await serve(asset, request());
    const etag = initial.headers.get("etag")!;
    const unchanged = await serve(asset, request({ "if-none-match": `"other", ${etag}` }));
    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe("");
    expect(unchanged.headers.get("cache-control")).toContain("immutable");
    const compressed = await serve(asset, request({ "if-none-match": etag, "accept-encoding": "br" }));
    expect(compressed.status).toBe(200);
    expect(compressed.headers.get("etag")).not.toBe(etag);
  });

  test("leaves byte ranges uncompressed and handles HEAD", async () => {
    const range = await serve(asset, request({ "accept-encoding": "br", range: "bytes=0-3" }));
    expect(range.headers.get("content-encoding")).toBeNull();
    const head = await serve(asset, request({}, "HEAD"));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  test("rejects missing files and paths outside the public directory", async () => {
    expect((await serve("/missing.js")).status).toBe(404);
    expect((await serve("/../package.json")).status).toBe(404);
    expect((await serve("/")).status).toBe(404);
  });
});
