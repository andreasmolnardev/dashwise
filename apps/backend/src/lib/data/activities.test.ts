import { describe, expect, test } from "bun:test";

import {
  ActivityInputError,
  validateActivityQuery,
  validatePublishActivityInput,
} from "./activities";

describe("activity backend input validation", () => {
  test("accepts typed events with bounded metadata and internal actions", () => {
    expect(validatePublishActivityInput({
      type: "service.offline",
      title: "Nextcloud is offline",
      severity: "warning",
      occurredAt: "2026-10-09T10:30:00.000Z",
      metadata: { serviceId: "nextcloud", retry: 2 },
      action: { label: "Open service", target: "/services/nextcloud" },
    })).toMatchObject({ severity: "warning", title: "Nextcloud is offline" });
  });

  test("rejects producer attempts to choose owner or source", () => {
    expect(() => validatePublishActivityInput({
      type: "test.event",
      title: "Test",
      ownerId: "another-user",
      source: "spoofed-source",
    })).toThrow(ActivityInputError);
  });

  test("rejects external, protocol-relative, and executable action targets", () => {
    for (const target of ["https://example.com", "//example.com", "javascript:alert(1)", "/\\evil.example"]) {
      expect(() => validatePublishActivityInput({
        type: "test.event",
        title: "Test",
        action: { label: "Open", target },
      })).toThrow(ActivityInputError);
    }
  });

  test("rejects oversized metadata and credential-like metadata keys", () => {
    expect(() => validatePublishActivityInput({
      type: "test.event",
      title: "Test",
      metadata: { data: "x".repeat(17 * 1024) },
    })).toThrow(/16 KB/);
    expect(() => validatePublishActivityInput({
      type: "test.event",
      title: "Test",
      metadata: { nested: { accessToken: "secret" } },
    })).toThrow(/credentials or secrets/);
  });

  test("validates query pagination and chronological range", () => {
    expect(validateActivityQuery({ page: "2", perPage: "50", severity: "error" }))
      .toMatchObject({ page: 2, perPage: 50, severity: "error" });
    expect(() => validateActivityQuery({ perPage: "1000" })).toThrow(/pagination/);
    expect(() => validateActivityQuery({ from: "2026-10-10T00:00:00Z", to: "2026-10-09T00:00:00Z" }))
      .toThrow(/from filter/);
  });
});
