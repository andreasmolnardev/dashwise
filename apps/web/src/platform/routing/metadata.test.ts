import { expect, test } from "bun:test";
import { homelabProduct } from "@/products/homelab";
import { resolvePageConfigName, routeMetadata } from "./metadata";
import { applicationRouteMetadata } from "./application-routes";

test("News URLs retain their module route metadata", () => {
  expect(routeMetadata("/apps/news", homelabProduct.modules)?.title).toBe("News");
  expect(routeMetadata("/apps/news/subscription-1", homelabProduct.modules)?.title).toBe("News");
});

test("native module URLs retain application metadata", () => {
  expect(routeMetadata("/links/tags/infrastructure", homelabProduct.modules)?.title).toBe("Links");
  expect(routeMetadata("/apps/monitoring/hosts/host-1", homelabProduct.modules)?.title).toBe("Monitoring");
  expect(routeMetadata("/apps/monitoring/notifications", homelabProduct.modules)?.title).toBe("Notifications");
  expect(routeMetadata("/kitchen", homelabProduct.modules)?.pageKind).toBe("dashboard");
});

test("page configuration keeps first-segment dashboard semantics", () => {
  expect(resolvePageConfigName("/home", "pathname-first-segment")).toBe("home");
  expect(resolvePageConfigName("/kitchen", "pathname-first-segment")).toBe("kitchen");
  expect(applicationRouteMetadata("/settings/pages")?.pageConfig?.mode).toBe("none");
  expect(routeMetadata("/apps/news", homelabProduct.modules)?.pageConfig?.mode).toBe("none");
});
