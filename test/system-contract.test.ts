import { expect, test } from "bun:test";

import {
  appConfigContract,
  appInfoContract,
} from "../apps/backend/src/features/system/system.contract";
import {
  validateContractQuery,
  validateContractResponse,
} from "../apps/backend/src/lib/http/contract";

test("system contract rejects unexpected query parameters", () => {
  expect(() => validateContractQuery(appInfoContract, { unexpected: "value" })).toThrow();
});

test("system contract validates the app-info response shape", () => {
  expect(() => validateContractResponse(appInfoContract, {
    updateAvailable: false,
    currentAppVersion: "v1.0.0",
    userSignupDisabled: false,
  })).not.toThrow();
  expect(() => validateContractResponse(appInfoContract, {
    updateAvailable: "no",
    currentAppVersion: "v1.0.0",
    userSignupDisabled: false,
  })).toThrow();
});

test("system app-config contract permits arbitrary configuration fields", () => {
  expect(() => validateContractResponse(appConfigContract, {
    instanceName: "Dashwise",
    nested: { enabled: true },
  })).not.toThrow();
});
