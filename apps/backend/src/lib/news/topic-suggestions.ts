const suggestionStopWords = new Set([
  "about", "after", "again", "also", "amid", "because", "before", "being", "between", "both", "can",
  "could", "does", "from", "have", "into", "just", "more", "news", "over", "said", "says", "that", "their",
  "there", "this", "through", "update", "using", "what", "when", "where", "which", "while", "with", "will",
  "would", "your", "the", "and", "for", "are", "but", "not", "you", "all", "any", "was", "one", "our", "out",
  "day", "get", "has", "him", "his", "how", "its", "may", "new", "now", "old", "see", "two", "who", "why", "via",
  "able", "a", "an", "as", "at", "be", "by", "do", "go", "he", "if", "in", "is", "it", "me", "my", "no", "of", "on", "or",
  "so", "to", "up", "us", "we", "read", "more", "click", "continue", "share", "subscribe", "copyright", "comment", "comments",
  "http", "https", "www", "com", "org", "net", "amp", "nbsp", "quot",
]);

function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ");
}

function textValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(textValue).join(" ");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return textValue(record._ ?? record["#"] ?? record.value ?? "");
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function articleText(item: unknown) {
  if (!item || typeof item !== "object") return "";

  const record = item as Record<string, unknown>;
  return [
    record.title,
    record.description,
    record.summary,
    record.content,
    record["content:encoded"],
    record["media:description"],
    record.categories,
    record.category,
    record.tags,
  ].map(textValue).join(" ");
}

/**
 * Finds feed-specific words that occur in several articles. These are useful
 * blacklist candidates because they are likely to describe the publication
 * rather than distinguish one story from another.
 */
export function suggestCommonBlacklistWords(items: unknown[], limit = 18): string[] {
  const articles = items
    .slice(0, 100)
    .map(articleText)
    .map((text) => stripHtml(text).toLowerCase())
    .filter(Boolean);
  if (!articles.length) return [];

  const counts = new Map<string, { articles: number; occurrences: number }>();

  for (const text of articles) {
    const words = text.split(/[^\p{L}\p{N}]+/gu);
    const seen = new Set<string>();

    for (const rawWord of words) {
      const word = rawWord.trim();
      if (word.length < 3 || suggestionStopWords.has(word) || /^\d+$/.test(word)) continue;
      seen.add(word);
    }

    for (const word of seen) {
      const entry = counts.get(word) ?? { articles: 0, occurrences: 0 };
      entry.articles++;
      counts.set(word, entry);
    }

    for (const rawWord of words) {
      const word = rawWord.trim();
      const entry = counts.get(word);
      if (entry) entry.occurrences++;
    }
  }

  const minimumArticles = Math.max(2, Math.ceil(articles.length * 0.1));

  return Array.from(counts.entries())
    .filter(([, countsForWord]) => countsForWord.articles >= minimumArticles)
    .sort(([leftWord, left], [rightWord, right]) =>
      right.articles - left.articles ||
      right.occurrences - left.occurrences ||
      leftWord.localeCompare(rightWord),
    )
    .slice(0, limit)
    .map(([word]) => word);
}
