import { ApiActionError } from "./auth";
import { config } from "../config";
import { getServerPB, getSuperuserPB } from "../pb/pocketbase";

export interface LinkList {
    collectionId: string;
    collectionName: "linksLists";
    id: string;
    name: string;
    description: string;
    icon: string;
    user: string;
    type: "user-defined" | "system";
    created: string;
    updated: string;
}

export interface LinkTag {
    collectionId: string;
    collectionName: "linksTags";
    id: string;
    name: string;
    color: string;
    created: string;
    updated: string;
}

export interface LinkFolder {
    collectionId: string;
    collectionName: "linksFolders";
    id: string;
    list: string;
    name: string;
    icon: string;
    parentFolder?: string;
    tags?: string[];
    created: string;
    updated: string;
}

export interface HomeLinkFolderPathItem {
    id: string;
    name: string;
    icon: string;
    parentFolder?: string;
}

export interface LinkItem {
    collectionId: string;
    collectionName: "linkItems";
    id: string;
    url: string;
    title: string;
    iconUrl: string;
    description: string;
    collection: string;
    folder?: string;
    tags?: string[];
    created: string;
    updated: string;
}

interface HomeLinkInput {
    name: string;
    url: string;
    icon?: string;
    linkGroup: string;
    folder?: string;
}

export async function getLinksCollections(userId: string) {
    const pb = getServerPB();
    const records = await pb.collection("linksLists").getFullList({
        filter: `user = "${userId}"`,
        sort: "-created",
    });

    return records.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        icon: r.icon,
        type: r.type as LinkList["type"],
        created: r.created,
        updated: r.updated,
    }));
}

async function requireUserList(pb: ReturnType<typeof getServerPB>, userId: string, listId: string) {
    const list = await pb.collection("linksLists").getOne(listId);
    if (list.user !== userId) {
        throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });
    }

    return list;
}

export async function getLinksFolders(userId: string, listId: string) {
    const pb = getServerPB();
    await requireUserList(pb, userId, listId);

    const records = await pb.collection("linksFolders").getFullList({
        filter: `list = "${listId}"`,
        sort: "name",
    });

    return records.map((r) => ({
        id: r.id,
        name: r.name,
        icon: r.icon,
        position: (r as any).position as number | undefined,
        parentFolder: r.parentFolder as string | undefined,
        tags: Array.isArray((r as any).tags)
            ? (r as any).tags.map((tag: any) => (typeof tag === "string" ? tag : String(tag?.id ?? ""))).filter(Boolean)
            : [],
        list: r.list,
    }));
}

export async function createLinksFolder(
    userId: string,
    data: { list: string; name: string; parentFolder?: string; icon?: string },
) {
    const pb = getServerPB();
    await requireUserList(pb, userId, data.list);

    const normalizedName = String(data.name || "").trim();
    if (!normalizedName) {
        throw new Error("Folder name is required");
    }

    const parentFolderId = data.parentFolder ? String(data.parentFolder) : "";
    const folders = await pb.collection("linksFolders").getFullList({
        filter: `list = "${data.list}"`,
    });

    const existing = folders.find((folder: any) => {
        const sameParent = String(folder.parentFolder || "") === parentFolderId;
        const sameName = String(folder.name || "").trim().toLowerCase() === normalizedName.toLowerCase();
        return sameParent && sameName;
    });

    if (existing) {
        return {
            id: existing.id,
            name: existing.name,
            icon: existing.icon,
            parentFolder: existing.parentFolder as string | undefined,
            list: existing.list,
        };
    }

    const record = await pb.collection("linksFolders").create({
        list: data.list,
        name: normalizedName,
        icon: data.icon ?? "",
        ...(data.parentFolder ? { parentFolder: data.parentFolder } : {}),
    });

    return {
        id: record.id,
        name: record.name,
        icon: record.icon,
        parentFolder: record.parentFolder as string | undefined,
        list: record.list,
    };
}

export async function getLinksItems(userId: string, listId: string, folderId?: string) {
    const pb = getServerPB();
    await requireUserList(pb, userId, listId);

    let filter = `collection = "${listId}"`;
    if (folderId !== undefined && folderId !== "") {
        filter += ` && folder = "${folderId}"`;
    } else if (folderId === "") {
        filter += ` && folder = ""`;
    }

    const records = await pb.collection("linkItems").getFullList({
        filter,
        sort: "title",
    });

    return records.map((r) => ({
        id: r.id,
        url: r.url,
        title: r.title,
        iconUrl: r.iconUrl,
        description: r.description,
        collection: r.collection,
        position: (r as any).position as number | undefined,
        folder: r.folder as string | undefined,
        tags: Array.isArray((r as any).tags)
            ? (r as any).tags.map((tag: any) => (typeof tag === "string" ? tag : String(tag?.id ?? ""))).filter(Boolean)
            : [],
        created: r.created,
        updated: r.updated,
    }));
}

export async function getLinksTags() {
    const pb = getServerPB();
    const records = await pb.collection("linksTags").getFullList({
        sort: "name",
    });

    return records.map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
    }));
}

export async function createLinkTag(
    userId: string,
    data: { name: string; color?: string },
): Promise<{ id: string; name: string; color: string }> {
    const pb = getServerPB();
    const normalizedName = String(data.name || "").trim();

    if (!normalizedName) {
        throw new Error("Tag name is required");
    }

    void userId;

    const record = await pb.collection("linksTags").create({
        name: normalizedName,
        color: data.color ?? "",
    });

    return {
        id: record.id,
        name: record.name,
        color: record.color,
    };
}

export async function updateCollection(
    userId: string,
    listId: string,
    data: { name?: string; description?: string },
): Promise<{ id: string; name: string; description: string; type: string }> {
    const pb = getServerPB();

    const list = await pb.collection("linksLists").getOne(listId);
    if (list.user !== userId) throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });

    const record = await pb.collection("linksLists").update(listId, {
        ...(data.name !== undefined && { name: String(data.name).trim() }),
        ...(data.description !== undefined && { description: data.description ?? "" }),
    });

    return {
        id: record.id,
        name: record.name,
        description: record.description,
        type: record.type,
    };
}

export async function updateLinkTag(
    userId: string,
    tagId: string,
    data: { name?: string; color?: string },
): Promise<{ id: string; name: string; color: string }> {
    const pb = getServerPB();
    void userId;

    const record = await pb.collection("linksTags").update(tagId, {
        ...(data.name !== undefined && { name: String(data.name).trim() }),
        ...(data.color !== undefined && { color: data.color ?? "" }),
    });

    return {
        id: record.id,
        name: record.name,
        color: record.color,
    };
}

function buildFolderPathResolver(
    folders: HomeLinkFolderPathItem[],
) {
    const folderById = new Map(folders.map((f) => [f.id, f]));

    return function resolvePath(folderId: string): HomeLinkFolderPathItem[] {
        const path: HomeLinkFolderPathItem[] = [];
        let current = folderById.get(folderId);
        while (current) {
            path.unshift(current);
            current = current.parentFolder
                ? folderById.get(current.parentFolder)
                : undefined;
        }
        return path;
    };
}

function getMonitorLinkId(monitor: { sourcelinkId?: string; linkId?: string }) {
    return String(monitor.sourcelinkId || monitor.linkId || "").trim();
}

function parseStatusCodes(raw: unknown): number[] | undefined {
    if (raw === undefined || raw === null || raw === "") return undefined;

    const normalize = (value: unknown) => {
        if (!Array.isArray(value)) return [] as number[];

        return value
            .map((entry) => Number(entry))
            .filter((code) => Number.isInteger(code) && code >= 100 && code <= 599);
    };

    if (Array.isArray(raw)) {
        const codes = normalize(raw);
        return codes.length > 0 ? Array.from(new Set(codes)) : undefined;
    }

    if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (!trimmed) return undefined;

        try {
            return parseStatusCodes(JSON.parse(trimmed));
        } catch {
            const codes = trimmed
                .split(",")
                .map((entry) => Number(entry.trim()))
                .filter((code) => Number.isInteger(code) && code >= 100 && code <= 599);

            return codes.length > 0 ? Array.from(new Set(codes)) : undefined;
        }
    }

    if (typeof raw === "object") {
        return parseStatusCodes((raw as { acceptStatusCodes?: unknown }).acceptStatusCodes);
    }

    return undefined;
}

async function syncHomeLinkMonitor(
    userId: string,
    linkId: string,
    endpoint: string,
    statusCheck?: boolean,
) {
    if (statusCheck === undefined) return;

    try {
        const pb = await getSuperuserPB();
        const monitors = await pb.collection("monitors").getFullList({
            filter: `userId = "${userId}"`,
        });
        const existing = monitors.find((monitor: any) => getMonitorLinkId(monitor) === linkId) as any;

        if (statusCheck) {
            const payload = {
                userId,
                endpoint,
                method: existing?.method || "GET",
                sourcelinkId: linkId,
                status: existing?.status || "initiated",
                pingAvgLatency: existing?.pingAvgLatency ?? JSON.stringify({ avgMs: 0, samples: 0 }),
                pingOutliers: Array.isArray(existing?.pingOutliers) ? existing.pingOutliers : [],
                pingOutlierThreshold: existing?.pingOutlierThreshold ?? {
                    type: config.MONITORING_OUTLIER_THRESHOLD_TYPE,
                    value: config.MONITORING_OUTLIER_THRESHOLD_VALUE,
                },
                notifyOnStatusChange: Boolean(existing?.notifyOnStatusChange),
                notifyTopicId: String(existing?.notifyTopicId ?? ""),
            };

            if (existing) {
                await pb.collection("monitors").update(existing.id, payload);
                return;
            }

            await pb.collection("monitors").create(payload);
            return;
        }

        if (existing) {
            await pb.collection("monitors").delete(existing.id);
        }
    } catch (error) {
        console.error("[links] failed to sync monitoring job", error);
    }
}

const homeListIdByUser = new Map<string, string>();

async function getHomeListId(userId: string) {
    const pb = getServerPB();

    const cachedHomeListId = homeListIdByUser.get(userId);
    if (cachedHomeListId) return cachedHomeListId;

    const list = await pb.collection("linksLists").getFirstListItem(
        `user = "${userId}" && type = "home"`,
        { fields: "id", skipTotal: true },
    );
    homeListIdByUser.set(userId, list.id);
    return list.id;
}

export async function getHomeLinks(userId: string) {

    const pb = getServerPB();
    const userHomeListId = await getHomeListId(userId);
    const monitorByLinkId = new Map<string, any>();

    try {
        const monitorPB = await getSuperuserPB();
        const monitors = await monitorPB.collection("monitors").getFullList({
            filter: `userId = "${userId}"`,
        });
        for (const monitor of monitors as any[]) {
            monitorByLinkId.set(getMonitorLinkId(monitor), monitor);
        }
    } catch {
        // ignore monitoring lookup failures; home links should still load
    }

    const [records, folders] = await Promise.all([
        pb.collection("linkItems").getFullList({
            filter: `collection = "${userHomeListId}"`,
            sort: "title",
        }),
        pb.collection("linksFolders").getFullList({
            filter: `list = "${userHomeListId}"`,
            sort: "name",
        }),
    ]).catch(() => [[], []]);

    if (!records.length) return [];

    const resolvePath = buildFolderPathResolver(
        folders.map((f) => ({
            id: f.id,
            name: f.name,
            icon: f.icon,
            parentFolder: f.parentFolder,
        })),
    );

    return records.map((r) => {
        const path = r.folder ? resolvePath(r.folder) : [];
        const collectionFolder = path[0];
        const nestedFolder = path[1];
        const monitor = monitorByLinkId.get(String(r.id || "")) as any;
        return {
            id: r.id as string,
            url: r.url as string,
            title: r.title as string,
            iconUrl: r.iconUrl as string,
            description: r.description as string,
            position: (r as any).position as number | undefined,
            collection: collectionFolder?.name ?? "",
            collectionId: collectionFolder?.id,
            folder: nestedFolder?.name ?? "",
            folderId: nestedFolder?.id,
            folderIcon: nestedFolder?.icon ?? "",
            statusCheck: Boolean(monitor),
            statusCheckEndpoint: monitor?.endpoint ?? r.url,
            statusCheckMethod: monitor?.method || "GET",
            statusCheckAuth: monitor?.endpointAuth,
            statusCheckShowAsUp: parseStatusCodes(monitor?.responseUpFilter),
            tags: Array.isArray((r as any).tags)
                ? (r as any).tags.map((tag: any) => (typeof tag === "string" ? tag : String(tag?.id ?? ""))).filter(Boolean)
                : [],
            updated: r.updated as string,
        };
    });
}

async function getOrCreateHomeCollection(pb: any, userId: string) {
    let homeCollection = await pb
        .collection("linksLists")
        .getFirstListItem(`user = "${userId}" && type = "home"`)
        .catch(() => null);

    if (!homeCollection) {
        homeCollection = await pb.collection("linksLists").create({
            user: userId,
            type: "home",
            name: "Home",
            description: "",
        });
    }

    return homeCollection;
}

async function getOrCreateFolderInList(
    pb: any,
    listId: string,
    name: string,
    parentFolderId?: string,
) {
    const normalized = String(name || "").trim();
    if (!normalized) return undefined;

    const folders = await pb.collection("linksFolders").getFullList({
        filter: `list = "${listId}"`,
    });

    const existing = folders.find((folder: any) => {
        const sameParent =
            String(folder.parentFolder || "") === String(parentFolderId || "");
        const sameName =
            String(folder.name || "").trim().toLowerCase() ===
                normalized.toLowerCase();
        return sameParent && sameName;
    });

    if (existing) return existing.id as string;

    const created = await pb.collection("linksFolders").create({
        list: listId,
        name: normalized,
        icon: "",
        ...(parentFolderId ? { parentFolder: parentFolderId } : {}),
    });

    return created.id as string;
}

export async function getHomeLinkGroups(userId: string): Promise<string[]> {
    const pb = getServerPB();
    const homeCollection = await pb
        .collection("linksLists")
        .getFirstListItem(`user = "${userId}" && type = "home"`)
        .catch(() => null);

    if (!homeCollection) return [];

    const folders = await pb.collection("linksFolders").getFullList({
        filter: `list = "${homeCollection.id}"`,
        sort: "name",
    });

    const groups = folders
        .filter((folder: any) => !folder.parentFolder)
        .map((folder: any) => String(folder.name || "").trim())
        .filter(Boolean);

    return Array.from(new Set(groups));
}

export async function createHomeLinkGroup(
    userId: string,
    name: string,
): Promise<{ id: string; name: string }> {
    const pb = getServerPB();
    const normalizedName = String(name || "").trim();

    if (!normalizedName) {
        throw new Error("Link group name is required");
    }

    const homeCollection = await getOrCreateHomeCollection(pb, userId);
    const folderId = await getOrCreateFolderInList(
        pb,
        homeCollection.id,
        normalizedName,
    );

    return {
        id: folderId!,
        name: normalizedName,
    };
}

export async function updateHomeLinkFolderIcon(
    userId: string,
    folderId: string,
    data: { icon?: string },
): Promise<{ id: string; name: string; icon: string }> {
    const pb = getServerPB();
    const folder = await pb.collection("linksFolders").getOne(folderId);
    const list = await pb.collection("linksLists").getOne(folder.list);

    if (list.user !== userId || list.type !== "home") {
        throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });
    }

    const updated = await pb.collection("linksFolders").update(folderId, {
        icon: data.icon ?? "",
    });

    return {
        id: updated.id,
        name: updated.name,
        icon: updated.icon,
    };
}

export async function createHomeLinkItem(
    userId: string,
    data: {
        url: string;
        title: string;
        iconUrl?: string;
        description?: string;
        linkGroup?: string;
        folder?: string;
        statusCheck?: boolean;
    },
): Promise<
    {
        id: string;
        url: string;
        title: string;
        iconUrl: string;
        description: string;
        collection: string;
        folder?: string;
    }
> {
    const pb = getServerPB();
    const homeCollection = await getOrCreateHomeCollection(pb, userId);

    const existingLinks = await pb.collection("linkItems").getFullList({
        filter: `collection = "${homeCollection.id}"`,
        fields: "id,position",
    });
    const nextPosition = existingLinks.reduce((max, record) => {
        const position = typeof (record as any).position === "number" && Number.isFinite((record as any).position)
            ? (record as any).position
            : -1;
        return Math.max(max, position);
    }, -1) + 1;

    let folderId: string | undefined;
    const groupName = String(data.linkGroup || "").trim();
    const childFolderName = String(data.folder || "").trim();

    if (groupName) {
        const topFolderId = await getOrCreateFolderInList(
            pb,
            homeCollection.id,
            groupName,
        );
        folderId = topFolderId;
        if (childFolderName) {
            folderId = await getOrCreateFolderInList(
                pb,
                homeCollection.id,
                childFolderName,
                topFolderId,
            );
        }
    }

    const record = await pb.collection("linkItems").create({
        url: data.url,
        title: data.title,
        iconUrl: data.iconUrl ?? "",
        description: data.description ?? "",
        collection: homeCollection.id,
        folder: folderId ?? "",
        position: nextPosition,
    });

    await syncHomeLinkMonitor(userId, record.id, record.url, data.statusCheck);

    return {
        id: record.id,
        url: record.url,
        title: record.title,
        iconUrl: record.iconUrl,
        description: record.description,
        collection: record.collection,
        folder: record.folder || undefined,
    };
}

export type HomeLink = Awaited<ReturnType<typeof getHomeLinks>>[number];

export async function setHomeLinks(
    userId: string,
    json: string,
): Promise<void> {
    const pb = getServerPB();
    const inputs: HomeLinkInput[] = JSON.parse(json);

    let homeCollection = await pb
        .collection("linksLists")
        .getFirstListItem(`user = "${userId}" && type = "home"`)
        .catch(() => null);

    if (!homeCollection) {
        homeCollection = await pb.collection("linksLists").create({
            user: userId,
            type: "home",
            name: "Home",
            description: "",
        });
    }

    const listId = homeCollection?.id;

    const existingItems = await pb.collection("linkItems").getFullList({
        filter: `collection = "${listId}"`,
    });
    await Promise.all(
        existingItems.map((item) => pb.collection("linkItems").delete(item.id)),
    );

    const existingFolders = await pb.collection("linksFolders").getFullList({
        filter: `list = "${listId}"`,
    });

    const folderCache = new Map<string, string>(
        existingFolders.map((f) => [`${f.parentFolder ?? ""}|${f.name}`, f.id]),
    );

    async function getOrCreateFolder(
        name: string,
        parentFolderId?: string,
    ): Promise<string> {
        const cacheKey = `${parentFolderId ?? ""}|${name}`;
        if (folderCache.has(cacheKey)) return folderCache.get(cacheKey)!;

        const record = await pb.collection("linksFolders").create({
            list: listId,
            name,
            icon: "",
            ...(parentFolderId ? { parentFolder: parentFolderId } : {}),
        });

        folderCache.set(cacheKey, record.id);
        return record.id;
    }

    await Promise.all(
        inputs.map(async (input) => {
            const topFolderId = await getOrCreateFolder(input.linkGroup);
            const folderId = input.folder
                ? await getOrCreateFolder(input.folder, topFolderId)
                : topFolderId;

            await pb.collection("linkItems").create({
                url: input.url,
                title: input.name,
                iconUrl: input.icon ?? "",
                description: "",
                collection: listId,
                folder: folderId,
            });
        }),
    );
}

export async function updateHomeLinkItem(
    userId: string,
    linkId: string,
    data: {
        url?: string;
        title?: string;
        iconUrl?: string;
        description?: string;
        linkGroup?: string;
        folder?: string;
        statusCheck?: boolean;
    },
): Promise<void> {
    const pb = getServerPB();

    const item = await pb.collection("linkItems").getOne(linkId);
    const list = await pb.collection("linksLists").getOne(item.collection);
    if (list.user !== userId || list.type !== "home") {
        throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });
    }

    const updateData: any = {};
    if (data.url !== undefined) updateData.url = data.url;
    if (data.title !== undefined) updateData.title = data.title;
    if (data.iconUrl !== undefined) updateData.iconUrl = data.iconUrl;
    if (data.description !== undefined) updateData.description = data.description;

    if (data.linkGroup !== undefined || data.folder !== undefined) {
        const homeListId = await getHomeListId(userId);
        let folderId: string | undefined;
        const groupName = String(data.linkGroup || "").trim();
        const childFolderName = String(data.folder || "").trim();

        if (groupName) {
            const topFolderId = await getOrCreateFolderInList(
                pb,
                homeListId,
                groupName,
            );
            folderId = topFolderId;
            if (childFolderName) {
                folderId = await getOrCreateFolderInList(
                    pb,
                    homeListId,
                    childFolderName,
                    topFolderId,
                );
            }
        }

        updateData.folder = folderId ?? "";
    }

    await pb.collection("linkItems").update(linkId, updateData);
    await syncHomeLinkMonitor(userId, linkId, String(updateData.url ?? item.url ?? ""), data.statusCheck);
}

export async function reorderLinks(
    userId: string,
    items: { id: string; type: "link" | "folder"; position: number }[],
): Promise<void> {
    const pb = getServerPB();

    await Promise.all(
        items.map(async (item) => {
            if (item.type === "link") {
                await pb.collection("linkItems").update(item.id, { position: item.position });
            } else {
                await pb.collection("linksFolders").update(item.id, { position: item.position });
            }
        })
    );
}

export async function createCollection(
    userId: string,
    data: { name: string; description?: string; icon?: string },
): Promise<{ id: string; name: string; description: string; icon: string; type: string }> {
    const pb = getServerPB();

    const record = await pb.collection("linksLists").create({
        user: userId,
        type: "user-defined",
        name: data.name,
        description: data.description ?? "",
        icon: data.icon ?? "",
    });

    return {
        id: record.id,
        name: record.name,
        description: record.description,
        icon: record.icon,
        type: record.type,
    };
}

export async function deleteCollection(
    userId: string,
    listId: string,
): Promise<void> {
    const pb = getServerPB();

    const list = await pb.collection("linksLists").getOne(listId);
    if (list.user !== userId) throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });

    const [items, folders] = await Promise.all([
        pb.collection("linkItems").getFullList({
            filter: `collection = "${listId}"`,
        }),
        pb.collection("linksFolders").getFullList({
            filter: `list = "${listId}"`,
        }),
    ]);

    try {
        const monitorPB = await getSuperuserPB();
        const linkIds = new Set(items.map((item) => String(item.id || "")));
        const monitors = await monitorPB.collection("monitors").getFullList({
            filter: `userId = "${userId}"`,
        });
        await Promise.all(
            monitors
                .filter((monitor: any) => linkIds.has(getMonitorLinkId(monitor)))
                .map((monitor: any) => monitorPB.collection("monitors").delete(monitor.id)),
        );
    } catch {
        // ignore monitoring cleanup failures; collection delete should continue
    }

    await Promise.all([
        ...items.map((i) => pb.collection("linkItems").delete(i.id)),
        ...folders.map((f) => pb.collection("linksFolders").delete(f.id)),
    ]);

    await pb.collection("linksLists").delete(listId);
}

export async function createLinkItem(data: {
    url: string;
    title: string;
    iconUrl?: string;
    description?: string;
    collection: string;
    folder?: string;
    tags?: string[];
}): Promise<{
    id: string;
    url: string;
    title: string;
    iconUrl: string;
    description: string;
    collection: string;
    folder?: string;
    created: string;
    updated: string;
}> {
    const pb = getServerPB();

    const record = await pb.collection("linkItems").create({
        url: data.url,
        title: data.title,
        iconUrl: data.iconUrl ?? "",
        description: data.description ?? "",
        collection: data.collection,
        folder: data.folder ?? "",
        tags: Array.isArray(data.tags) ? data.tags : [],
    });

    return {
        id: record.id,
        url: record.url,
        title: record.title,
        iconUrl: record.iconUrl,
        description: record.description,
        collection: record.collection,
        folder: record.folder || undefined,
        created: record.created,
        updated: record.updated,
    };
}

export async function createCollectionLinkItem(
    userId: string,
    data: {
        url: string;
        title: string;
        iconUrl?: string;
        description?: string;
        collection: string;
        folder?: string;
        tags?: string[];
    },
): Promise<{
    id: string;
    url: string;
    title: string;
    iconUrl: string;
    description: string;
    collection: string;
    folder?: string;
    created: string;
    updated: string;
}> {
    const pb = getServerPB();
    const list = await pb.collection("linksLists").getOne(data.collection);

    if (list.user !== userId) {
        throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });
    }

    return createLinkItem(data);
}

export async function updateLinkItem(
    itemId: string,
    data: {
        url?: string;
        title?: string;
        iconUrl?: string;
        description?: string;
        folder?: string;
    },
): Promise<
    {
        id: string;
        url: string;
        title: string;
        iconUrl: string;
        description: string;
        collection: string;
        folder?: string;
    }
> {
    const pb = getServerPB();

    const record = await pb.collection("linkItems").update(itemId, {
        ...(data.url !== undefined && { url: data.url }),
        ...(data.title !== undefined && { title: data.title }),
        ...(data.iconUrl !== undefined && { iconUrl: data.iconUrl }),
        ...(data.description !== undefined &&
            { description: data.description }),
        ...(data.folder !== undefined && { folder: data.folder }),
    });

    return {
        id: record.id,
        url: record.url,
        title: record.title,
        iconUrl: record.iconUrl,
        description: record.description,
        collection: record.collection,
        folder: record.folder || undefined,
    };
}

export async function deleteLinkItem(
    userId: string,
    linkId: string,
): Promise<void> {
    const pb = getServerPB();

    const item = await pb.collection("linkItems").getOne(linkId);
    const list = await pb.collection("linksLists").getOne(item.collection);
    if (list.user !== userId) throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });

    try {
        const monitorPB = await getSuperuserPB();
        const monitors = await monitorPB.collection("monitors").getFullList({
            filter: `userId = "${userId}"`,
        });
        const linkedMonitor = monitors.find((monitor: any) => getMonitorLinkId(monitor) === linkId) as any;
        if (linkedMonitor) {
            await monitorPB.collection("monitors").delete(linkedMonitor.id);
        }
    } catch (error) {
        console.error("[links] failed to delete monitoring job", error);
    }

    await pb.collection("linkItems").delete(linkId);
}
