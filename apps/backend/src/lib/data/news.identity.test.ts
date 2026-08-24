import { describe, expect, test } from "bun:test";
import { articleKey, canonicalizeArticleUrl } from "./news";

describe("news article identity", () => {
  test("canonicalizes URLs without removing meaningful query parameters", () => {
    expect(canonicalizeArticleUrl("HTTPS://Example.COM/story/?page=2&utm_source=rss#comments"))
      .toBe("https://example.com/story?page=2");
  });

  test("uses GUID before the fallback key", () => {
    expect(articleKey({
      title: "Different title",
      link: "",
      guid: "entry-42",
      pubDate: "2026-08-11T00:00:00.000Z",
      subscription_id: "one",
      subscription_name: "One",
    })).toBe("guid:entry-42");
  });

  test("fallback identity includes source host and publication time", () => {
    const article = {
      title: "Same headline",
      link: "",
      pubDate: "2026-08-11T00:00:00.000Z",
      subscription_id: "one",
      subscription_name: "One",
    };
    const first = articleKey(article, "https://first.example/feed.xml");
    const second = articleKey(article, "https://second.example/feed.xml");
    expect(first).toMatch(/^fallback:/);
    expect(first).not.toBe(second);
  });
});
