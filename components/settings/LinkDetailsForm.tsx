"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@radix-ui/react-label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
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
import IconPickerComponent from "@/components/settings/IconPicker";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
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

export interface LinkObject {
  icon?: string;
  linkGroup?: string;
  name?: string;
  url?: string;
}

interface LinkDetailsFormProps {
  link?: LinkObject;
  onClose?: () => void | Promise<void>;
}

export default function LinkDetailsForm({ link, onClose }: LinkDetailsFormProps) {
  const { config, refreshConfig } = useConfig();

  const linkGroups = useMemo(() => config?.linkGroups || [], [config?.linkGroups]);
  const links = config?.links || [];

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [icon, setIcon] = useState("");
  const [linkGroup, setLinkGroup] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [iconEdited, setIconEdited] = useState(false);
  const [icons, setIcons] = useState<Icon[]>([]);
  const [open, setOpen] = useState(false);

  const isEditing = Boolean(link?.url && link?.name && link?.icon);

  useEffect(() => {
    fetch("/icons/index.json")
      .then((res) => res.json())
      .then((data) => setIcons(data))
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (link?.linkGroup) {
      setLinkGroup(link.linkGroup);
    }
  }, [link?.linkGroup]);

  useEffect(() => {
    if (linkGroups.length === 0) return;
    if (link?.name && link?.url && link?.icon) {
      setName(link.name);
      setUrl(link.url);
      setIcon(link.icon);
      setIconEdited(true);
    }
  }, [link, linkGroups]);

  useEffect(() => {
    if (!iconEdited && name.trim()) {
      const safeName = name.trim().replace(/\s+/g, "-").toLowerCase();
      setIcon(`/icons/svg/${safeName}-light.svg`);
    }
  }, [name, iconEdited]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem("pb_token");
      if (!token) throw new Error("Not authenticated");

      const payload = { name, url, icon, linkGroup };
      let res: Response;

      if (isEditing) {
        const updatedLinks = links.map((l: LinkObject) =>
          l.url === link?.url ? payload : l
        );

        res = await fetch("/api/v1/config?path=links", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ updatedItem: updatedLinks }),
        });
      } else {
        res = await fetch("/api/v1/config?path=links", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ newItem: payload }),
        });
      }

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save link");

      await refreshConfig();

      if (!isEditing) {
        setName("");
        setUrl("");
        setIcon("");
        setLinkGroup("");
        setIconEdited(false);
      }

      if (onClose) await onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
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
          <LinkIcon name="current" iconUrl={icon} />

          <Popover modal={true}>
            <PopoverTrigger>
              <Label
                className="h-[35px] w-[35px] frosted rounded-md flex items-center justify-center cursor-pointer"
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
                  defaultValue={icon}
                  onChange={(e) => {
                    const value = e.target.value;
                    setIcon(value);
                    setIconEdited(true);
                    const hidden = document.querySelector<HTMLInputElement>('input[name="icon"]');
                    if (hidden) hidden.value = value;
                  }}
                />
              </div>
            </PopoverContent>
          </Popover>

          <Popover modal={true} open={open} onOpenChange={setOpen}>
            <PopoverTrigger>
              <Label
                key={name}
                className="h-[35px] w-[35px] frosted rounded-md flex items-center justify-center"
              >
                <FontAwesomeIcon icon={faEllipsisV} />
              </Label>
            </PopoverTrigger>
            <PopoverContent className="frosted text-(--text-primary)">
              <IconPickerComponent
                initialIcons={icons}
                onSelect={(iconObj) => {
                  const ext = iconObj.SVG === "Yes" ? "svg" : "png";
                  let variant = "";
                  if (iconObj.Light === "Yes") variant = "light";
                  else if (iconObj.Dark === "Yes") variant = "dark";
                  const url = `/icons/${ext}/${iconObj.Reference}${variant ? `-${variant}` : ""}.${ext}`;
                  setIcon(url);
                  setIconEdited(true);
                  setOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>

          <input type="hidden" name="icon" value={icon ?? ""} />
        </RadioGroup>
      </section>

      <Separator orientation="vertical" />

      <section>
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

        <div className="mt-4">
          <p className="text-xs text-gray-400 mb-1">
            Preview {isEditing && "(Editing)"}
          </p>

          <div className="group flex flex-col items-center justify-between space-y-2 frosted rounded-2xl p-2 min-h-18 w-[120px]">
            {icon && icon.includes("-light") ? (
              <div
                className="h-[35px] w-[35px] bg-white group-hover:bg-(--primary) transition"
                style={{
                  maskImage: `url(${icon})`,
                  WebkitMaskImage: `url(${icon})`,
                  maskRepeat: "no-repeat",
                  WebkitMaskRepeat: "no-repeat",
                  maskPosition: "center",
                  WebkitMaskPosition: "center",
                  maskSize: "contain",
                  WebkitMaskSize: "contain",
                }}
              />
            ) : (
              icon && (
                <img
                  src={icon}
                  alt="preview"
                  className="h-[35px] w-[35px] object-contain transition"
                />
              )
            )}

            <span className="text-sm text-white">
              {name || "Link name"}
            </span>
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
  iconUrl,
}: {
  name: string;
  iconUrl: string | null;
}) {
  const isLightVariant = iconUrl?.includes("-light");

  return (
    <Label
      key={name}
      className="h-[35px] w-[35px] frosted rounded-md flex items-center justify-center"
    >
      <RadioGroupItem value={name} className="hidden" />

      {iconUrl &&
        (isLightVariant ? (
          <div
            className="bg-white h-[22px] w-[22px]"
            style={{
              maskImage: `url(${iconUrl})`,
              WebkitMaskImage: `url(${iconUrl})`,
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
            src={iconUrl}
            alt="icon"
            className="h-[22px] w-[22px] object-contain"
          />
        ))}
    </Label>
  );
}
