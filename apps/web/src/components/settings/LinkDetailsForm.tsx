"use client";

import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import useAuth from "@/context/useAuth";
import { Button } from "@/components/ui/button";
import { Label } from "@radix-ui/react-label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  createHomeLinkGroupAction,
  createLinkItemAction,
  deleteLinkItemAction,
  getHomeLinkGroupsAction,
  updateHomeLinkItemAction
} from '@/lib/apiClient';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import IconPickerComponent, {
  IconResult,
  getIconifySlugFromUrl,
  getMonoIconReferenceFromUrl,
  getLocalIconSetFromUrl,
  loadIconCatalog,
} from "@/components/settings/IconPicker";
import AppIcon from "@dashwise/app-icon";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { faEllipsisV, faPaperclip } from "@fortawesome/free-solid-svg-icons";
import { Icon as Iconify } from "@iconify-icon/react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LinkType, StatusCheckAuth, StatusCheckMethod } from "@dashwise/types/sdk";

interface Icon {
  Name: string;
  Reference: string;
  SVG: "Yes" | "No";
  PNG: "Yes" | "No";
  Light: "Yes" | "No";
  Dark: "Yes" | "No";
  Category: string;
}

interface LinkDetailsFormProps {
  link?: LinkType;
  onClose?: () => void | Promise<void>;
  preselectOpenedGroup?: string;
  onOptimisticSave?: (
    link: {
      id: string;
      title: string;
      url: string;
      iconUrl: string;
      collection: string;
      folder?: string;
      statusCheck?: boolean;
    },
    mode: "create" | "update",
  ) => void | (() => void);
}

export default function LinkDetailsForm({
  link,
  onClose,
  preselectOpenedGroup,
  onOptimisticSave,
}: LinkDetailsFormProps) {
  const { token, withAuth } = useAuth();

  const [linkGroups, setLinkGroups] = useState<string[]>([]);
  const [linkGroupOpen, setLinkGroupOpen] = useState(false);
  const [linkGroupInput, setLinkGroupInput] = useState("");
  const [creatingLinkGroup, setCreatingLinkGroup] = useState(false);

  const [name, setName] = useState("");
  const [linkId, setLinkId] = useState(() => link?.id || generateRandomId());
  const [url, setUrl] = useState("");
  const [icon, setIcon] = useState<IconResult | null>(null);
  const [linkGroup, setLinkGroup] = useState(() => preselectOpenedGroup || link?.linkGroup || link?.collection || "");
  const [folder, setFolder] = useState(() => link?.folder || "");
  const [statusCheck, setStatusCheck] = useState(false);
  const [statusCheckEndpoint, setStatusCheckEndpoint] = useState("");
  const [statusCheckMethod, setStatusCheckMethod] = useState<StatusCheckMethod>("GET");
  const [statusCheckAuthType, setStatusCheckAuthType] = useState<"none" | "bearer" | "basic" | "header">("none");
  const [bearerToken, setBearerToken] = useState("");
  const [basicUsername, setBasicUsername] = useState("");
  const [basicPassword, setBasicPassword] = useState("");
  const [customHeaderName, setCustomHeaderName] = useState("");
  const [customHeaderValue, setCustomHeaderValue] = useState("");
  const [statusCheckShowAsUpRaw, setStatusCheckShowAsUpRaw] = useState("200,201,202,204,301,302,304");
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [iconEdited, setIconEdited] = useState(false);
  const [icons, setIcons] = useState<Icon[]>([]);
  const [open, setOpen] = useState(false);

  const isEditing = Boolean(link?.id);
  const missingCreateLinkGroup = !isEditing && !linkGroup.trim();

  // Load link groups (top-level folders in the user's home list)
  useEffect(() => {
    withAuth((auth) => getHomeLinkGroupsAction(auth))
      .then((data) => setLinkGroups(Array.isArray(data) ? data : []))
      .catch(console.error);
  }, [withAuth]);

  // Load icons
  useEffect(() => {
    void loadIconCatalog()
      .then((data) => setIcons(data))
      .catch(console.error);
  }, []);

  // Prefill group
  useEffect(() => {
    if (link?.linkGroup) {
      setLinkGroup(link.linkGroup);
    }
    if ((link as any)?.folder) {
      setFolder((link as any).folder);
    }
    if ((link as any)?.statusCheck) {
      setStatusCheck(Boolean((link as any).statusCheck));
    }
    const statusCheckEndpointFromLink = (link as any)?.statusCheckEndpoint;
    if (typeof statusCheckEndpointFromLink === "string") {
      setStatusCheckEndpoint(statusCheckEndpointFromLink);
    }

    const statusCheckMethodFromLink = (link as any)?.statusCheckMethod;
    if (typeof statusCheckMethodFromLink === "string") {
      setStatusCheckMethod(statusCheckMethodFromLink as StatusCheckMethod);
    }

    const statusCheckShowAsUpFromLink = (link as any)?.statusCheckShowAsUp;
    if (Array.isArray(statusCheckShowAsUpFromLink) && statusCheckShowAsUpFromLink.length > 0) {
      setStatusCheckShowAsUpRaw(
        statusCheckShowAsUpFromLink
          .map((code: unknown) => Number(code))
          .filter((code: number) => Number.isInteger(code) && code > 0)
          .join(",")
      );
    }

    const statusCheckAuth = parseStatusCheckAuth((link as any)?.statusCheckAuth);
    if (statusCheckAuth?.type === "bearer") {
      setStatusCheckAuthType("bearer");
      setBearerToken(statusCheckAuth.token ?? "");
    } else if (statusCheckAuth?.type === "basic") {
      setStatusCheckAuthType("basic");
      setBasicUsername(statusCheckAuth.username ?? "");
      setBasicPassword(statusCheckAuth.password ?? "");
    } else if (statusCheckAuth?.type === "header") {
      setStatusCheckAuthType("header");
      setCustomHeaderName(statusCheckAuth.name ?? "");
      setCustomHeaderValue(statusCheckAuth.value ?? "");
    }
  }, [link]);

  const iconRequestId = useRef(0);

  const handleNameBlur = async () => {
    if (iconEdited) return;

    const nameSnapshot = name;
    const urlSnapshot = url;
    const reqId = ++iconRequestId.current;

    const result = await getIcon(nameSnapshot, urlSnapshot);

    if (reqId !== iconRequestId.current) return;
    if (nameSnapshot !== name || urlSnapshot !== url) return;

    if (result) {
      setIcon(result);
      const hidden = document.querySelector<HTMLInputElement>('input[name="icon"]');
      if (hidden) hidden.value = String(result.url);
    }
  };

  const handleUrlBlur = async () => {
    if (iconEdited) return;

    const nameSnapshot = name;
    const urlSnapshot = url;
    const reqId = ++iconRequestId.current;

    const result = await getIcon(nameSnapshot, urlSnapshot);

    if (reqId !== iconRequestId.current) return;
    if (nameSnapshot !== name || urlSnapshot !== url) return;

    if (result) {
      setIcon(result);
      const hidden = document.querySelector<HTMLInputElement>('input[name="icon"]');
      if (hidden) hidden.value = String(result.url);
    }
  };

  useEffect(() => {
    const initialName = link?.name || link?.title;
    const initialIcon = link?.icon || link?.iconUrl;

    if (initialName && link?.url && initialIcon) {
      setName(initialName);
      setUrl(link.url);
      const iconifySlug = getIconifySlugFromUrl(initialIcon);
      const monoReference = getMonoIconReferenceFromUrl(initialIcon);
      const localIconSet = getLocalIconSetFromUrl(initialIcon);

      setIcon(
        iconifySlug
          ? { url: iconifySlug, iconSet: "custom", name: iconifySlug }
          : {
            url: initialIcon,
            iconSet: localIconSet ?? (monoReference ? "mono" : "default"),
          }
      );
      setIconEdited(true);
    }
  }, [link]);

  const saveLink = async () => {
    if (!token) throw new Error("Not authenticated");
    if (missingCreateLinkGroup) throw new Error("Choose or create a link group");

    const payload: any = {
      title: name,
      url,
      iconUrl: icon?.url ?? "",
      linkGroup,
      folder,
      statusCheck,
    };

    if (isEditing && link?.id) {
      return withAuth((auth) => updateHomeLinkItemAction(auth, link.id!, payload));
    } else {
      return withAuth((auth) => createLinkItemAction(auth, payload));
    }
  };

  const filteredLinkGroups = linkGroupInput
    ? linkGroups.filter((group) =>
      group.toLowerCase().includes(linkGroupInput.toLowerCase())
    )
    : linkGroups;

  const handleSelectLinkGroup = async (value: string) => {
    const existing = linkGroups.find(
      (group) => group.toLowerCase() === value.toLowerCase()
    );
    if (existing) {
      setLinkGroup(existing);
      setLinkGroupOpen(false);
      return;
    }

    const nextName = value.trim();
    if (!nextName) return;

    try {
      setCreatingLinkGroup(true);
      const created = await withAuth((auth) => createHomeLinkGroupAction(auth, nextName));
      const nextGroup = created.name;
      setLinkGroups((prev) => Array.from(new Set([...prev, nextGroup])));
      setLinkGroup(nextGroup);
      setLinkGroupOpen(false);
      setLinkGroupInput("");
    } catch (err) {
      console.error(err);
      setError("Failed to create link group");
    } finally {
      setCreatingLinkGroup(false);
    }
  };

  const resetForm = () => {
    setName("");
    setUrl("");
    setIcon(null);
    setIconEdited(false);
    setFolder("");
    setStatusCheck(false);
    setStatusCheckEndpoint("");
    setStatusCheckMethod("GET");
    setStatusCheckAuthType("none");
    setBearerToken("");
    setBasicUsername("");
    setBasicPassword("");
    setCustomHeaderName("");
    setCustomHeaderValue("");
    setStatusCheckShowAsUpRaw("200,201,202,204,301,302,304");
    setLinkId(generateRandomId());
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const optimisticId = isEditing ? link?.id : linkId;
    const rollback = onOptimisticSave && optimisticId
      ? onOptimisticSave(
        {
          id: optimisticId,
          title: name,
          url,
          iconUrl: icon?.url ?? "",
          collection: linkGroup,
          folder: folder || undefined,
          statusCheck,
        },
        isEditing ? "update" : "create",
      )
      : undefined;

    try {
      await saveLink();
      if (onClose) await onClose();
    } catch (err) {
      if (typeof rollback === "function") rollback();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleAddAnother = async () => {
    setLoading(true);
    setError(null);

    const optimisticId = isEditing ? link?.id : linkId;
    const rollback = onOptimisticSave && optimisticId
      ? onOptimisticSave(
        {
          id: optimisticId,
          title: name,
          url,
          iconUrl: icon?.url ?? "",
          collection: linkGroup,
          folder: folder || undefined,
          statusCheck,
        },
        isEditing ? "update" : "create",
      )
      : undefined;

    try {
      await saveLink();
      resetForm();
    } catch (err) {
      if (typeof rollback === "function") rollback();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!isEditing || !link?.id) return;
    if (!confirm("Are you sure you want to delete this link?")) return;

    setDeleting(true);
    setError(null);

    try {
      await withAuth((auth) => deleteLinkItemAction(auth, link.id!));
      if (onClose) await onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="grid grid-cols-[1fr_auto_1fr] gap-2 justify-center relative"
    >
      <section className="max-h-100 overflow-scroll">
        <Label htmlFor="link-title">Name</Label>
        <Input
          id="link-title"
          className="frosted"
          placeholder="Title"
          value={name ?? ""}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleNameBlur}
        />

        <Label htmlFor="link-url">URL</Label>
        <Input
          id="link-url"
          className="frosted"
          placeholder="https://example.com"
          value={url ?? ""}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={handleUrlBlur}
        />

        <Label htmlFor="link-image">Icon</Label>
        <RadioGroup className="flex flex-wrap items-center gap-2" defaultValue="current">
          <Label
            key={name}
            className="h-8.75 w-24 frosted rounded-md flex items-center justify-center gap-2 outline-2 outline-transparent has-checked:outline-primary"
          >
            <RadioGroupItem value={name} className="hidden" />
            <Icon set={String(icon?.iconSet) || ""} url={String(icon?.url) || ""} name={String(icon?.name) || ""} />
            <span>
              {isEditing
                ? "Current"
                : "Auto"}
            </span>
          </Label>
          <Popover modal={true}>
            <PopoverTrigger>
                <Label
                className="h-8.75 frosted rounded-md flex items-center justify-center px-2 gap-2 outline-2 outline-transparent cursor-pointer"
                title="Set icon by link"
              >
                <Iconify icon="fa6-solid:paperclip" />
                <span>Link</span>
              </Label>
            </PopoverTrigger>

            <PopoverContent className="frosted p-3 text-foreground w-75">
              <div className="flex flex-col gap-2">
                <Label htmlFor="iconUrl">Icon URL</Label>
                <Input
                  id="iconUrl"
                  name="iconUrl"
                  placeholder="https://example.com/icon.svg"
                  className="frosted"
                  defaultValue={icon?.url ?? ""}
                  onChange={(e) => {
                    const url = e.target.value;
                    setIcon({ iconSet: "custom", url });
                    setIconEdited(true);

                    const hidden = document.querySelector<HTMLInputElement>('input[name="icon"]');
                    if (hidden) hidden.value = url;
                  }}
                />
              </div>
            </PopoverContent>
          </Popover>

          <Popover modal={true} open={open} onOpenChange={setOpen}>
            <PopoverTrigger>
              <Label
                key={name}
                className="h-8.75 frosted rounded-md flex items-center justify-center px-2 gap-2 outline-2 outline-transparent has-checked:outline-primary"
              >
                <Iconify icon="fa6-solid:ellipsis-vertical" />
                <span>Icon Picker</span>
              </Label>
            </PopoverTrigger>
            <PopoverContent className="frosted text-foreground">
              <IconPickerComponent
                initialIcons={icons}
                initialSelection={icon}
                onSelect={(iconObj) => {
                  setIcon(iconObj);
                  setIconEdited(true);
                  setOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
          <input type="hidden" name="icon" value={icon?.url ?? ""} />
        </RadioGroup>
        <div className="mt-3 flex items-center gap-2">
          <Switch
            id="status-checks"
            checked={statusCheck}
            onCheckedChange={(v) => setStatusCheck(Boolean(v))}
          />
          <Label htmlFor="status-checks" className="text-sm">
            Status checks
          </Label>
        </div>
        {statusCheck && (
          <p className="text-sm text-muted-foreground pt-1">
            Visit <Link to="/apps/monitoring" className="underline">
              monitoring page
            </Link> to edit this link's monitoring preferences
          </p>
        )}
      </section>

      <Separator orientation="vertical" className="frosted" />

      <section className="flex flex-col gap-1.5 justify-center pb-10">
        <div className="flex gap-2 justify-between items-center">
          <Label className="font-medium">Link Group</Label>
          <Popover open={linkGroupOpen} onOpenChange={setLinkGroupOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={linkGroupOpen}
                className={cn(
                  "rounded-full bg-white border-0 frosted w-42.5 justify-between",
                  missingCreateLinkGroup && "text-red-600 outline-2 outline-red-500"
                )}
              >
                {linkGroup || "Select or create"}
                <ChevronsUpDown className="opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-57.5 p-0">
              <Command className="text-black">
                <CommandInput
                  placeholder="Search or create group..."
                  value={linkGroupInput}
                  onValueChange={setLinkGroupInput}
                  className="h-9"
                />
                <CommandList>
                  <CommandEmpty>
                    {linkGroupInput ? `Create \"${linkGroupInput}\"` : "No groups found."}
                  </CommandEmpty>
                  <CommandGroup className="text-black">
                    {filteredLinkGroups.map((group) => (
                      <CommandItem
                        key={group}
                        value={group}
                        onSelect={() => handleSelectLinkGroup(group)}
                      >
                        {group}
                        <Check
                          className={cn(
                            "ml-auto",
                            linkGroup === group ? "opacity-100" : "opacity-0"
                          )}
                        />
                      </CommandItem>
                    ))}
                    {linkGroupInput &&
                      !linkGroups.some(
                        (group) => group.toLowerCase() === linkGroupInput.toLowerCase()
                      ) && (
                        <CommandItem
                          value={linkGroupInput}
                          disabled={creatingLinkGroup}
                          onSelect={() => handleSelectLinkGroup(linkGroupInput)}
                        >
                          {creatingLinkGroup
                            ? "Creating..."
                            : `Create \"${linkGroupInput}\"`}
                        </CommandItem>
                      )}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        {missingCreateLinkGroup && (
          <p className="text-xs text-red-500 text-right">
            Choose or create a link group.
          </p>
        )}
        <div className="flex gap-4 justify-between items-center">
          <Label className="font-medium">Folder</Label>
          <Input
            type="text"
            placeholder="optional"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            className="frosted w-36"
          />
        </div>

        <div className="mt-4">
          <p className="text-xs text-gray-400 mb-1">
            Preview {isEditing && "(Editing)"}
          </p>
          <div className="group flex flex-col items-center justify-between space-y-2 frosted rounded-2xl p-2 min-h-18 w-30 mx-auto">
            {icon?.url ? (
              <AppIcon
                source={icon.url}
                alt={icon?.name ?? "Custom Icon"}
                className="h-8.75 w-8.75 text-foreground group-hover:text-primary transition-colors"
                imageClassName="object-contain"
              />
            ) : null}
            <span className="text-sm text-white">{name || "Link name"}</span>
          </div>
        </div>
      </section>

      <div className="justify-self-end col-span-full gap-2 flex">
        {error && <p className="text-red-500">{error}</p>}
        {isEditing && (
          <Button
            type="button"
            variant="destructive"
            disabled={loading || deleting}
            onClick={handleDelete}
            className="mr-auto"
          >
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        )}
        {!isEditing && (
          <Button
            type="button"
            variant="secondary"
            disabled={loading}
            onClick={handleAddAnother}
          >
            Add Another
          </Button>
        )}

        <Button type="submit" disabled={loading || deleting}>
          {loading
            ? isEditing
              ? "Saving..."
              : "Adding..."
            : isEditing
              ? "Save"
              : "Add"}
        </Button>
      </div>
    </form>
  );
}

async function getIcon(
  name?: string,
  linkUrl?: string
): Promise<IconResult | null> {
  const testImage = (src: string): Promise<boolean> =>
    new Promise((resolve) => {
      if (!src) return resolve(false);
      const cleanSrc = src.replace("url:", "").replace("'", "").replace("'", "")
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = cleanSrc;
    });

  const normalizeUrl = (raw?: string) => {
    if (!raw) return null;
    try {
      return new URL(raw.includes("://") ? raw : `https://${raw}`);
    } catch {
      return null;
    }
  };


  if (name) {
    const safeName = name.trim().replace(/\s+/g, "-").toLowerCase();
    if (safeName) {
      const autoIcon = `url:/icons/svg/${safeName}-light.svg`;
      if (await testImage(autoIcon)) {
        return { iconSet: "mono", url: autoIcon };
      }
    }
  }

  const parsed = normalizeUrl(linkUrl);
  if (parsed) {
    const favicon = `${parsed.origin}/favicon.ico`;
    if (await testImage(favicon)) {
      return { iconSet: "custom", url: favicon };
    }

    const googleFavicon = `https://www.google.com/s2/favicons?sz=128&domain=${parsed.hostname}`;
    if (await testImage(googleFavicon)) {
      return { iconSet: "custom", url: googleFavicon };
    }
  }

  return null;
}

export function Icon({
  url,
  name,
  set,
}: {
  url: string;
  set: string | null;
  name: string | null;
}) {
  if (!url || url == "undefined") {
    return (
      <div
        className="bg-white rounded-md opacity-30 h-5.5 w-5.5"
        aria-label="icon placeholder"
      />
    );
  }

  return (
    <AppIcon
      source={url}
      alt={name ?? ""}
      className="h-5.5 w-5.5 text-white"
      imageClassName="object-contain"
    />
  );
}

function generateRandomId(length = 8) {
  return Math.random().toString(36).substr(2, length);
}

function parseStatusCodeList(raw: string): number[] {
  return raw
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((code) => Number.isInteger(code) && code >= 100 && code <= 599);
}

function parseStatusCheckAuth(raw: unknown): StatusCheckAuth | undefined {
  if (!raw) return undefined;

  let parsed: any = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  if (!parsed || typeof parsed !== "object") return undefined;

  if (parsed.type === "bearer" && typeof parsed.token === "string") {
    return { type: "bearer", token: parsed.token };
  }

  if (parsed.type === "basic" && typeof parsed.username === "string") {
    return {
      type: "basic",
      username: parsed.username,
      password: typeof parsed.password === "string" ? parsed.password : "",
    };
  }

  if (parsed.type === "header" && typeof parsed.name === "string") {
    return {
      type: "header",
      name: parsed.name,
      value: typeof parsed.value === "string" ? parsed.value : "",
    };
  }

  return undefined;
}
