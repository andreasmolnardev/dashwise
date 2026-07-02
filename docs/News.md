# News

Dashwise News supports RSS and Atom feeds, plus normalized YouTube, Reddit, and GitHub feed URLs.

## Subscription Options

Each subscription can be customized from the add/edit subscription modal.

- Feed URL: the source RSS/Atom URL or supported service URL.
- Name and icon: display metadata for the subscription.
- Add to Feed: assigns the subscription to one or more news feeds.
- Link Rewrite: replaces matching text in article links before they are stored.
- Thumbnail: sets a fallback thumbnail URL or forces an overwrite thumbnail URL.
- Topic Grouping: enables or disables related-story grouping for that subscription.
- Blacklist Words: excludes words from topic similarity matching for that subscription.

## Topic Grouping

Topic grouping runs on the backend when a news feed is requested. Articles are sorted newest-first, then each article is compared with unassigned articles published within 72 hours. If token overlap similarity is at least `0.35`, up to four matching articles are attached as `relatedArticles` under the lead article.

Grouping tokens are built from article title, description, summary, categories, and tags. Titles, categories, and tags are weighted more heavily than description text. Common words such as `the`, `a`, `can`, `by`, and similar defaults are ignored.

Global and per-subscription settings can change grouping behavior. A user-level global list can be stored in `users.newsPreferences.similarityGroupingWordsBlacklist`; each subscription list extends that global list plus the built-in defaults.

- Disable Topic Grouping to prevent articles from that subscription from creating or joining related-story groups.
- Add comma-separated blacklist words to ignore noisy terms for that subscription.
- Blacklist words are case-insensitive.
- The subscription blacklist extends the default blacklist.
- Prefix a default word with `-` to allow it again, for example `-it`.
- Click common-word suggestions in the modal to append frequent subscription words to the blacklist.

## Article Descriptions

Fetched article descriptions are truncated to a maximum of five sentences before being stored in subscription JSON. This keeps cached feed data compact and prevents long descriptions from dominating article previews.
