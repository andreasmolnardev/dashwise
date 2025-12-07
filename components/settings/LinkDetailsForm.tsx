"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@radix-ui/react-label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { writeToConfig } from "@/lib/frontend/data/write";
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
import { useRouter } from "next/navigation";
interface Icon {
  Name: string;
  Reference: string;
  SVG: "Yes" | "No";
  PNG: "Yes" | "No";
  Light: "Yes" | "No";
  Dark: "Yes" | "No";
  Category: string;
}

export interface LinkObject {
  id?: string;
  icon?: string;
  linkGroup?: string;
  folder?: string;
  name?: string;
  url?: string;
  statusCheck?: boolean;
}

interface LinkDetailsFormProps {
  link?: LinkObject;
  onClose?: () => void | Promise<void>;
  preselectOpenedGroup?: string;
}

export default function LinkDetailsForm({ link, onClose, preselectOpenedGroup }: LinkDetailsFormProps) {
  const { config, refreshConfig } = useConfig();

  const linkGroups = useMemo(() => config?.linkGroups || [], [config?.linkGroups]);
  const links = config?.links || [];

  const [name, setName] = useState("");
  const [linkId, setLinkId] = useState(() => link?.id || generateRandomId());
  const [url, setUrl] = useState("");
  const [icon, setIcon] = useState<IconResult | null>(null);
  const [linkGroup, setLinkGroup] = useState(() => preselectOpenedGroup || link?.linkGroup || "");
  const [folder, setFolder] = useState(() => link?.folder || "");
  const [statusCheck, setStatusCheck] = useState(false);
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
  }, [link?.linkGroup, link?.folder]);

  // Prefill fields
  useEffect(() => {
    if (linkGroups.length === 0) return;
    if (link?.name && link?.url && link?.icon) {
      setName(link.name);
      setUrl(link.url);
      setIcon({ url: link.icon, iconSet: link.icon.includes("-light") ? "mono" : "custom" });
      setIconEdited(true);
    }
  }, [link, linkGroups]);

  // Auto-generate icon until manually edited
  useEffect(() => {
    if (!iconEdited && name.trim()) {
      const safeName = name.trim().replace(/\s+/g, "-").toLowerCase();
      setIcon({ url: `/icons/svg/${safeName}-light.svg`, iconSet: "custom" });
    }
  }, [name, iconEdited]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem("pb_token");
      if (!token) throw new Error("Not authenticated");

      const payload = { id: linkId, name, url, icon: icon?.url ?? "", linkGroup };
      if (folder) {
        (payload as any).folder = folder;
      }
      if (statusCheck) {
        (payload as any).statusCheck = true;
      }

      if (isEditing) {
        const updatedLinks = links.map((l: LinkObject) => l.url === link?.url ? payload : l);

        await writeToConfig("links", updatedLinks, { token });
      } else {
        const res = await fetch("/api/v1/config?path=links", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ newItem: payload }),
        });

        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to save link");
      }

      // Call onClose after successful save
      if (onClose) await onClose();
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(String(err));
      }
    }
    finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="grid grid-cols-[repeat(auto,3)] gap-2 justify-center"
    >
      <section>
        <Label htmlFor="link-title">Name</Label>
        <Input
          id="link-title"
          className="frosted"
          placeholder="Title"
          value={name ?? ""}
          onChange={(e) => setName(e.target.value)}
        />

        <Label htmlFor="link-url">URL</Label>
        <Input
          id="link-url"
          className="frosted"
          placeholder="https://example.com"
          value={url ?? ""}
          onChange={(e) => setUrl(e.target.value)}
        />

        <Label htmlFor="link-image">Icon</Label>
        <RadioGroup className="flex items-center gap-2" defaultValue="current">
          <LinkIcon name="current" iconObj={icon} />
          <Popover modal={true}>
            <PopoverTrigger>
              <Label
                className="h-[35px] w-[35px] frosted rounded-md flex items-center justify-center outline-2 outline-transparent cursor-pointer"
                title="Set icon by link"
              >
                <FontAwesomeIcon icon={faPaperclip} />
              </Label>
            </PopoverTrigger>

            <PopoverContent className="frosted p-3 text-(--text-primary) w-[300px]">
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
                className="h-[35px] w-[35px] frosted rounded-md flex items-center justify-center outline-2 outline-transparent has-checked:outline-(--primary)"
              >
                <FontAwesomeIcon icon={faEllipsisV} />
              </Label>
            </PopoverTrigger>
            <PopoverContent className="frosted text-(--text-primary)">
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
      </section>

      <Separator orientation="vertical" />

      <section className="flex flex-col gap-1.5">
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

      <div className="col-span-3 mt-2">
        {error && <p className="text-red-500">{error}</p>}
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

export function LinkIcon({
  name,
  iconObj,
}: {
  name: string;
  iconObj: IconResult | null;
}) {
  return (
    <Label
      key={name}
      className="h-[35px] w-[35px] frosted rounded-md flex items-center justify-center outline-2 outline-transparent has-checked:outline-(--primary)"
    >
      <RadioGroupItem value={name} className="hidden" />
      {iconObj && (
        iconObj.iconSet === "mono" ? (
          <div
            className="bg-white h-[22px] w-[22px]"
            style={{
              maskImage: `url(${iconObj.url})`,
              WebkitMaskImage: `url(${iconObj.url})`,
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
            src={iconObj.url ?? ""}
            alt={iconObj.name ?? ""}
            className="h-[22px] w-[22px] object-contain"
          />
        )
      )}
    </Label>
  );
}

function generateRandomId(length = 8) {
  return Math.random().toString(36).substr(2, length);
}
