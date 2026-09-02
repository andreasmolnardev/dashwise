"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AppIcon from "@dashwise/app-icon";
import {
  createLinkItemAction,
  createLinksFolderAction,
  getLinksCollectionsAction,
  getLinksFoldersAction,
  getLinksMetadataAction,
  getLinksTagsAction,
} from '@/lib/apiClient';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import useAuth from "@/context/useAuth";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, FolderPlus, Link2 } from "lucide-react";

type CollectionRecord = {
  id: string;
  name: string;
  icon?: string;
  type?: string;
};

type FolderRecord = {
  id: string;
  list: string;
  name: string;
  icon?: string;
  parentFolder?: string;
};

type TagRecord = {
  id: string;
  name: string;
  color?: string;
};

type TargetOption = {
  key: string;
  collectionId: string;
  folderId?: string;
  label: string;
  searchValue: string;
  depth: number;
  icon?: string;
};

type TargetGroup = {
  collection: CollectionRecord;
  options: TargetOption[];
};

type CreatedLinkItem = {
  id: string;
  title: string;
  url: string;
  collection: string;
  folder?: string;
  created: string;
  updated: string;
  tags?: string[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultCollectionId?: string;
  defaultTagIds?: string[];
  onCreated?: (item: CreatedLinkItem) => void;
  onFolderCreated?: (folder: FolderRecord) => void;
};

function buildTargetGroups(collections: CollectionRecord[], folders: FolderRecord[]): TargetGroup[] {
  const foldersByCollection = new Map<string, FolderRecord[]>();
  for (const folder of folders) {
    const current = foldersByCollection.get(folder.list) ?? [];
    current.push(folder);
    foldersByCollection.set(folder.list, current);
  }

  const sortedCollections = [...collections].sort((left, right) => left.name.localeCompare(right.name));

  return sortedCollections.map((collection) => {
    const collectionFolders = [...(foldersByCollection.get(collection.id) ?? [])];
    const folderById = new Map(collectionFolders.map((folder) => [folder.id, folder]));
    const childrenByParent = new Map<string, FolderRecord[]>();

    for (const folder of collectionFolders) {
      const parentKey = folder.parentFolder && folderById.has(folder.parentFolder) ? folder.parentFolder : "";
      const current = childrenByParent.get(parentKey) ?? [];
      current.push(folder);
      childrenByParent.set(parentKey, current);
    }

    const sortFolders = (entries: FolderRecord[]) => [...entries].sort((left, right) => left.name.localeCompare(right.name));
    const options: TargetOption[] = [
      {
        key: `collection:${collection.id}`,
        collectionId: collection.id,
        label: collection.name,
        searchValue: collection.name,
        depth: 0,
        icon: collection.icon,
      },
    ];

    const walkFolder = (folder: FolderRecord, path: string[], depth: number) => {
      const fullPath = [...path, folder.name];
      options.push({
        key: `folder:${folder.id}`,
        collectionId: collection.id,
        folderId: folder.id,
        label: fullPath.join(" / "),
        searchValue: [collection.name, ...fullPath].join(" "),
        depth,
        icon: folder.icon || "fa6-solid:folder",
      });

      for (const child of sortFolders(childrenByParent.get(folder.id) ?? [])) {
        walkFolder(child, fullPath, depth + 1);
      }
    };

    for (const rootFolder of sortFolders(childrenByParent.get("") ?? [])) {
      walkFolder(rootFolder, [collection.name], 1);
    }

    return { collection, options };
  });
}

function TagPill({ tag, onRemove }: { tag: TagRecord; onRemove?: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium tracking-wide text-white/75"
      style={tag.color ? { borderColor: tag.color } : undefined}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tag.color || "rgba(255,255,255,0.45)" }} />
      <span>{tag.name}</span>
      {onRemove ? (
        <button type="button" onClick={onRemove} className="ml-1 text-white/45 hover:text-white" aria-label={`Remove ${tag.name}`}>
          <span aria-hidden>×</span>
        </button>
      ) : null}
    </span>
  );
}

function ListFolderPicker({
  groups,
  value,
  onChange,
  disabled,
}: {
  groups: TargetGroup[];
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(
    () => groups.flatMap((group) => group.options).find((option) => option.key === value) ?? null,
    [groups, value],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between gap-2 border-white/10 bg-white/5 text-left font-normal text-white hover:bg-white/10"
        >
          <span className="min-w-0 truncate">
            {selected ? selected.label : "Select list / folder"}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(42rem,calc(100vw-2rem))] p-0">
        <Command className="text-black">
          <CommandInput placeholder="Search lists or folders..." className="h-9" />
          <CommandList>
            <CommandEmpty>No destinations found.</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.collection.id} heading={group.collection.name} className="text-black">
                {group.options.map((option) => (
                  <CommandItem
                    key={option.key}
                    value={option.searchValue}
                    onSelect={() => {
                      onChange(option.key);
                      setOpen(false);
                    }}
                    className="gap-2"
                  >
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <AppIcon
                        source={option.icon || "fa6-solid:folder-open"}
                        alt={option.label}
                        className="h-4 w-4 shrink-0"
                        monoClassName="bg-foreground"
                        imageClassName="object-contain"
                      />
                      <span className={cn("truncate", option.depth > 0 && "pl-2")}>{option.label}</span>
                    </span>
                    <Check className={cn("ml-auto", value === option.key ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function TagMultiSelect({
  tags,
  selectedTagIds,
  onChange,
  disabled,
}: {
  tags: TagRecord[];
  selectedTagIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedTags = useMemo(
    () => selectedTagIds.map((id) => tags.find((tag) => tag.id === id)).filter((tag): tag is TagRecord => Boolean(tag)),
    [selectedTagIds, tags],
  );

  const toggleTag = (tagId: string) => {
    onChange(
      selectedTagIds.includes(tagId)
        ? selectedTagIds.filter((id) => id !== tagId)
        : [...selectedTagIds, tagId],
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-auto min-h-10 w-full justify-between gap-2 border-white/10 bg-white/5 py-2 text-left font-normal text-white hover:bg-white/10"
        >
          <span className="min-w-0 flex-1 text-left">
            {selectedTags.length > 0 ? (
              <span className="flex flex-wrap gap-1.5">
                {selectedTags.slice(0, 3).map((tag) => (
                  <TagPill key={tag.id} tag={tag} />
                ))}
                {selectedTags.length > 3 ? (
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/65">
                    +{selectedTags.length - 3}
                  </span>
                ) : null}
              </span>
            ) : (
              "Select tags"
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(32rem,calc(100vw-2rem))] p-0">
        <Command className="text-black">
          <CommandInput placeholder="Search tags..." className="h-9" />
          <CommandList>
            <CommandEmpty>No tags found.</CommandEmpty>
            <CommandGroup className="text-black">
              {tags.map((tag) => (
                <CommandItem key={tag.id} value={tag.name} onSelect={() => toggleTag(tag.id)}>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tag.color || "rgba(255,255,255,0.45)" }} />
                    <span>{tag.name}</span>
                  </span>
                  <Check className={cn("ml-auto", selectedTagIds.includes(tag.id) ? "opacity-100" : "opacity-0")} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function CreateLinksItemDialog({
  open,
  onOpenChange,
  defaultCollectionId,
  defaultTagIds = [],
  onCreated,
  onFolderCreated,
}: Props) {
  const { withAuth } = useAuth();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [iconUrl, setIconUrl] = useState("");
  const [description, setDescription] = useState("");
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [selectedTargetKey, setSelectedTargetKey] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"link" | "folder">("link");
  const [folderName, setFolderName] = useState("");
  const [loadingData, setLoadingData] = useState(false);
  const [loadingMetadata, setLoadingMetadata] = useState(false);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<{ open: boolean; title: string; description?: string; variant?: "success" | "error" }>({ open: false, title: "", description: "", variant: "success" });
  const initializedTargetRef = useRef(false);
  const metadataRequestRef = useRef(0);
  const autoMetadataRef = useRef({ title: "", iconUrl: "", description: "" });

  const defaultTagKey = defaultTagIds.join("|");

  useEffect(() => {
    if (!open) {
      initializedTargetRef.current = false;
      metadataRequestRef.current += 1;
      autoMetadataRef.current = { title: "", iconUrl: "", description: "" };
      setTitle("");
      setUrl("");
      setIconUrl("");
      setDescription("");
      setCollections([]);
      setFolders([]);
      setTags([]);
      setSelectedTargetKey("");
      setSelectedTagIds([]);
      setActiveTab("link");
      setFolderName("");
      setLoadingData(false);
      setLoadingMetadata(false);
      setSaving(false);
      setAlert({ open: false, title: "", description: "", variant: "success" });
      return;
    }

    initializedTargetRef.current = false;
    metadataRequestRef.current += 1;
    autoMetadataRef.current = { title: "", iconUrl: "", description: "" };
    setTitle("");
    setUrl("");
    setIconUrl("");
    setDescription("");
    setCollections([]);
    setFolders([]);
    setTags([]);
    setSelectedTargetKey("");
    setSelectedTagIds(defaultTagIds);
    setActiveTab("link");
    setFolderName("");
    setAlert({ open: false, title: "", description: "", variant: "success" });
    setLoadingData(true);

    let mounted = true;

    const load = async () => {
      try {
        const [collectionsData, tagsData] = await Promise.all([
          withAuth((auth) => getLinksCollectionsAction(auth)),
          withAuth((auth) => getLinksTagsAction(auth)),
        ]);

        if (!mounted) return;

        const collectionRecords = Array.isArray(collectionsData)
          ? (collectionsData as CollectionRecord[])
          : [];

        const folderResults = await Promise.all(
          collectionRecords.map(async (collection) => {
            try {
              const foldersData = await withAuth((auth) => getLinksFoldersAction(auth, collection.id));
              return {
                listId: collection.id,
                folders: Array.isArray(foldersData) ? (foldersData as FolderRecord[]) : [],
              };
            } catch (error) {
              console.error(`Failed to load folders for list ${collection.id}:`, error);
              return { listId: collection.id, folders: [] as FolderRecord[] };
            }
          }),
        );

        if (!mounted) return;

        setCollections(collectionRecords);
        setFolders(folderResults.flatMap((entry) => entry.folders));
        setTags(Array.isArray(tagsData) ? (tagsData as TagRecord[]) : []);
      } catch (error) {
        console.error("Failed to load link creation data:", error);
        if (mounted) {
          setCollections([]);
          setFolders([]);
          setTags([]);
        }
      } finally {
        if (mounted) {
          setLoadingData(false);
        }
      }
    };

    void load();

    return () => {
      mounted = false;
    };
  }, [defaultTagKey, open, withAuth]);

  useEffect(() => {
    if (!open) return;

    const requestId = ++metadataRequestRef.current;

    const candidateUrl = url.trim();
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(candidateUrl);
    } catch {
      setLoadingMetadata(false);
      return;
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      setLoadingMetadata(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      setLoadingMetadata(true);

      void withAuth((auth) => getLinksMetadataAction(auth, candidateUrl))
        .then((metadata) => {
          if (requestId !== metadataRequestRef.current) return;

          const previousAutoMetadata = autoMetadataRef.current;
          setTitle((current) => !current.trim() || current === previousAutoMetadata.title ? metadata.title : current);
          setIconUrl((current) => !current.trim() || current === previousAutoMetadata.iconUrl ? metadata.iconUrl : current);
          setDescription((current) => !current.trim() || current === previousAutoMetadata.description ? metadata.description : current);
          autoMetadataRef.current = metadata;
        })
        .catch(() => {
          // Metadata is an enhancement; the link can still be entered manually.
        })
        .finally(() => {
          if (requestId === metadataRequestRef.current) setLoadingMetadata(false);
        });
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [open, url, withAuth]);

  const targetGroups = useMemo(() => buildTargetGroups(collections, folders), [collections, folders]);
  const allTargetOptions = useMemo(() => targetGroups.flatMap((group) => group.options), [targetGroups]);
  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const selectedTarget = useMemo(
    () => allTargetOptions.find((option) => option.key === selectedTargetKey) ?? null,
    [allTargetOptions, selectedTargetKey],
  );

  useEffect(() => {
    if (!open || initializedTargetRef.current || allTargetOptions.length === 0) return;

    const preferredTarget = defaultCollectionId
      ? allTargetOptions.find((option) => option.collectionId === defaultCollectionId && !option.folderId)
        ?? allTargetOptions.find((option) => option.collectionId === defaultCollectionId)
      : allTargetOptions[0];

    if (preferredTarget) {
      setSelectedTargetKey(preferredTarget.key);
      initializedTargetRef.current = true;
    }
  }, [allTargetOptions, defaultCollectionId, open]);

  const handleSave = async () => {
    if (!title.trim() || !url.trim() || !selectedTarget) return;

    const saved = await withAuth((auth) => createLinkItemAction(auth, {
      title: title.trim(),
      url: url.trim(),
      iconUrl: iconUrl.trim() || undefined,
      description: description.trim() || undefined,
      collection: selectedTarget.collectionId,
      folder: selectedTarget.folderId,
      tags: selectedTagIds.length > 0 ? selectedTagIds : undefined,
    }));

    const createdItem = {
      ...(saved as CreatedLinkItem),
      tags: selectedTagIds,
    };

    setAlert({
      open: true,
      title: "Link created",
      description: `Created link "${title.trim()}".`,
      variant: "success",
    });

    onCreated?.(createdItem);
  };

  const handleCreateFolder = async () => {
    if (!folderName.trim() || !selectedTarget) return;

    const created = await withAuth((auth) => createLinksFolderAction(auth, {
      list: selectedTarget.collectionId,
      name: folderName.trim(),
      parentFolder: selectedTarget.folderId,
    }));

    const createdFolder = created as FolderRecord;
    setAlert({
      open: true,
      title: "Folder created",
      description: `Created folder "${folderName.trim()}".`,
      variant: "success",
    });
    onFolderCreated?.(createdFolder);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="frosted text-foreground max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add to list</DialogTitle>
        </DialogHeader>

        {alert.open && (
          <Alert className="mb-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <AlertTitle>{alert.title}</AlertTitle>
                {alert.description && <AlertDescription>{alert.description}</AlertDescription>}
              </div>
              <button
                type="button"
                aria-label="Close alert"
                onClick={() => setAlert((current) => ({ ...current, open: false }))}
                className="rounded px-2 py-1 text-sm hover:bg-muted"
              >
                Close
              </button>
            </div>
          </Alert>
        )}

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "link" | "folder")} className="space-y-5">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="link" className="gap-2">
              <Link2 />
              Add link
            </TabsTrigger>
            <TabsTrigger value="folder" className="gap-2">
              <FolderPlus />
              Add folder
            </TabsTrigger>
          </TabsList>

          <form
            className="space-y-5"
            onSubmit={async (event) => {
              event.preventDefault();

              try {
                setSaving(true);
                if (activeTab === "link") {
                  await handleSave();
                } else {
                  await handleCreateFolder();
                }
                onOpenChange(false);
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setAlert({
                  open: true,
                  title: activeTab === "link" ? "Failed to create link" : "Failed to create folder",
                  description: message,
                  variant: "error",
                });
              } finally {
                setSaving(false);
              }
            }}
          >
          <TabsContent value="link" className="space-y-5">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(15rem,0.7fr)]">
              <div className="space-y-2">
                <Label htmlFor="link-url">URL</Label>
                <Input
                  id="link-url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://n8n.io"
                  required={activeTab === "link"}
                />
                {loadingMetadata && <p className="text-xs text-white/55" aria-live="polite">Fetching link details…</p>}
              </div>

              <div className="space-y-2">
                <Label>List / folder</Label>
                <ListFolderPicker
                  groups={targetGroups}
                  value={selectedTargetKey}
                  onChange={setSelectedTargetKey}
                  disabled={loadingData || targetGroups.length === 0}
                />
              </div>
            </div>

            <div className="h-px w-full bg-white/10" />

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="link-title">Title</Label>
                <Input
                  id="link-title"
                  value={title}
                  onChange={(event) => {
                    autoMetadataRef.current.title = "";
                    setTitle(event.target.value);
                  }}
                  placeholder="n8n"
                  required={activeTab === "link"}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="link-icon">Icon URL</Label>
                <Input
                  id="link-icon"
                  value={iconUrl}
                  onChange={(event) => {
                    autoMetadataRef.current.iconUrl = "";
                    setIconUrl(event.target.value);
                  }}
                  placeholder="https://.../favicon.ico"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Tags</Label>
              <TagMultiSelect
                tags={tags}
                selectedTagIds={selectedTagIds}
                onChange={setSelectedTagIds}
                disabled={loadingData || tags.length === 0}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="link-description">Description</Label>
              <Textarea
                id="link-description"
                value={description}
                onChange={(event) => {
                  autoMetadataRef.current.description = "";
                  setDescription(event.target.value);
                }}
                rows={3}
                placeholder="Optional note"
              />
            </div>
          </TabsContent>

          <TabsContent value="folder" className="space-y-5">
            <div className="space-y-2">
              <Label>List / parent folder</Label>
              <ListFolderPicker
                groups={targetGroups}
                value={selectedTargetKey}
                onChange={setSelectedTargetKey}
                disabled={loadingData || targetGroups.length === 0}
              />
              <p className="text-xs text-white/55">Choose a folder to create a nested folder, or choose a list to create one at the top level.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="folder-name">Folder name</Label>
              <Input
                id="folder-name"
                value={folderName}
                onChange={(event) => setFolderName(event.target.value)}
                placeholder="New folder"
                required={activeTab === "folder"}
              />
            </div>
          </TabsContent>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || loadingData || !selectedTarget || (activeTab === "link" ? !title.trim() || !url.trim() : !folderName.trim())}>
              {saving ? "Creating..." : activeTab === "link" ? "Create link" : "Create folder"}
            </Button>
          </div>
          </form>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
