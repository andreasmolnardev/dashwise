import { useRef, useState } from "react";
import { Icon } from "@iconify-icon/react";
import useAuth from "@/context/useAuth";
import { useNotification } from "@/context/NotificationContext";
import {
  createLinkItemAction,
  createLinksCollectionAction,
  createLinksFolderAction,
  createLinksTagAction,
  getLinksCollectionsAction,
  getLinksFoldersAction,
  getLinksItemsAction,
  getLinksTagsAction,
} from "@/lib/apiClient";
import { useQueryClient } from "@tanstack/react-query";

type LinkCollection = {
  id: string;
  name: string;
  type?: string;
};

type LinkFolder = {
  id: string;
  name: string;
  parentFolder?: string;
};

type LinkItem = {
  id: string;
  url: string;
  title: string;
  iconUrl?: string;
  description?: string;
  folder?: string;
  tags?: string[];
  created?: string;
  updated?: string;
};

type ExportCollection = {
  collection: LinkCollection;
  folders: LinkFolder[];
  items: LinkItem[];
};

type ImportedBookmark = {
  title: string;
  url: string;
  iconUrl?: string;
  description?: string;
  tags: string[];
  folderPath: string[];
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: unknown) {
  return escapeHtml(value);
}

function dateToBookmarkTimestamp(value?: string) {
  if (!value) return undefined;
  const timestamp = Math.floor(new Date(value).getTime() / 1000);
  return Number.isFinite(timestamp) && timestamp > 0 ? String(timestamp) : undefined;
}

function renderBookmarkLink(item: LinkItem, tagsById: Map<string, string>) {
  const attrs = [
    `HREF="${escapeAttribute(item.url)}"`,
    dateToBookmarkTimestamp(item.created) ? `ADD_DATE="${dateToBookmarkTimestamp(item.created)}"` : "",
    dateToBookmarkTimestamp(item.updated) ? `LAST_MODIFIED="${dateToBookmarkTimestamp(item.updated)}"` : "",
    item.iconUrl ? `ICON="${escapeAttribute(item.iconUrl)}"` : "",
    item.description ? `DESCRIPTION="${escapeAttribute(item.description)}"` : "",
    item.tags?.length
      ? `TAGS="${escapeAttribute(item.tags.map((tagId) => tagsById.get(tagId)).filter(Boolean).join(","))}"`
      : "",
  ].filter(Boolean).join(" ");

  return `      <DT><A ${attrs}>${escapeHtml(item.title || item.url)}</A>`;
}

function renderFolderContents(
  parentFolderId: string | undefined,
  folders: LinkFolder[],
  items: LinkItem[],
  tagsById: Map<string, string>,
  visitedFolders: Set<string>,
): string[] {
  const childFolders = folders.filter(
    (folder) => String(folder.parentFolder ?? "") === String(parentFolderId ?? ""),
  );
  const childItems = items.filter(
    (item) => String(item.folder ?? "") === String(parentFolderId ?? ""),
  );

  return [
    ...childFolders.flatMap((folder) => {
      if (visitedFolders.has(folder.id)) return [];
      visitedFolders.add(folder.id);

      return [
        `      <DT><H3>${escapeHtml(folder.name)}</H3>`,
        "      <DL><p>",
        ...renderFolderContents(folder.id, folders, items, tagsById, visitedFolders),
        "      </DL><p>",
      ];
    }),
    ...childItems.map((item) => renderBookmarkLink(item, tagsById)),
  ];
}

function buildBookmarksHtml(data: ExportCollection[], tags: Array<{ id: string; name: string }>) {
  const tagsById = new Map(tags.map((tag) => [tag.id, tag.name]));
  const body = data.flatMap(({ collection, folders, items }) => [
    `    <DT><H3>${escapeHtml(collection.name)}</H3>`,
    "    <DL><p>",
    ...renderFolderContents(undefined, folders, items, tagsById, new Set<string>()),
    "    </DL><p>",
  ]);

  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Dashwise links</TITLE>
<H1>Dashwise links</H1>
<DL><p>
${body.join("\n")}
</DL><p>
`;
}

function directChild(element: Element, tagName: string) {
  return Array.from(element.children).find(
    (child) => child.tagName.toLowerCase() === tagName,
  );
}

function parseBookmarkContainer(container: Element, folderPath: string[], bookmarks: ImportedBookmark[]) {
  for (const child of Array.from(container.children)) {
    if (child.tagName.toLowerCase() !== "dt") {
      if (["dl", "p"].includes(child.tagName.toLowerCase())) {
        parseBookmarkContainer(child, folderPath, bookmarks);
      }
      continue;
    }

    const anchor = directChild(child, "a");
    const heading = directChild(child, "h3");
    const nestedContainer = directChild(child, "dl") ?? (
      child.nextElementSibling?.tagName.toLowerCase() === "dl" ? child.nextElementSibling : undefined
    );

    if (anchor) {
      const url = String(anchor.getAttribute("href") ?? "").trim();
      try {
        const parsedUrl = new URL(url);
        if (!["http:", "https:"].includes(parsedUrl.protocol)) continue;
      } catch {
        continue;
      }

      const description = anchor.getAttribute("description") || (
        child.nextElementSibling?.tagName.toLowerCase() === "dd"
          ? child.nextElementSibling.textContent?.trim()
          : undefined
      );

      bookmarks.push({
        title: anchor.textContent?.trim() || url,
        url,
        iconUrl: anchor.getAttribute("icon") || undefined,
        description: description || undefined,
        tags: (anchor.getAttribute("tags") ?? "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        folderPath,
      });
      continue;
    }

    if (heading && nestedContainer) {
      const name = heading.textContent?.trim();
      if (name) parseBookmarkContainer(nestedContainer, [...folderPath, name], bookmarks);
    }
  }
}

function parseBookmarksHtml(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  const bookmarks: ImportedBookmark[] = [];
  const rootContainers = Array.from(document.querySelectorAll("dl")).filter(
    (container) => !container.parentElement?.closest("dl"),
  );

  for (const container of rootContainers) parseBookmarkContainer(container, [], bookmarks);

  if (rootContainers.length === 0) {
    parseBookmarkContainer(document.body, [], bookmarks);
  }

  if (bookmarks.length === 0) {
    throw new Error("The selected file does not contain any http(s) bookmarks.");
  }

  return bookmarks;
}

function isHomeCollection(collection: LinkCollection) {
  return String(collection.type ?? "").trim().toLowerCase() === "home"
    || collection.name.trim().toLowerCase() === "home";
}

function getUniqueCollectionName(collections: LinkCollection[], baseName: string) {
  const names = new Set(collections.map((collection) => collection.name.trim().toLowerCase()));
  const normalizedBaseName = baseName.trim() || "Imported bookmarks";
  if (!names.has(normalizedBaseName.toLowerCase())) return normalizedBaseName;

  let suffix = 2;
  while (names.has(`${normalizedBaseName} (${suffix})`.toLowerCase())) suffix += 1;
  return `${normalizedBaseName} (${suffix})`;
}

function getFolderCacheKey(parentId: string | undefined, name: string) {
  return `${parentId ?? ""}\u0000${name.trim().toLowerCase()}`;
}

function downloadHtml(filename: string, html: string) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function LinksHtmlTransfer() {
  const { token, withAuthRedirect } = useAuth();
  const { notify } = useNotification();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);

  const exportLinks = async () => {
    setBusy("export");

    try {
      const result = await withAuthRedirect(async (auth) => {
        const collections = (await getLinksCollectionsAction(auth)) as unknown as LinkCollection[];
        const tags = (await getLinksTagsAction(auth)) as unknown as Array<{ id: string; name: string }>;
        const data = await Promise.all(
          collections.map(async (collection) => {
            const [folders, items] = await Promise.all([
              getLinksFoldersAction(auth, collection.id),
              getLinksItemsAction(auth, collection.id),
            ]);
            return {
              collection,
              folders: (Array.isArray(folders) ? folders : []) as LinkFolder[],
              items: (Array.isArray(items) ? items : []) as LinkItem[],
            };
          }),
        );

        return { data, tags };
      });

      const linkCount = result.data.reduce((count, entry) => count + entry.items.length, 0);
      const filename = `dashwise-links-${new Date().toISOString().slice(0, 10)}.html`;
      downloadHtml(filename, buildBookmarksHtml(result.data, result.tags));
      notify({
        variant: "success",
        title: "Links exported",
        description: `Downloaded ${linkCount} link${linkCount === 1 ? "" : "s"} from ${result.data.length} list${result.data.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      notify({
        variant: "error",
        title: "Export failed",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const importLinks = async (file: File) => {
    setBusy("import");

    try {
      const bookmarks = parseBookmarksHtml(await file.text());
      const importResult = await withAuthRedirect(async (auth) => {
        const collections = (await getLinksCollectionsAction(auth)) as unknown as LinkCollection[];
        const userCollections = collections.filter((collection) => !isHomeCollection(collection));
        const collectionsByName = new Map(
          userCollections.map((collection) => [collection.name.trim().toLowerCase(), collection]),
        );
        const knownCollections = [...collections];
        const folderIdsByCollection = new Map<string, Map<string, string>>();

        const existingTags = (await getLinksTagsAction(auth)) as unknown as Array<{ id: string; name: string }>;
        const tagIds = new Map(existingTags.map((tag) => [tag.name.trim().toLowerCase(), tag.id]));
        const getOrCreateCollection = async (name: string) => {
          const key = name.trim().toLowerCase();
          const existing = collectionsByName.get(key);
          if (existing?.id) return existing;

          const collection = await createLinksCollectionAction(auth, {
            name: getUniqueCollectionName(knownCollections, name),
            description: `Imported from ${file.name}`,
          }) as LinkCollection;
          if (!collection?.id) throw new Error(`Could not create list "${name}".`);

          collectionsByName.set(key, collection);
          knownCollections.push(collection);
          return collection;
        };

        const getFolderIds = async (collectionId: string) => {
          const cached = folderIdsByCollection.get(collectionId);
          if (cached) return cached;

          const existingFolders = (await getLinksFoldersAction(auth, collectionId)) as unknown as LinkFolder[];
          const folderIds = new Map<string, string>();
          for (const folder of Array.isArray(existingFolders) ? existingFolders : []) {
            if (folder.id && folder.name.trim()) {
              folderIds.set(getFolderCacheKey(folder.parentFolder, folder.name), folder.id);
            }
          }
          folderIdsByCollection.set(collectionId, folderIds);
          return folderIds;
        };

        const getOrCreateFolder = async (collectionId: string, path: string[]) => {
          let parentId: string | undefined;
          const folderIds = await getFolderIds(collectionId);
          for (const name of path) {
            const cacheKey = getFolderCacheKey(parentId, name);
            let folderId = folderIds.get(cacheKey);
            if (!folderId) {
              const folder = await createLinksFolderAction(auth, {
                list: collectionId,
                name,
                parentFolder: parentId,
              }) as { id: string };
              if (!folder?.id) throw new Error(`Could not create folder "${name}".`);
              folderId = folder.id;
              folderIds.set(cacheKey, folderId);
            }
            parentId = folderId;
          }
          return parentId;
        };

        const rootListName = getUniqueCollectionName(
          knownCollections,
          file.name.replace(/\.[^.]+$/, ""),
        );
        const importedCollectionIds = new Set<string>();

        for (const bookmark of bookmarks) {
          const collectionName = bookmark.folderPath[0] || rootListName;
          const collection = await getOrCreateCollection(collectionName);
          importedCollectionIds.add(collection.id);
          const tags = [] as string[];
          for (const tagName of bookmark.tags) {
            const key = tagName.toLowerCase();
            let tagId = tagIds.get(key);
            if (!tagId) {
              const createdTag = await createLinksTagAction(auth, { name: tagName }) as { id: string };
              if (createdTag?.id) {
                tagId = createdTag.id;
                tagIds.set(key, tagId);
              }
            }
            if (tagId) tags.push(tagId);
          }

          await createLinkItemAction(auth, {
            url: bookmark.url,
            title: bookmark.title,
            iconUrl: bookmark.iconUrl,
            description: bookmark.description,
            collection: collection.id,
            folder: await getOrCreateFolder(collection.id, bookmark.folderPath.slice(1)),
            tags,
          });
        }

        return { count: bookmarks.length, collectionCount: importedCollectionIds.size };
      });

      await queryClient.invalidateQueries({ queryKey: ["api", token, "links"] });
      notify({
        variant: "success",
        title: "Links imported",
        description: `Imported ${importResult.count} link${importResult.count === 1 ? "" : "s"} into ${importResult.collectionCount} list${importResult.collectionCount === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      notify({
        variant: "error",
        title: "Import failed",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".html,.htm,text/html"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void importLinks(file);
        }}
      />

      <button
        type="button"
        onClick={() => void exportLinks()}
        disabled={busy !== null}
        className="flex w-full items-center gap-2 rounded-md border border-transparent p-1.5 text-left hover-frosted disabled:cursor-wait disabled:opacity-50"
      >
        <Icon icon="fa6-solid:download" />
        <p className="w-full">{busy === "export" ? "Exporting..." : "Export Links as HTML"}</p>
        <Icon icon="fa6-solid:caret-right" />
      </button>

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy !== null}
        className="flex w-full items-center gap-2 rounded-md border border-transparent p-1.5 text-left hover-frosted disabled:cursor-wait disabled:opacity-50"
      >
        <Icon icon="fa6-solid:upload" />
        <p className="w-full">{busy === "import" ? "Importing..." : "Import Links from HTML"}</p>
        <Icon icon="fa6-solid:caret-right" />
      </button>
    </div>
  );
}
