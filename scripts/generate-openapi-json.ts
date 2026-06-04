import YAML from "yaml";

const sourcePath = new URL("../apps/backend/openapi.yaml", import.meta.url);
const outputPath = new URL("../apps/web/public/openapi.json", import.meta.url);

const source = await Bun.file(sourcePath).text();
const document = YAML.parse(source);

await Bun.write(outputPath, `${JSON.stringify(document, null, "\t")}\n`);
