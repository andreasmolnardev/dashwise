import { expect, test } from "bun:test";
import YAML from "yaml";

test("the checked-in OpenAPI contract has its required document fields", async () => {
  const specificationPath = new URL("../apps/backend/openapi.yaml", import.meta.url);
  const specification = YAML.parse(await Bun.file(specificationPath).text());

  expect(specification).toBeObject();
  expect(specification.openapi).toBeString();
  expect(specification.info?.title).toBeString();
  expect(specification.info?.version).toBeString();
  expect(specification.paths).toBeObject();
  expect(Object.keys(specification.paths).length).toBeGreaterThan(0);
  expect(specification.paths["/appInfo"].get.responses["200"].content["application/json"].schema.properties)
    .toEqual({
      updateAvailable: { type: "boolean" },
      currentAppVersion: { type: "string" },
      userSignupDisabled: { type: "boolean" },
    });
});
