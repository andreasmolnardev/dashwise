import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { brotliCompress, constants, gzip } from "node:zlib";
import { promisify } from "node:util";
import type { Plugin } from "vite";

const compressBrotli = promisify(brotliCompress);
const compressGzip = promisify(gzip);

/** Compress final files after Vite rewrites imports and preload dependencies. */
export function precompress(): Plugin {
  return {
    name: "dashwise-precompress",
    apply: "build",
    enforce: "post",
    async writeBundle({ dir }, bundle) {
      if (!dir) throw new Error("Precompression requires a build output directory");
      await Promise.all(Object.values(bundle).map(async (output) => {
        if (!/\.(?:js|mjs|css|html|json)$/.test(output.fileName)) return;
        const path = resolve(dir, output.fileName);
        const bytes = await readFile(path);
        if (bytes.length < 1024) return;
        const [br, gz] = await Promise.all([
          compressBrotli(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }),
          compressGzip(bytes, { level: 9 }),
        ]);
        await Promise.all(([["br", br], ["gz", gz]] as const).map(async ([suffix, compressed]) => {
          if (compressed.length < bytes.length) await writeFile(`${path}.${suffix}`, compressed);
        }));
      }));
    },
  };
}
