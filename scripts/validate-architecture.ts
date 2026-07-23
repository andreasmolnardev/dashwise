import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dir, "..");
const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^'\"]*?\s+from\s+)?["']([^"']+)["']/g;

type App = "web" | "backend";

function sourceRoot(app: App) {
  return resolve(root, "apps", app, "src");
}

function modulePath(app: App, sourceFile: string, specifier: string) {
  if (app === "web" && specifier.startsWith("@/")) return specifier.slice(2);
  if (!specifier.startsWith(".")) return null;
  return relative(sourceRoot(app), resolve(sourceFile, "..", specifier)).split(sep).join("/");
}

function imports(source: string) {
  return [...source.matchAll(importPattern)].map((match) => match[1]);
}

async function sourceFiles(app: App) {
  const directory = sourceRoot(app);
  const files: string[] = [];
  for (const pattern of ["**/*.ts", "**/*.tsx"]) {
    for await (const file of new Bun.Glob(pattern).scan({ cwd: directory, onlyFiles: true })) {
      files.push(resolve(directory, file));
    }
  }
  return files;
}

export async function validateArchitecture() {
  const errors: string[] = [];

  for (const app of ["web", "backend"] as const) {
    for (const file of await sourceFiles(app)) {
      const source = relative(sourceRoot(app), file).split(sep).join("/");
      if (source.endsWith(".test.ts") || source.endsWith(".test.tsx")) continue;
      const sourceModule = source.match(/^modules\/([^/]+)\//)?.[1];
      const content = await Bun.file(file).text();

      for (const specifier of imports(content)) {
        const target = modulePath(app, file, specifier);
        if (!target) continue;

        const targetModule = target.match(/^modules\/([^/]+)\//)?.[1];
        if (sourceModule && target.startsWith("products/")) {
          errors.push(`${app}/${source}: modules cannot import products (${specifier})`);
        }
        if (source.startsWith("platform/") && target.startsWith("products/")) {
          errors.push(`${app}/${source}: platform cannot import products (${specifier})`);
        }
        if (targetModule && sourceModule !== targetModule && target.includes("/internal/")) {
          errors.push(`${app}/${source}: cannot import another module's internal code (${specifier})`);
        }
        if (!source.startsWith("products/") && !source.startsWith("jobs/") && !sourceModule && targetModule && /\/module(?:\.[^/]+)?$/.test(target)) {
          errors.push(`${app}/${source}: only products may compose modules (${specifier})`);
        }
      }
    }
  }

  return errors;
}

export async function validateCompositions() {
  const webProduct = await import(pathToFileURL(resolve(root, "apps/web/src/products/homelab/index.ts")).href);
  const backendProduct = await import(pathToFileURL(resolve(root, "apps/backend/src/products/homelab/index.ts")).href);

  if (!webProduct.homelabProduct || !backendProduct.homelabProduct) {
    throw new Error("Product composition export is missing");
  }
}

if (import.meta.main) {
  const errors = await validateArchitecture();
  if (errors.length) throw new Error(`Architecture validation failed:\n${errors.join("\n")}`);
  await validateCompositions();
}
