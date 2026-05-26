import path from "path";
import { promises as fs } from "fs";
import { ClientResponseError } from "pocketbase";
import { getSuperuserPB } from "@dashwise/sdk/lib/pocketbase";
import { ApiActionError } from "@dashwise/sdk/data/auth";

type PBRecord = {
  id: string;
  pageName?: string;
  associatedUserId?: string;
  config?: Record<string, any>;
  name?: string;
  title?: string;
  url?: string;
  iconUrl?: string;
  description?: string;
  collection?: string;
  folder?: string;
  user?: string;
};

let _cachedDefaultConfig: Record<string, any> | null = null;

const LOCALIZATION_KEYS = [
  "dateFormat",
  "language",
  "locale",
  "timeFormat",
  "weatherLocation",
  "weatherUnit",
];

const SEARCH_GLOBAL_KEYS = ["searchEngineShortcutFallback", "linkOpenBehaviour"];

async function loadDefaultConfig() {
  if (_cachedDefaultConfig) return _cachedDefaultConfig;
  const configPath = path.join(process.cwd(), "public", "default-config.json");
  const configFile = await fs.readFile(configPath, "utf-8");
  _cachedDefaultConfig = JSON.parse(configFile);
  return _cachedDefaultConfig;
}

function isRecordNotFound(err: any) {
  return err instanceof ClientResponseError && err.status === 404;
}

function asObject(input: unknown): Record<string, any> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, any>)
    : {};
}

function normalizePageName(pageName?: string | null): string {
  const cleaned = String(pageName ?? "home").trim().toLowerCase();
  return cleaned.length > 0 ? cleaned : "home";
}

function stripEmptyIntegrations(config: Record<string, any>) {
  const rawIntegrations = config?.integrations ?? {};
  const strippedIntegrations = Object.fromEntries(
    Object.entries(rawIntegrations).map(([key, value]) => [
      key,
      !!value &&
        !Array.isArray(value) &&
        typeof value === "object" &&
        Object.keys(value).length > 0,
    ])
  );
  return strippedIntegrations;
}

async function listPageConfigRecords(pb: any, userId: string): Promise<PBRecord[]> {
  return pb.collection("pageConfig").getFullList(500, {
    filter: `associatedUserId=\"${userId}\"`,
  });
}

function splitPageConfigRecords(records: PBRecord[]) {
  const named = records.filter((record) => !!String(record.pageName ?? "").trim());
  const unnamed = records.filter((record) => !String(record.pageName ?? "").trim());
  return { named, unnamed };
}

async function ensurePageConfigRecord(pb: any, userId: string, pageName: string) {
  const normalizedName = normalizePageName(pageName);
  const records = await listPageConfigRecords(pb, userId);
  const { named, unnamed } = splitPageConfigRecords(records);

  const existing = named.find(
    (record) => normalizePageName(record.pageName) === normalizedName
  );
  if (existing) return { record: existing, migrationRequired: unnamed.length > 0, pageNames: named };

  if (normalizedName === "home" && unnamed.length > 0) {
    return {
      record: unnamed[0],
      migrationRequired: true,
      pageNames: named,
    };
  }

  const fallbackConfig =
    named.find((record) => normalizePageName(record.pageName) === "home")?.config ??
    unnamed[0]?.config ??
    (await loadDefaultConfig());

  const created = await pb.collection("pageConfig").create({
    associatedUserId: userId,
    pageName: normalizedName,
    config: fallbackConfig,
  });

  return {
    record: created,
    migrationRequired: unnamed.length > 0,
    pageNames: [...named, created],
  };
}

async function getUserRecord(pb: any, userId: string): Promise<Record<string, any>> {
  return pb.collection("users").getOne(userId);
}

async function getOrCreateHomeList(pb: any, userId: string): Promise<PBRecord> {
  const byType = await pb.collection("linksLists").getFullList(1, {
    filter: `user=\"${userId}\" && type=\"home\"`,
  });
  if (byType[0]) return byType[0];

  const byName = await pb.collection("linksLists").getFullList(1, {
    filter: `user=\"${userId}\" && name=\"Home\"`,
  });
  if (byName[0]) {
    const currentType = String((byName[0] as any).type ?? "").trim();
    if (currentType !== "home") {
      return pb.collection("linksLists").update(byName[0].id, { type: "home" });
    }
    return byName[0];
  }

  return pb.collection("linksLists").create({
    name: "Home",
    description: "Migrated from page config",
    type: "home",
    user: userId,
  });
}

async function getLinksPayloadFromTables(pb: any, userId: string) {
  const homeByType = await pb.collection("linksLists").getFullList(1, {
    filter: `user=\"${userId}\" && type=\"home\"`,
  });
  const homeByName =
    homeByType[0]
      ? []
      : await pb.collection("linksLists").getFullList(1, {
          filter: `user=\"${userId}\" && name=\"Home\"`,
        });

  const homeList = homeByType[0] ?? homeByName[0];
  if (!homeList) {
    return null;
  }

  const folders = await pb.collection("linksFolders").getFullList(500, {
    filter: `list=\"${homeList.id}\"`,
  });

  const folderById = new Map<string, string>();
  for (const folder of folders) {
    folderById.set(folder.id, folder.name || "");
  }

  const items = await pb.collection("linkItems").getFullList(5000, {
    filter: `collection=\"${homeList.id}\"`,
  });

  const linkGroups = folders
    .map((folder: PBRecord) => String(folder.name ?? "").trim())
    .filter(Boolean);

  const links = items.map((item: PBRecord) => {
    const group = item.folder ? folderById.get(item.folder) || "" : "";
    return {
      id: item.id,
      name: item.title || "",
      url: item.url || "",
      icon: item.iconUrl || "",
      description: item.description || "",
      linkGroup: group,
    };
  });

  return {
    linkGroups: Array.from(new Set(linkGroups)),
    links,
  };
}

async function replaceHomeLinksFromLegacyConfig(
  pb: any,
  userId: string,
  links: Array<Record<string, any>>,
  linkGroups: string[]
) {
  const homeList = await getOrCreateHomeList(pb, userId);

  const existingItems = await pb.collection("linkItems").getFullList(5000, {
    filter: `collection=\"${homeList.id}\"`,
  });
  for (const item of existingItems) {
    await pb.collection("linkItems").delete(item.id);
  }

  const existingFolders = await pb.collection("linksFolders").getFullList(500, {
    filter: `list=\"${homeList.id}\"`,
  });
  for (const folder of existingFolders) {
    await pb.collection("linksFolders").delete(folder.id);
  }

  const groupsFromLinks = links
    .map((link) => String(link?.linkGroup ?? "").trim())
    .filter(Boolean);

  const groupNames = Array.from(
    new Set([
      ...linkGroups.map((group) => String(group).trim()).filter(Boolean),
      ...groupsFromLinks,
    ])
  );

  const folderIdByPath = new Map<string, string>();

  async function getOrCreateFolderId(
    name: string,
    parentFolderId?: string,
    position?: number
  ) {
    const normalized = String(name ?? "").trim();
    if (!normalized) return undefined;

    const cacheKey = `${String(parentFolderId ?? "")}|${normalized.toLowerCase()}`;
    const cached = folderIdByPath.get(cacheKey);
    if (cached) return cached;

    const createdFolder = await pb.collection("linksFolders").create({
      list: homeList.id,
      name: normalized,
      icon: "",
      position,
      ...(parentFolderId ? { parentFolder: parentFolderId } : {}),
    });
    folderIdByPath.set(cacheKey, createdFolder.id);
    return createdFolder.id as string;
  }

  const topFolderIdByGroup = new Map<string, string>();
  for (const [index, group] of groupNames.entries()) {
    const createdId = await getOrCreateFolderId(group, undefined, index);
    if (createdId) {
      topFolderIdByGroup.set(group, createdId);
    }
  }

  for (const [index, link] of links.entries()) {
    const groupName = String(link?.linkGroup ?? "").trim();
    const childFolderName = String(link?.folder ?? "").trim();

    let folderId = groupName ? topFolderIdByGroup.get(groupName) : undefined;

    if (childFolderName) {
      folderId = await getOrCreateFolderId(childFolderName, folderId);
    }

    const title = String(link?.name ?? link?.title ?? "").trim();
    const url = String(link?.url ?? "").trim();
    const iconUrl = String(link?.icon ?? link?.iconUrl ?? "").trim();

    await pb.collection("linkItems").create({
      url,
      title,
      iconUrl,
      description: link?.description || "",
      collection: homeList.id,
      folder: folderId,
      position: index,
    });
  }
}

function extractPreferencesFromLegacyConfig(config: Record<string, any>) {
  const global = asObject(config.global);

  const localizationPreferences: Record<string, any> = {};
  const searchPreferences: Record<string, any> = {};

  for (const key of LOCALIZATION_KEYS) {
    if (global[key] !== undefined) localizationPreferences[key] = global[key];
  }

  for (const key of SEARCH_GLOBAL_KEYS) {
    if (global[key] !== undefined) searchPreferences[key] = global[key];
  }

  if (Array.isArray(config.searchEngines)) {
    searchPreferences.searchEngines = config.searchEngines;
  }

  return {
    appearancePreferences: asObject(config.appearance),
    localizationPreferences,
    searchPreferences,
  };
}

function mergeUserPreferencesIntoConfig(config: Record<string, any>, user: Record<string, any>) {
  const appearance = asObject(user.appearancePreferences);
  const localization = asObject(user.localizationPreferences);
  const search = asObject(user.searchPreferences);

  const nextGlobal = {
    ...asObject(config.global),
    ...localization,
  };

  for (const key of SEARCH_GLOBAL_KEYS) {
    if (search[key] !== undefined) nextGlobal[key] = search[key];
  }

  return {
    ...config,
    appearance: Object.keys(appearance).length > 0 ? appearance : config.appearance,
    global: nextGlobal,
    searchEngines: Array.isArray(search.searchEngines)
      ? search.searchEngines
      : config.searchEngines,
  };
}

function stripMigratedSectionsFromConfig(config: Record<string, any>) {
  const next = { ...config };
  delete next.appearance;
  delete next.global;
  delete next.searchEngines;
  delete next.links;
  delete next.linkGroups;
  return next;
}

function setNested(obj: Record<string, any>, path: string, value: any) {
  const keys = path.split(".");
  let current = obj;

  keys.forEach((key, idx) => {
    if (idx === keys.length - 1) {
      if (value === undefined) {
        delete current[key];
      } else {
        current[key] = value;
      }
      return;
    }

    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key];
  });
}

function getTopPath(path: string) {
  return path.split(".")[0] || path;
}

function normalizePathForPreferences(path: string): "appearance" | "global" | "searchEngines" | null {
  const top = getTopPath(path);
  if (top === "appearance") return "appearance";
  if (top === "global") return "global";
  if (top === "searchEngines") return "searchEngines";
  return null;
}

function patchPreferencesByPath(
  user: Record<string, any>,
  path: string,
  updatedItem: any
): Record<string, any> {
  const section = normalizePathForPreferences(path);
  if (!section) return user;

  if (section === "appearance") {
    const current = asObject(user.appearancePreferences);
    if (path === "appearance") {
      user.appearancePreferences = asObject(updatedItem);
      return user;
    }
    const nested = path.replace(/^appearance\./, "");
    const next = { ...current };
    setNested(next, nested, updatedItem);
    user.appearancePreferences = next;
    return user;
  }

  if (section === "searchEngines") {
    const current = asObject(user.searchPreferences);
    user.searchPreferences = {
      ...current,
      searchEngines: Array.isArray(updatedItem) ? updatedItem : [],
    };
    return user;
  }

  const currentLocalization = asObject(user.localizationPreferences);
  const currentSearch = asObject(user.searchPreferences);

  if (path === "global") {
    const source = asObject(updatedItem);
    const localizationUpdates: Record<string, any> = {};
    const searchUpdates: Record<string, any> = {};

    for (const [key, value] of Object.entries(source)) {
      if (LOCALIZATION_KEYS.includes(key)) localizationUpdates[key] = value;
      if (SEARCH_GLOBAL_KEYS.includes(key)) searchUpdates[key] = value;
    }

    user.localizationPreferences = { ...currentLocalization, ...localizationUpdates };
    user.searchPreferences = { ...currentSearch, ...searchUpdates };
    return user;
  }

  const nested = path.replace(/^global\./, "");
  const rootKey = nested.split(".")[0];

  if (LOCALIZATION_KEYS.includes(rootKey)) {
    const next = { ...currentLocalization };
    setNested(next, nested, updatedItem);
    user.localizationPreferences = next;
  }

  if (SEARCH_GLOBAL_KEYS.includes(rootKey)) {
    const next = { ...currentSearch };
    setNested(next, nested, updatedItem);
    user.searchPreferences = next;
  }

  return user;
}

function getPagesFromRecords(records: PBRecord[]) {
  const pages = records
    .map((record) => normalizePageName(record.pageName))
    .filter(Boolean);
  return Array.from(new Set(pages));
}

async function hydrateRuntimeConfig(pb: any, userId: string, pageName: string) {
  const ensured = await ensurePageConfigRecord(pb, userId, pageName);
  const user = await getUserRecord(pb, userId);

  const baseConfig = asObject(ensured.record?.config);
  let runtimeConfig: any = mergeUserPreferencesIntoConfig(baseConfig, user);
  runtimeConfig.integrations = stripEmptyIntegrations(runtimeConfig);

  const linksFromTables = await getLinksPayloadFromTables(pb, userId);
  if (linksFromTables) {
    runtimeConfig = {
      ...runtimeConfig,
      linkGroups: linksFromTables.linkGroups,
      links: linksFromTables.links,
    };
  }

  const namedPages = getPagesFromRecords(ensured.pageNames).filter(Boolean);
  runtimeConfig.pages = namedPages.length > 0 ? namedPages : ["home"];
  runtimeConfig.__activePageName = normalizePageName(ensured.record.pageName || pageName);
  runtimeConfig.__migrationRequired = ensured.migrationRequired;

  return {
    runtimeConfig,
    record: ensured.record,
    user,
    migrationRequired: ensured.migrationRequired,
  };
}

async function getPageConfigRecord(pb: any, userId: string, pageName = "home") {
  const ensured = await ensurePageConfigRecord(pb, userId, pageName);
  return ensured.record;
}

export async function getUserConfig(userId: string, pageName = "home") {
  const pb = await getSuperuserPB();

  let hydrated;
  try {
    hydrated = await hydrateRuntimeConfig(pb, userId, pageName);
  } catch (err: any) {
    if (err?.status === 403 || err?.message === "Associated user not found") {
      throw new ApiActionError("Invalid user", 403, { error: err });
    }
    throw err;
  }

  return hydrated.runtimeConfig;
}

export async function appendConfigArrayItem(
  userId: string,
  path: string,
  newItem: any,
  pageName = "home"
) {
  const pb = await getSuperuserPB();
  const record = await getPageConfigRecord(pb, userId, pageName);
  const config = record.config as Record<string, any>;

  const preferencePath = normalizePathForPreferences(path);
  if (preferencePath) {
    const user = await getUserRecord(pb, userId);
    const currentValue =
      preferencePath === "appearance"
        ? asObject(user.appearancePreferences)
        : preferencePath === "searchEngines"
          ? asObject(user.searchPreferences)
          : asObject(user.localizationPreferences);

    const sourcePath =
      preferencePath === "searchEngines"
        ? "searchPreferences.searchEngines"
        : preferencePath === "appearance"
          ? "appearancePreferences"
          : "localizationPreferences";

    let targetValue: any;
    if (path === "searchEngines") {
      targetValue = Array.isArray(user.searchPreferences?.searchEngines)
        ? [...user.searchPreferences.searchEngines, newItem]
        : [newItem];
      user.searchPreferences = {
        ...asObject(user.searchPreferences),
        searchEngines: targetValue,
      };
    } else {
      targetValue = Array.isArray(currentValue[path]) ? currentValue[path] : [];
      targetValue.push(newItem);
      if (sourcePath === "appearancePreferences") {
        user.appearancePreferences = { ...currentValue, [path]: targetValue };
      } else {
        user.localizationPreferences = { ...currentValue, [path]: targetValue };
      }
    }

    await pb.collection("users").update(userId, {
      appearancePreferences: user.appearancePreferences,
      localizationPreferences: user.localizationPreferences,
      searchPreferences: user.searchPreferences,
    });

    return {
      success: true,
      updatedPath: path,
      newItem,
    };
  }

  if (!Array.isArray(config[path])) {
    throw new ApiActionError(`Config key "${path}" is not an array`, 400, {
      error: `Config key "${path}" is not an array`,
    });
  }

  config[path].push(newItem);

  if (path === "links" || path === "linkGroups") {
    await replaceHomeLinksFromLegacyConfig(
      pb,
      userId,
      Array.isArray(config.links) ? config.links : [],
      Array.isArray(config.linkGroups) ? config.linkGroups : []
    );
  }

  await pb.collection("pageConfig").update(record.id, { config });

  return {
    success: true,
    updatedPath: path,
    newItem,
  };
}

export async function patchConfigPath(
  userId: string,
  path: string,
  updatedItem: any,
  pageName = "home"
) {
  const pb = await getSuperuserPB();
  const record = await getPageConfigRecord(pb, userId, pageName);
  const config = record.config as Record<string, any>;

  const preferencePath = normalizePathForPreferences(path);
  if (preferencePath) {
    const user = await getUserRecord(pb, userId);
    const nextUser = patchPreferencesByPath(user, path, updatedItem);
    await pb.collection("users").update(userId, {
      appearancePreferences: nextUser.appearancePreferences,
      localizationPreferences: nextUser.localizationPreferences,
      searchPreferences: nextUser.searchPreferences,
    });

    return {
      success: true,
      updatedPath: path,
      newItem: updatedItem,
    };
  }

  setNested(config, path, updatedItem);

  const topPath = getTopPath(path);
  if (topPath === "links" || topPath === "linkGroups") {
    await replaceHomeLinksFromLegacyConfig(
      pb,
      userId,
      Array.isArray(config.links) ? config.links : [],
      Array.isArray(config.linkGroups) ? config.linkGroups : []
    );
  }

  await pb.collection("pageConfig").update(record.id, { config });

  return {
    success: true,
    updatedPath: path,
    newItem: updatedItem,
  };
}

export async function replaceUserConfig(
  userId: string,
  nextConfig: Record<string, any>,
  pageName = "home"
) {
  const pb = await getSuperuserPB();
  const normalizedPageName = normalizePageName(pageName);

  let record: any | null = null;
  try {
    record = await getPageConfigRecord(pb, userId, normalizedPageName);
  } catch {
    record = null;
  }

  const prefs = extractPreferencesFromLegacyConfig(nextConfig);
  await pb.collection("users").update(userId, {
    appearancePreferences: prefs.appearancePreferences,
    localizationPreferences: prefs.localizationPreferences,
    searchPreferences: prefs.searchPreferences,
  });

  await replaceHomeLinksFromLegacyConfig(
    pb,
    userId,
    Array.isArray(nextConfig.links) ? nextConfig.links : [],
    Array.isArray(nextConfig.linkGroups) ? nextConfig.linkGroups : []
  );

  const pageOnlyConfig = stripMigratedSectionsFromConfig(nextConfig);

  if (record) {
    await pb.collection("pageConfig").update(record.id, {
      pageName: normalizedPageName,
      config: pageOnlyConfig,
    });
  } else {
    await pb.collection("pageConfig").create({
      associatedUserId: userId,
      pageName: normalizedPageName,
      config: pageOnlyConfig,
    });
  }

  return { success: true };
}

export async function deleteUnusedLinkgroups(userId: string) {
  const pb = await getSuperuserPB();
  const record: any = await getPageConfigRecord(pb, userId, "home");

  const config = (record.config ?? {}) as {
    linkGroups?: string[];
    links?: Array<{ linkGroup: string; [key: string]: any }>;
  };

  config.linkGroups = Array.isArray(config.linkGroups) ? config.linkGroups : [];
  config.links = Array.isArray(config.links) ? config.links : [];

  const originalLinkGroups = [...config.linkGroups];
  const originalLinks = [...config.links];

  const usedGroups = new Set(
    config.links
      .map((link) => (typeof link.linkGroup === "string" ? link.linkGroup.trim() : ""))
      .filter(Boolean)
  );

  const prunedLinkGroups = config.linkGroups
    .map((group) => (typeof group === "string" ? group.trim() : String(group)))
    .filter((group) => usedGroups.has(group));

  const uniquePrunedLinkGroups = Array.from(new Set(prunedLinkGroups));

  const prunedLinks = config.links.filter((link) =>
    uniquePrunedLinkGroups.includes(
      typeof link.linkGroup === "string" ? link.linkGroup.trim() : String(link.linkGroup)
    )
  );

  const removedLinkGroups = originalLinkGroups.filter(
    (group) =>
      !uniquePrunedLinkGroups.includes(
        typeof group === "string" ? group.trim() : String(group)
      )
  );

  const removedLinks = originalLinks.filter(
    (link) =>
      !prunedLinks.some(
        (prunedLink) =>
          prunedLink.url === link.url &&
          prunedLink.name === link.name &&
          (prunedLink.linkGroup === link.linkGroup ||
            String(prunedLink.linkGroup).trim() === String(link.linkGroup).trim())
      )
  );

  config.linkGroups = uniquePrunedLinkGroups;
  config.links = prunedLinks;
  await replaceHomeLinksFromLegacyConfig(pb, userId, config.links, config.linkGroups);
  await pb.collection("pageConfig").update(record.id, { config });

  return {
    success: true,
    removedLinkGroups,
    removedLinks,
    updatedCounts: {
      linkGroups: config.linkGroups.length,
      links: config.links.length,
    },
    config: {
      linkGroups: config.linkGroups,
      links: config.links.length,
    },
  };
}

export async function moveConfigArrayItems(userId: string, path: string, src: number, dst: number) {
  const pb = await getSuperuserPB();
  const record = await getPageConfigRecord(pb, userId, "home");
  const config = record.config as Record<string, any>;

  if (!Array.isArray(config[path])) {
    throw new ApiActionError(`Config key "${path}" is not an array`, 400, {
      error: `Config key "${path}" is not an array`,
    });
  }

  const arr = config[path];
  if (src < 0 || src >= arr.length || dst < 0 || dst >= arr.length) {
    throw new ApiActionError("src or dst index out of bounds", 400, {
      error: "src or dst index out of bounds",
    });
  }

  const [movedItem] = arr.splice(src, 1);
  arr.splice(dst, 0, movedItem);

  if (path === "links" || path === "linkGroups") {
    await replaceHomeLinksFromLegacyConfig(
      pb,
      userId,
      Array.isArray(config.links) ? config.links : [],
      Array.isArray(config.linkGroups) ? config.linkGroups : []
    );
  }

  await pb.collection("pageConfig").update(record.id, { config });

  return {
    success: true,
    updatedPath: path,
    movedItem,
    newArray: arr,
  };
}

function migrateWidgetsConfig(legacyConfig: Record<string, any>) {
  const widgets: Array<Array<{ id: string; type: string; properties: Record<string, any> }>> =
    Array.isArray(legacyConfig.widgets) ? legacyConfig.widgets : [[], [], []]

  const glanceables: Array<{ type: string; properties: Record<string, any> }> =
    Array.isArray(legacyConfig.glanceables) ? legacyConfig.glanceables : []

  const [leftWidgets = [], middleWidgets = [], rightWidgets = []] = widgets

  function buildColumnWidgets(
    columnWidgets: Array<{ id: string; type: string; properties: Record<string, any> }>
  ) {
    const typeCounts = new Map<string, number>()
    for (const w of columnWidgets) {
      typeCounts.set(w.type, (typeCounts.get(w.type) ?? 0) + 1)
    }

    const typeSeenCount = new Map<string, number>()
    const result: Record<string, { height: string; [key: string]: any }> = {}

    for (const widget of columnWidgets) {
      const isDuplicate = (typeCounts.get(widget.type) ?? 0) > 1
      typeSeenCount.set(widget.type, (typeSeenCount.get(widget.type) ?? 0) + 1)
      const key = isDuplicate ? widget.id : widget.type

      result[key] = {
        height: "$main-clock",
        ...widget.properties,
      }
    }

    return result
  }

  const glanceablesMapped = Object.fromEntries(
    glanceables.map((g) => [g.type, g.properties ?? {}])
  )

  const middleExtra = middleWidgets.reduce(
    (acc, widget, i) => {
      const isDuplicate = middleWidgets.filter((w) => w.type === widget.type).length > 1
      const key = isDuplicate ? widget.id : widget.type
      acc[key] = { index: i + 3, ...widget.properties }
      return acc
    },
    {} as Record<string, any>
  )

  return {
    template: "main",
    columns: {
      left: buildColumnWidgets(leftWidgets),
      middle: {
        "main-clock": { index: 0, glanceables: glanceablesMapped },
        "search-bar": { index: 1 },
        "link-view": { index: 2 },
        ...middleExtra,
      },
      right: buildColumnWidgets(rightWidgets),
    },
  }

}

export async function migrateLegacyPageConfig(userId: string) {
  const pb = await getSuperuserPB();

  const records = await listPageConfigRecords(pb, userId);
  const legacy = records.find((record) => !String(record.pageName ?? "").trim());

  if (!legacy) {
    return { success: true, migrated: false, reason: "No legacy pageConfig record found" };
  }

  const legacyConfig = asObject(legacy.config);
  const prefs = extractPreferencesFromLegacyConfig(legacyConfig);

  await pb.collection("users").update(userId, {
    appearancePreferences: prefs.appearancePreferences,
    localizationPreferences: prefs.localizationPreferences,
    searchPreferences: prefs.searchPreferences,
  });

  await replaceHomeLinksFromLegacyConfig(
    pb,
    userId,
    Array.isArray(legacyConfig.links) ? legacyConfig.links : [],
    Array.isArray(legacyConfig.linkGroups) ? legacyConfig.linkGroups : []
  );

  const pageOnlyConfig = stripMigratedSectionsFromConfig(legacyConfig);
  const migratedWidgetsConfig = migrateWidgetsConfig(legacyConfig);

  await pb.collection("pageConfig").update(legacy.id, {
    pageName: "home",
    config: {
      ...pageOnlyConfig,
      ...migratedWidgetsConfig,
    },
  });

  return {
    success: true,
    migrated: true,
    pageName: "home",
  };
}