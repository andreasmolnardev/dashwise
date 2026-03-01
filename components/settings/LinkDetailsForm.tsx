"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useAuth from "@/context/useAuth";
import { Button } from "@/components/ui/button";
import { Label } from "@radix-ui/react-label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { writeToConfig } from "@/lib/frontend/data/MUTATE/config/writeToConfig";
import { postConfig } from "@/lib/apiClient";
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
import { useConfig } from "@/context/ConfigContext";
import IconPickerComponent, { IconResult } from "@/components/settings/IconPicker";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { faEllipsisV, faPaperclip } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

interface Icon {
  Name: string;
  Reference: string;
  SVG: "Yes" | "No";
  PNG: "Yes" | "No";
  Light: "Yes" | "No";
  Dark: "Yes" | "No";
  Category: string;
}

type StatusCheckMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

type StatusCheckAuth =
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "header"; name: string; value: string };

export interface LinkObject {
  id?: string;
  icon?: string;
  linkGroup?: string;
  folder?: string;
  name?: string;
  url?: string;
  statusCheck?: boolean;
  statusCheckEndpoint?: string;
  statusCheckMethod?: StatusCheckMethod;
  statusCheckAuth?: StatusCheckAuth;
  statusCheckShowAsUp?: number[];
}

interface LinkDetailsFormProps {
  link?: LinkObject;
  onClose?: () => void | Promise<void>;
  preselectOpenedGroup?: string;
}

export default function LinkDetailsForm({ link, onClose, preselectOpenedGroup }: LinkDetailsFormProps) {
  const { config } = useConfig();
  const { token } = useAuth();

  const linkGroups = useMemo(() => config?.linkGroups || [], [config?.linkGroups]);
  const links = config?.links || [];

  const [name, setName] = useState("");
  const [linkId, setLinkId] = useState(() => link?.id || generateRandomId());
  const [url, setUrl] = useState("");
  const [icon, setIcon] = useState<IconResult | null>(null);
  const [linkGroup, setLinkGroup] = useState(() => preselectOpenedGroup || link?.linkGroup || "");
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
  const [error, setError] = useState<string | null>(null);

  const [iconEdited, setIconEdited] = useState(false);
  const [icons, setIcons] = useState<Icon[]>([]);
  const [open, setOpen] = useState(false);

  const isEditing = Boolean(link?.url && link?.name && link?.icon);

  // Load icons
  useEffect(() => {
    fetch("/icons/index.json")
      .then((res) => res.json())
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
    if (linkGroups.length === 0) return;
    if (link?.name && link?.url && link?.icon) {
      setName(link.name);
      setUrl(link.url);
      setIcon({ url: link.icon, iconSet: link.icon.includes("-light") ? "mono" : "custom" });
      setIconEdited(true);
    }
  }, [link, linkGroups]);

  const saveLink = async () => {
    if (!token) throw new Error("Not authenticated");

    const payload: LinkObject = {
      id: linkId,
      name,
      url,
      icon: icon?.url ?? "",
      linkGroup,
    };

    if (folder) payload.folder = folder;
    if (statusCheck) payload.statusCheck = true;
    if (statusCheck) {
      const endpoint = statusCheckEndpoint.trim();
      if (endpoint) payload.statusCheckEndpoint = endpoint;

      payload.statusCheckMethod = statusCheckMethod;

      const parsedCodes = parseStatusCodeList(statusCheckShowAsUpRaw);
      payload.statusCheckShowAsUp = parsedCodes.length > 0 ? parsedCodes : [200, 201, 202, 204, 301, 302, 304];

      if (statusCheckAuthType === "bearer" && bearerToken.trim()) {
        payload.statusCheckAuth = { type: "bearer", token: bearerToken.trim() };
      }

      if (statusCheckAuthType === "basic" && basicUsername.trim()) {
        payload.statusCheckAuth = {
          type: "basic",
          username: basicUsername.trim(),
          password: basicPassword,
        };
      }

      if (statusCheckAuthType === "header" && customHeaderName.trim()) {
        payload.statusCheckAuth = {
          type: "header",
          name: customHeaderName.trim(),
          value: customHeaderValue,
        };
      }
    }

    if (isEditing) {
      const updatedLinks = links.map((l) =>
        l.url === link?.url ? payload : l
      );
      await writeToConfig("links", updatedLinks, { token });
    } else {
      const json = await postConfig({ newItem: payload }, { qs: { path: "links" }, token });
      if (json?.error) throw new Error(json.error || "Failed to save link");
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

    try {
      await saveLink();
      if (onClose) await onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleAddAnother = async () => {
    setLoading(true);
    setError(null);

    try {
      await saveLink();
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex gap-2 justify-center relative"
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
            className="h-[35px] w-[96px] frosted rounded-md flex items-center justify-center gap-2 outline-2 outline-transparent has-checked:outline-(--primary)"
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
                className="h-[35px] frosted rounded-md flex items-center justify-center px-2 gap-2 outline-2 outline-transparent cursor-pointer"
                title="Set icon by link"
              >
                <FontAwesomeIcon icon={faPaperclip} />
                <span>Link</span>
              </Label>
            </PopoverTrigger>

            <PopoverContent className="frosted p-3 text-foreground w-[300px]">
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
                className="h-[35px] frosted rounded-md flex items-center justify-center px-2 gap-2 outline-2 outline-transparent has-checked:outline-(--primary)"
              >
                <FontAwesomeIcon icon={faEllipsisV} />
                <span>Icon Picker</span>
              </Label>
            </PopoverTrigger>
            <PopoverContent className="frosted text-foreground">
              <IconPickerComponent
                initialIcons={icons}
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
          <div className="mt-3 space-y-2 rounded-md frosted p-2">
            <div className="space-y-1">
              <Label htmlFor="status-check-endpoint" className="text-sm">Endpoint override</Label>
              <Input
                id="status-check-endpoint"
                className="frosted"
                placeholder="defaults to link URL"
                value={statusCheckEndpoint}
                onChange={(e) => setStatusCheckEndpoint(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-sm">Method</Label>
              <Select value={statusCheckMethod} onValueChange={(value) => setStatusCheckMethod(value as StatusCheckMethod)}>
                <SelectTrigger className="rounded-md bg-white border-0 frosted">
                  <SelectValue placeholder="Method" />
                </SelectTrigger>
                <SelectContent className="frosted text-white">
                  {(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as StatusCheckMethod[]).map((method) => (
                    <SelectItem key={method} value={method}>
                      {method}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-sm">Auth</Label>
              <Select value={statusCheckAuthType} onValueChange={(value) => setStatusCheckAuthType(value as "none" | "bearer" | "basic" | "header") }>
                <SelectTrigger className="rounded-md bg-white border-0 frosted">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent className="frosted text-white">
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="bearer">Bearer token</SelectItem>
                  <SelectItem value="basic">Basic auth</SelectItem>
                  <SelectItem value="header">Custom header</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {statusCheckAuthType === "bearer" && (
              <div className="space-y-1">
                <Label htmlFor="status-check-bearer" className="text-sm">Bearer token</Label>
                <Input
                  id="status-check-bearer"
                  className="frosted"
                  placeholder="token"
                  value={bearerToken}
                  onChange={(e) => setBearerToken(e.target.value)}
                />
              </div>
            )}

            {statusCheckAuthType === "basic" && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="status-check-basic-user" className="text-sm">Username</Label>
                  <Input
                    id="status-check-basic-user"
                    className="frosted"
                    placeholder="user"
                    value={basicUsername}
                    onChange={(e) => setBasicUsername(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="status-check-basic-pass" className="text-sm">Password</Label>
                  <Input
                    id="status-check-basic-pass"
                    type="password"
                    className="frosted"
                    placeholder="password"
                    value={basicPassword}
                    onChange={(e) => setBasicPassword(e.target.value)}
                  />
                </div>
              </div>
            )}

            {statusCheckAuthType === "header" && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="status-check-header-name" className="text-sm">Header name</Label>
                  <Input
                    id="status-check-header-name"
                    className="frosted"
                    placeholder="X-API-Key"
                    value={customHeaderName}
                    onChange={(e) => setCustomHeaderName(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="status-check-header-value" className="text-sm">Header value</Label>
                  <Input
                    id="status-check-header-value"
                    className="frosted"
                    placeholder="value"
                    value={customHeaderValue}
                    onChange={(e) => setCustomHeaderValue(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="status-check-up-codes" className="text-sm">Show as up (status codes)</Label>
              <Input
                id="status-check-up-codes"
                className="frosted"
                placeholder="200,201,202,204,301,302,304"
                value={statusCheckShowAsUpRaw}
                onChange={(e) => setStatusCheckShowAsUpRaw(e.target.value)}
              />
            </div>
          </div>
        )}
      </section>

      <Separator orientation="vertical" className="frosted" />

      <section className="flex flex-col gap-1.5 justify-center pb-10">
        <div className="flex gap-2 justify-between items-center">
          <Label className="font-medium">Link Group</Label>
          <Select
            defaultValue={link?.linkGroup}
            onValueChange={(v) => setLinkGroup(v)}
          >
            <SelectTrigger className="rounded-full bg-white border-0 frosted">
              <SelectValue placeholder="Link Group" />
            </SelectTrigger>
            <SelectContent className="frosted text-white">
              {linkGroups.map((grp) => (
                <SelectItem key={grp} value={grp}>
                  {grp}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
          <div className="group flex flex-col items-center justify-between space-y-2 frosted rounded-2xl p-2 min-h-18 w-[120px] mx-auto">
            {icon?.iconSet === "mono" ? (
              <div
                className="h-[35px] w-[35px] bg-white group-hover:bg-(--primary) transition"
                style={{
                  maskImage: `url(${icon.url})`,
                  WebkitMaskImage: `url(${icon.url})`,
                  maskRepeat: "no-repeat",
                  WebkitMaskRepeat: "no-repeat",
                  maskPosition: "center",
                  WebkitMaskPosition: "center",
                  maskSize: "contain",
                  WebkitMaskSize: "contain",
                }}
              />
            ) : icon?.url ? (
              <img
                src={icon.url}
                alt={icon?.name ?? "Custom Icon"}
                className="h-[35px] w-[35px] object-contain"
              />
            ) : null}
            <span className="text-sm text-white">{name || "Link name"}</span>
          </div>
        </div>
      </section>

      <div className="col-span-3 mt-2 flex gap-2 justify-end absolute bottom-2 right-2">
        {error && <p className="text-red-500">{error}</p>}
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

        <Button type="submit" disabled={loading}>
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
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = src;
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
      const autoIcon = `/icons/svg/${safeName}-light.svg`;
      if (await testImage(autoIcon)) {
        return { iconSet: "custom", url: autoIcon };
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
        className="bg-white rounded-md opacity-30 h-[22px] w-[22px]"
        aria-label="icon placeholder"
      />
    );
  }

  return set === "mono" ? (
    <div
      className="bg-white h-[22px] w-[22px]"
      style={{
        maskImage: `url(${url})`,
        WebkitMaskImage: `url(${url})`,
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
        maskSize: "contain",
        WebkitMaskSize: "contain",
      }}
    />
  ) : (
    <img
      src={url}
      alt={name ?? ""}
      className="h-[22px] w-[22px] object-contain"
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
