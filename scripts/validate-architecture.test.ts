import { expect, test } from "bun:test";
import { validateArchitecture, validateCompositions } from "./validate-architecture";

test("app layers use permitted import directions and module boundaries", async () => {
  expect(await validateArchitecture()).toEqual([]);
});

test("product composition rejects duplicate routes and jobs", async () => {
  await expect(validateCompositions()).resolves.toBeUndefined();
});
