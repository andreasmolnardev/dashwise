import YAML from "yaml";

const sourcePath = new URL("../apps/backend/openapi.yaml", import.meta.url);
const outputPath = new URL("../apps/web/public/openapi.json", import.meta.url);

const source = await Bun.file(sourcePath).text();
const document = YAML.parse(source);

if (
  !document ||
  typeof document !== "object" ||
  typeof document.openapi !== "string" ||
  !document.info ||
  typeof document.info.title !== "string" ||
  typeof document.info.version !== "string" ||
  !document.paths ||
  typeof document.paths !== "object"
) {
  throw new Error(
    "apps/backend/openapi.yaml is not a valid OpenAPI document: openapi, info.title, info.version, and paths are required.",
  );
}

await Bun.write(outputPath, `${JSON.stringify(document, null, "\t")}\n`);
