import { describe, expect, test } from "bun:test";
import {
  deduplicateUserArticles,
  selectNewsFeedSubscriptions,
  type NewsFeedRecord,
} from "./feed-builder";
import { buildNewsTopics } from "../../lib/data/news";
import type { CachedArticle } from "../../lib/cache/feed-items";
import type { NewsSubscription } from "../../lib/data/news";

const subscription = (id: string, title = id): NewsSubscription => ({
  id,
  userId: "user-1",
  url: "https://" + id + ".example/feed.xml",
  title,
  name: title,
});

const article = (json: Record<string, unknown>, sourceIds: string[]): CachedArticle => ({
  dedupeKey: "url:https://example.com/story",
  title: String(json.title || "Story"),
  publishedAt: Date.parse("2026-08-11T00:00:00.000Z"),
  sourceIds,
  json: {
    title: "Story",
    link: "https://example.com/story",
    pubDate: "2026-08-11T00:00:00.000Z",
    ...json,
  },
});

describe("materialized news selection", () => {
  test("deduplicates an article across subscriptions and preserves sources", () => {
    const subs = [subscription("one", "One"), subscription("two", "Two")];
    const result = deduplicateUserArticles([
      article({ description: "short" }, ["one", "two"]),
      article({ description: "a much more complete description" }, ["one", "two"]),
    ], new Set(["one", "two"]), new Map(subs.map((entry) => [entry.id!, entry])));

    expect(result).toHaveLength(1);
    expect(result[0]?.sourceSubscriptions).toEqual([
      { id: "one", title: "One" },
      { id: "two", title: "Two" },
    ]);
    expect(result[0]?.description).toBe("a much more complete description");
  });

  test("derives All membership dynamically and applies exclusions", () => {
    const subs = [subscription("one"), subscription("two"), subscription("three")];
    const all: NewsFeedRecord = {
      id: "legacy-all-id",
      title: "All feed",
      feedType: "all",
      systemKey: "all",
      subscriptionRefs: [],
      excludedSubscriptionRefs: ["two"],
    };
    expect(selectNewsFeedSubscriptions(subs, all).map((entry) => entry.id)).toEqual(["one", "three"]);
  });

  test("selects only referenced subscriptions for custom feeds", () => {
    const subs = [subscription("one"), subscription("two")];
    const custom: NewsFeedRecord = {
      id: "custom",
      title: "Custom",
      feedType: "custom",
      subscriptionRefs: ["two"],
      excludedSubscriptionRefs: [],
    };
    expect(selectNewsFeedSubscriptions(subs, custom).map((entry) => entry.id)).toEqual(["two"]);
  });

  test("groups topics only after exact article deduplication", () => {
    const subs = [subscription("one"), subscription("two")];
    const items = deduplicateUserArticles([
      { ...article({
        title: "Local council approves major housing project",
        link: "https://one.example/story",
      }, ["one"]), dedupeKey: "url:https://one.example/story" },
      { ...article({
        title: "Local council announces major housing project",
        link: "https://two.example/story",
      }, ["two"]), dedupeKey: "url:https://two.example/story" },
    ], new Set(["one", "two"]), new Map(subs.map((entry) => [entry.id!, entry])));

    expect(items).toHaveLength(2);
    expect(buildNewsTopics(items, subs, new Set())).toHaveLength(1);
  });
});
