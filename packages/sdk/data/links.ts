import { getServerPB } from "../lib/pocketbase";

export interface LinkList {
    collectionId: string;
    collectionName: "linksLists";
    id: string;
    name: string;
    description: string;
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
    created: string;
    updated: string;
}

// Shape accepted by setHomeLinks
interface HomeLinkInput {
    name: string;
    url: string;
    icon?: string;
    linkGroup: string; // maps to top-level folder name
    folder?: string; // maps to nested folder name (child of linkGroup)
}

// ─── Read helpers ────────────────────────────────────────────────────────────

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
        type: r.type as LinkList["type"],
        created: r.created,
        updated: r.updated,
    }));
}

export async function getLinksFolders(listId: string) {
    const pb = getServerPB();
    const records = await pb.collection("linksFolders").getFullList({
        filter: `list = "${listId}"`,
        sort: "name",
    });

    return records.map((r) => ({
        id: r.id,
        name: r.name,
        icon: r.icon,
        parentFolder: r.parentFolder as string | undefined,
        list: r.list,
    }));
}

export async function getLinksItems(listId: string, folderId?: string) {
    const pb = getServerPB();

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
        folder: r.folder as string | undefined,
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

// ─── Home links ───────────────────────────────────────────────────────────────

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

// Resolve the home list ID once and cache it
let homeListId: string | null = null;

async function getHomeListId(userId: string) {
    const pb = getServerPB();

    if (homeListId) return homeListId;
    const list = await pb.collection("linksLists").getFirstListItem(
        `user = "${userId}" && type = "home"`,
        { fields: "id", skipTotal: true },
    );
    homeListId = list.id;
    return homeListId;
}

export async function getHomeLinks(userId: string) {

    const pb = getServerPB();
    const userHomeListId = await getHomeListId(userId);

    const [records, folders] = await Promise.all([
        pb.collection("linkItems").getFullList({
            filter: `collection = "${userHomeListId}"`,
            sort: "title",
            expand: "folder",
        }),
        pb.collection("linksFolders").getFullList({
            filter: `list = "${userHomeListId}"`,
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
        return {
            id: r.id as string,
            url: r.url as string,
            title: r.title as string,
            iconUrl: r.iconUrl as string,
            description: r.description as string,
            collection: collectionFolder?.name ?? "",
            collectionId: collectionFolder?.id,
            folder: nestedFolder?.name ?? "",
            folderId: nestedFolder?.id,
            folderIcon: nestedFolder?.icon ?? "",
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
        throw new Error("Unauthorized");
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

export type HomeLink = Awaited<ReturnType<typeof getHomeLinks>>[number];

/**
 * Replace all link items in the user's "home" list with the provided JSON array.
 * Folders are created on-demand by name (linkGroup = top-level, folder = child).
 * Existing items are deleted first, then recreated. Folders are reused if they
 * already exist (matched by name + parent).
 */
export async function setHomeLinks(
    userId: string,
    json: string,
): Promise<void> {
    const pb = getServerPB();
    const inputs: HomeLinkInput[] = JSON.parse(json);

    // 1. Resolve or create the home list
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

    // 2. Delete all existing link items in this list
    const existingItems = await pb.collection("linkItems").getFullList({
        filter: `collection = "${listId}"`,
    });
    await Promise.all(
        existingItems.map((item) => pb.collection("linkItems").delete(item.id)),
    );

    // 3. Load existing folders so we can reuse them
    const existingFolders = await pb.collection("linksFolders").getFullList({
        filter: `list = "${listId}"`,
    });

    // Cache: "parentId|name" -> folderId  (parentId="" means root)
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

    // 4. Create items, resolving/creating folders as needed
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

// Update a home link
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
    },
): Promise<void> {
    const pb = getServerPB();
    
    // Verify the item belongs to the user's home collection
    const item = await pb.collection("linkItems").getOne(linkId);
    const list = await pb.collection("linksLists").getOne(item.collection);
    if (list.user !== userId || list.type !== "home") {
        throw new Error("Unauthorized");
    }
    
    const updateData: any = {};
    if (data.url !== undefined) updateData.url = data.url;
    if (data.title !== undefined) updateData.title = data.title;
    if (data.iconUrl !== undefined) updateData.iconUrl = data.iconUrl;
    if (data.description !== undefined) updateData.description = data.description;
    
    // Handle folder changes
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

}
// ─── Collection CRUD ─────────────────────────────────────────────────────────

export async function createCollection(
    userId: string,
    data: { name: string; description?: string },
): Promise<{ id: string; name: string; description: string; type: string }> {
    const pb = getServerPB();

    const record = await pb.collection("linksLists").create({
        user: userId,
        type: "user-defined",
        name: data.name,
        description: data.description ?? "",
    });

    return {
        id: record.id,
        name: record.name,
        description: record.description,
        type: record.type,
    };
}

export async function deleteCollection(
    userId: string,
    listId: string,
): Promise<void> {
    const pb = getServerPB();

    // Verify ownership before deletion
    const list = await pb.collection("linksLists").getOne(listId);
    if (list.user !== userId) throw new Error("Unauthorized");

    // Cascade-delete items and folders, then the list itself
    const [items, folders] = await Promise.all([
        pb.collection("linkItems").getFullList({
            filter: `collection = "${listId}"`,
        }),
        pb.collection("linksFolders").getFullList({
            filter: `list = "${listId}"`,
        }),
    ]);

    await Promise.all([
        ...items.map((i) => pb.collection("linkItems").delete(i.id)),
        ...folders.map((f) => pb.collection("linksFolders").delete(f.id)),
    ]);

    await pb.collection("linksLists").delete(listId);
}

// ─── Link item CRUD ───────────────────────────────────────────────────────────

export async function createLinkItem(data: {
    url: string;
    title: string;
    iconUrl?: string;
    description?: string;
    collection: string;
    folder?: string;
}): Promise<
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

    const record = await pb.collection("linkItems").create({
        url: data.url,
        title: data.title,
        iconUrl: data.iconUrl ?? "",
        description: data.description ?? "",
        collection: data.collection,
        folder: data.folder ?? "",
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

    // Verify the item belongs to one of the user's lists before deleting
    const item = await pb.collection("linkItems").getOne(linkId);
    const list = await pb.collection("linksLists").getOne(item.collection);
    if (list.user !== userId) throw new Error("Unauthorized");

    await pb.collection("linkItems").delete(linkId);
}
