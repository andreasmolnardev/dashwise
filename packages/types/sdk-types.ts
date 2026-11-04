export type ActionAuth = {
  token?: string | null;
  sessionId?: string | null;
};

export type JsonPrimitive = string | number | boolean | null;
// Undefined object properties are omitted by JSON.stringify, so permit them
// in typed preference records while keeping persisted JSON values otherwise
// constrained to the JSON data model.
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue | undefined };
export type UserPropertyValue = JsonValue;

export type ThemePreference = "light" | "dark" | "system";
export type WallpaperFilters = {
  blur?: number;
  brightness?: number;
  darkModeBrightness?: number;
};

export type AppearancePreferences = {
  accentColor?: string;
  backgroundImageUrl?: string;
  themeMode?: ThemePreference;
  frostedAppearance?: ThemePreference;
  linkTileStyle?: "default" | "compact";
  wallpaperFilters?: WallpaperFilters;
  defaultFont?: string;
  [key: string]: JsonValue | undefined;
};

export type LocalizationPreferences = {
  locale?: string;
  timeFormat?: string | number;
  "time-format"?: string | number;
  dateFormat?: string;
  weatherUnit?: "c" | "f" | string;
  weatherLocation?: string;
  [key: string]: JsonValue | undefined;
};

export type SearchEngine = {
  icon: string;
  name: string;
  slug: string;
  status: "enabled" | "disabled" | "default";
  url_home: string;
  url_params: string;
};

export type SearchPreferences = {
  searchEngines?: SearchEngine[];
  searchEngineShortcutFallback?: string;
  [key: string]: JsonValue | undefined;
};

export type AuthUserRecord = Partial<{
  id: string;
  email: string;
  emailVisibility: boolean;
  name: string;
  appearancePreferences: AppearancePreferences;
  localizationPreferences: LocalizationPreferences;
  screensaverPreferences: Record<string, unknown>;
  searchPreferences: SearchPreferences;
  verified: boolean;
  externalOnly: boolean;
  created: string;
  updated: string;
}> & {
  global?: { linkOpenBehaviour?: string };
  totpSecret?: string;
  [key: string]: unknown;
};

export type PageConfig = {
  appearance?: AppearancePreferences;
  columns?: Record<string, unknown>;
  glanceables?: Array<Record<string, unknown>>;
  meta?: Record<string, unknown> & { onboard?: boolean };
  pages?: string[];
  template?: string;
  [key: string]: unknown;
};

export type MonitorPing = {
  status?: string;
  created?: string;
  dateChanged?: string;
  httpStatus?: number;
  method?: string;
  endpoint?: string;
  latencyMs?: number;
  [key: string]: unknown;
};

export type MonitorRecord = {
  id: string;
  endpoint: string;
  endpointAuth: unknown;
  notifyOnStatusChange: boolean;
  notifyTopicId: string;
  pingAvgLatency: unknown;
  pingOutlierThreshold: unknown;
  pingOutliers: unknown[];
  pings: unknown;
  responseUpFilter: unknown;
  source: string;
  sourcelinkId: string;
  status: string;
  created: string;
  updated: string;
  method?: string;
  linkId?: string;
  expand?: {
    sourcelinkId?: {
      title?: string;
      url?: string;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type NewsFeedRecord = {
  id: string;
  title: string;
  icon?: string;
  feedType?: "all" | "custom" | string;
  systemKey?: string;
  subscriptionRefs: string[];
  includedFeedRefs?: string[];
  excludedSubscriptionRefs: string[];
  maxFeedItems?: number;
  /** A transient, SQLite-backed feed result returned by the Go API. */
  feedCache?: NewsFeedItem[];
};

export type NewsFeedRecordUpdateInput = {
  feedId: string;
  title?: string;
  icon?: string;
  feedType?: "all" | "custom" | string;
  systemKey?: string;
  subscriptionRefs?: string[];
  includedFeedRefs?: string[];
  excludedSubscriptionRefs?: string[];
  maxFeedItems?: number;
};

export type NewsFeedDraft = {
  id?: string;
  url?: string;
  feedUrl: string;
  icon?: string;
  json?: unknown;
  title?: string;
  name?: string;
  feedIds?: string[];
  newFeedTitles?: string[];
  linkReplaceRule?: Record<string, string>;
  fallbackThumbnailUrl?: string;
  thumbnailOverwriteUrl?: string;
  similarityGroupingWordsBlacklist?: string;
  enableTopicGrouping?: boolean;
  ignoreDescriptionForTopicGrouping?: boolean;
  fetchErrors?: string;
};

export type NewsFeedItem = {
  title: string;
  link: string;
  pubDate: string | Date;
  description?: string;
  author?: string;
  thumbnailUrl?: string;
  subscription_id: string;
  subscription_name: string;
  topicId?: string;
  topicTitle?: string;
  relatedArticles?: NewsFeedItem[];
  dedupeKey?: string;
  sourceSubscriptions?: Array<{ id: string; title: string }>;
  [key: string]: unknown;
};

export type NewsSavedArticle = {
  id: string;
  list: string[];
  isRead?: boolean;
  json: NewsFeedItem;
  userId?: string;
  created?: string;
  updated?: string;
};

export type NewsSavedArticleList = {
  id: string;
  name: string;
};

export type NewsSavedArticlesResponse = {
  articles: NewsSavedArticle[];
  lists: NewsSavedArticleList[];
  defaultList: string;
};

export type NewsFeedMetadata = {
  feedUrl: string;
  title: string;
  icon: string;
  suggestedBlacklistWords?: string[];
};

export type NewsFeedRecordCreateInput = {
  title: string;
  icon?: string;
  includedFeedRefs?: string[];
};

export type NewsFeedSummary = {
  id: string;
  title: string;
  icon?: string;
  includedFeedRefs?: string[];
};

export type NewsFeedsResponse = {
  id: null;
  feeds: NewsFeedSummary[];
  subscriptions?: NewsFeedSummary[];
};

export type NewsSubscriptionsResponse = {
  id: null;
  subscriptions: NewsFeedDraft[];
};

export type NewsSubscriptionJsonResponse = {
  id: string;
  json: unknown;
};

export type NewsSubscribeInput = {
  feedUrl: string;
  name?: string;
  icon?: string;
  feedIds?: string[];
  newFeedTitles?: string[];
  linkReplaceRule?: Record<string, string>;
  fallbackThumbnailUrl?: string;
  thumbnailOverwriteUrl?: string;
  similarityGroupingWordsBlacklist?: string;
  enableTopicGrouping?: boolean;
  ignoreDescriptionForTopicGrouping?: boolean;
};

export type NewsUpdateInput = {
  subscriptionId?: string;
  oldFeedUrl?: string;
  feedUrl: string;
  title?: string;
  icon?: string;
  feedIds?: string[];
  linkReplaceRule?: Record<string, string>;
  fallbackThumbnailUrl?: string;
  thumbnailOverwriteUrl?: string;
  similarityGroupingWordsBlacklist?: string;
  enableTopicGrouping?: boolean;
  ignoreDescriptionForTopicGrouping?: boolean;
};

export type SecondaryUrl = {
  name: string;
  url: string;
  routingRule: string;
};

export type HomeLink = {
  id: string;
  url: string;
  secondaryUrls?: SecondaryUrl[];
  title: string;
  iconUrl: string;
  description: string;
  position?: number;
  collection: string;
  collectionId?: string;
  folder: string;
  folderId?: string;
  folderIcon?: string;
  tags: string[];
  updated: string;
};
