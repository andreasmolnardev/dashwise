import YAML from "yaml";

const specificationPath = new URL("../apps/backend/openapi.yaml", import.meta.url);
const specification = YAML.parse(await Bun.file(specificationPath).text());

if (
  !specification ||
  typeof specification !== "object" ||
  typeof specification.openapi !== "string" ||
  !specification.info ||
  typeof specification.info.title !== "string" ||
  typeof specification.info.version !== "string" ||
  !specification.paths ||
  typeof specification.paths !== "object"
) {
  throw new Error("OpenAPI contract smoke test failed: invalid apps/backend/openapi.yaml");
}

console.log(
  `OpenAPI contract smoke test passed (${Object.keys(specification.paths).length} paths).`,
);
