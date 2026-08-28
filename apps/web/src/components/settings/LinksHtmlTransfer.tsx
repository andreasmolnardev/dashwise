import { useRef, useState } from "react";
import { Icon } from "@iconify-icon/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import useAuth from "@/context/useAuth";
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

type TransferMessage = {
  variant: "success" | "error";
  title: string;
  description: string;
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

function getUniqueCollectionName(collections: LinkCollection[]) {
  const names = new Set(collections.map((collection) => collection.name.trim().toLowerCase()));
  const baseName = "Imported bookmarks";
  if (!names.has(baseName.toLowerCase())) return baseName;

  let suffix = 2;
  while (names.has(`${baseName} (${suffix})`.toLowerCase())) suffix += 1;
  return `${baseName} (${suffix})`;
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
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [message, setMessage] = useState<TransferMessage | null>(null);

  const exportLinks = async () => {
    setBusy("export");
    setMessage(null);

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
      setMessage({
        variant: "success",
        title: "Links exported",
        description: `Downloaded ${linkCount} link${linkCount === 1 ? "" : "s"} from ${result.data.length} list${result.data.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      setMessage({
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
    setMessage(null);

    try {
      const bookmarks = parseBookmarksHtml(await file.text());
      const importedCount = await withAuthRedirect(async (auth) => {
        const collections = (await getLinksCollectionsAction(auth)) as unknown as LinkCollection[];
        const createdCollection = await createLinksCollectionAction(auth, {
          name: getUniqueCollectionName(collections),
          description: `Imported from ${file.name}`,
        }) as { id: string };

        if (!createdCollection?.id) throw new Error("The imported list could not be created.");

        const existingTags = (await getLinksTagsAction(auth)) as unknown as Array<{ id: string; name: string }>;
        const tagIds = new Map(existingTags.map((tag) => [tag.name.trim().toLowerCase(), tag.id]));
        const folderIds = new Map<string, string>();

        const getOrCreateFolder = async (path: string[]) => {
          let parentId: string | undefined;
          for (const name of path) {
            const cacheKey = getFolderCacheKey(parentId, name);
            let folderId = folderIds.get(cacheKey);
            if (!folderId) {
              const folder = await createLinksFolderAction(auth, {
                list: createdCollection.id,
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

        for (const bookmark of bookmarks) {
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
            collection: createdCollection.id,
            folder: await getOrCreateFolder(bookmark.folderPath),
            tags,
          });
        }

        return bookmarks.length;
      });

      await queryClient.invalidateQueries({ queryKey: ["api", token, "links"] });
      setMessage({
        variant: "success",
        title: "Links imported",
        description: `Imported ${importedCount} link${importedCount === 1 ? "" : "s"} into a new list.`,
      });
    } catch (error) {
      setMessage({
        variant: "error",
        title: "Import failed",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="frosted border-white/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon icon="fa6-solid:bookmark" />
          HTML bookmarks
        </CardTitle>
        <CardDescription>
          Move links between Dashwise and your browser with the standard bookmark HTML format.
          Imports are added to a new list and never replace existing links.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {message && (
          <Alert variant={message.variant === "error" ? "destructive" : "default"}>
            <Icon icon={message.variant === "error" ? "fa6-solid:triangle-exclamation" : "fa6-solid:circle-check"} />
            <AlertTitle>{message.title}</AlertTitle>
            <AlertDescription>{message.description}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="frosted rounded-lg border border-white/10 p-4">
            <div className="mb-3 flex items-center gap-2 font-semibold">
              <Icon icon="fa6-solid:download" />
              Export links
            </div>
            <p className="mb-4 text-sm text-white/65">
              Download all lists, folders, titles, descriptions, icons, dates, and tags as one HTML file.
            </p>
            <Button type="button" onClick={exportLinks} disabled={busy !== null}>
              <Icon icon="fa6-solid:download" />
              {busy === "export" ? "Exporting…" : "Export HTML"}
            </Button>
          </div>

          <div className="frosted rounded-lg border border-white/10 p-4">
            <div className="mb-3 flex items-center gap-2 font-semibold">
              <Icon icon="fa6-solid:upload" />
              Import links
            </div>
            <p className="mb-4 text-sm text-white/65">
              Import a browser bookmark file. Folders and bookmark tags are recreated in a new Dashwise list.
            </p>
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
            <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={busy !== null}>
              <Icon icon="fa6-solid:upload" />
              {busy === "import" ? "Importing…" : "Choose HTML file"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
