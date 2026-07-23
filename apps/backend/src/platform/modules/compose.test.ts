import { expect, test } from "bun:test";
import { homelabProduct } from "../../products/homelab";

test("Homelab includes News once with its feed job", () => {
  const news = homelabProduct.modules.find((module) => module.id === "news");
  expect(news?.routes).toHaveLength(1);
  expect(news?.jobs?.[0]?.id).toBe("newsFeedBuilder");
});

test("feature routes and jobs are composed once", () => {
  expect(homelabProduct.modules.find((module) => module.id === "links")?.routes).toHaveLength(1);
  expect(homelabProduct.modules.find((module) => module.id === "monitoring")?.jobs).toHaveLength(2);
  expect(homelabProduct.modules.find((module) => module.id === "notifications")?.jobs?.[0]?.id).toBe("notificationForwarder");
});
