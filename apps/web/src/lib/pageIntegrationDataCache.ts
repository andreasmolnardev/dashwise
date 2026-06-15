type ConsumerType = "widget" | "glanceable";

type CachedConsumerPayload = {
  consumer: ConsumerType;
  key: string;
  properties: Record<string, any>;
  integrationId?: string | null;
  consumerKey: string;
  success: boolean;
  blueprint?: any;
  error?: string;
};

type PageIntegrationDataResponse = {
  success?: boolean;
  pageName?: string;
  items?: CachedConsumerPayload[];
};

const consumerCache = new Map<string, any>();

function resolveCanonicalConsumerKey(item: CachedConsumerPayload) {
  if (item.key && item.key.includes("#")) {
    return item.key;
  }

  if (item.integrationId && item.key) {
    return `${item.integrationId}#${item.key}`;
  }

  return typeof item.consumerKey === "string" ? item.consumerKey : null;
}

export function buildConsumerCacheKey(
  consumer: ConsumerType,
  key: string,
  properties?: Record<string, any> | null,
) {
  return `${consumer}:${key}:${stableStringify(normalizeConsumerProperties(consumer, properties ?? {}))}`;
}

export function primePageIntegrationConsumerCache(response: PageIntegrationDataResponse | null | undefined) {
  consumerCache.clear();

  if (!response || !Array.isArray(response.items)) {
    return;
  }

  response.items.forEach((item) => {
    const canonicalKey = item ? resolveCanonicalConsumerKey(item) : null;
    if (!item || !canonicalKey) {
      return;
    }
    consumerCache.set(canonicalKey, item);
    if (typeof item.consumerKey === "string" && item.consumerKey !== canonicalKey) {
      consumerCache.set(item.consumerKey, item);
    }
    consumerCache.set(
      buildConsumerCacheKey(item.consumer, item.key, item.properties),
      item,
    );
    if (item.consumer === "glanceable") {
      const aliasKey = item.key.startsWith("local-")
        ? item.key.slice("local-".length)
        : `local-${item.key}`;
      consumerCache.set(
        buildConsumerCacheKey(item.consumer, aliasKey, item.properties),
        item,
      );
    }
  });
}

export function updatePageIntegrationConsumerCache(item: CachedConsumerPayload | null | undefined) {
  const canonicalKey = item ? resolveCanonicalConsumerKey(item) : null;
  if (!item || !canonicalKey) {
    return;
  }

  consumerCache.set(canonicalKey, item);
  if (typeof item.consumerKey === "string" && item.consumerKey !== canonicalKey) {
    consumerCache.set(item.consumerKey, item);
  }
  consumerCache.set(
    buildConsumerCacheKey(item.consumer, item.key, item.properties),
    item,
  );

  if (item.consumer === "glanceable") {
    const aliasKey = item.key.startsWith("local-")
      ? item.key.slice("local-".length)
      : `local-${item.key}`;
    consumerCache.set(
      buildConsumerCacheKey(item.consumer, aliasKey, item.properties),
      item,
    );
  }
}

export function clearPageIntegrationConsumerCache() {
  consumerCache.clear();
}

export function readPageIntegrationConsumer(
  consumer: ConsumerType,
  key: string,
  properties?: Record<string, any>,
) {
  return consumerCache.get(buildConsumerCacheKey(consumer, key, properties));
}

function stableStringify(value: Record<string, any>) {
  const normalized = sortObject(value);
  return JSON.stringify(normalized);
}

function normalizeConsumerProperties(
  consumer: ConsumerType,
  properties: Record<string, any>,
) {
  if (consumer !== "widget" || !isPlainObject(properties)) {
    return properties;
  }

  const { index: _index, ...rest } = properties;
  return rest;
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortObject(entry));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const result: Record<string, unknown> = {};
  Object.keys(value)
    .sort()
    .forEach((key) => {
      result[key] = sortObject((value as Record<string, unknown>)[key]);
    });
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
