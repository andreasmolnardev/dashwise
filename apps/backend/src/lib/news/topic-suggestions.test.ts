import { describe, expect, test } from "bun:test";
import { suggestCommonBlacklistWords } from "./topic-suggestions";

describe("suggestCommonBlacklistWords", () => {
  test("ranks words shared by multiple article contents and excludes stop words", () => {
    const suggestions = suggestCommonBlacklistWords([
      {
        title: "Acme security update",
        description: "Acme reports a security release for cloud teams.",
        content: "Read the full Acme security report.",
      },
      {
        title: "Acme cloud platform news",
        description: "The Acme platform adds another security feature.",
        content: "Subscribe for more Acme coverage.",
      },
      {
        title: "Acme hardware launch",
        description: "Acme launches hardware for developers.",
      },
    ]);

    expect(suggestions[0]).toBe("acme");
    expect(suggestions).toContain("security");
    expect(suggestions).not.toContain("the");
    expect(suggestions).not.toContain("read");
  });

  test("does not suggest words found in only one article", () => {
    expect(suggestCommonBlacklistWords([
      { title: "Unique alpha", description: "Shared briefing" },
      { title: "Unique beta", description: "Shared briefing" },
    ])).not.toContain("alpha");
  });
});
