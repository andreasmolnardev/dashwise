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

test("SDK integration endpoints expose specific generated response contracts", async () => {
  const specificationPath = new URL("../apps/backend/openapi.yaml", import.meta.url);
  const specification = YAML.parse(await Bun.file(specificationPath).text());
  const expectedSchemas = [
    ["/sdk-integrations/catalog", "get", "SdkIntegrationCatalogResponse"],
    ["/sdk-integrations/instances", "get", "SdkIntegrationInstancesResponse"],
    ["/sdk-integrations/instances", "post", "SdkIntegrationInstanceResponse"],
    ["/sdk-integrations/instances/{id}", "get", "SdkIntegrationInstanceResponse"],
    ["/sdk-integrations/instances/{id}", "patch", "SdkIntegrationInstanceResponse"],
    ["/sdk-integrations/instances/{id}/resources", "get", "SdkIntegrationResourcesResponse"],
    [
      "/sdk-integrations/instances/{id}/contributions/{kind}/{contributionId}/resolve",
      "post",
      "SdkContributionResolution",
    ],
  ] as const;

  for (const [path, method, schemaName] of expectedSchemas) {
    const response = specification.paths[path][method].responses["200"];
    expect(response.content["application/json"].schema.$ref)
      .toBe(`#/components/schemas/${schemaName}`);
  }

  const catalog = specification.components.schemas.SdkIntegrationCatalogEntry;
  expect(catalog.properties.config.additionalProperties.$ref)
    .toBe("#/components/schemas/SdkIntegrationConfigField");
  expect(catalog.properties.resources.additionalProperties.$ref)
    .toBe("#/components/schemas/SdkIntegrationResourceCollection");
  expect(specification.components.schemas.SdkResourceRecord.required)
    .toEqual(expect.arrayContaining(["collectionId", "revision", "stale"]));
  expect(specification.components.schemas.SdkContributionRevision.required)
    .toEqual(expect.arrayContaining(["instanceId", "collectionId", "resourceId", "revision"]));
});
