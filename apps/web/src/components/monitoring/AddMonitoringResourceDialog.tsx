"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import useAuth from "@/context/useAuth";
import { createMonitorAction } from '@/lib/apiClient';
import { getLinksCollectionsAction, getLinksItemsAction } from '@/lib/apiClient';
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  buildEndpointAuthPayload,
  buildResponseUpFilter,
} from "./monitoringFormUtils";

type LinkCollection = {
  id: string;
  name: string;
};

type LinkItem = {
  id: string;
  title: string;
  url: string;
  collection: string;
};

type LinkOption = {
  id: string;
  collectionId: string;
  label: string;
  searchValue: string;
  url: string;
};

type MonitorRecord = {
  id: string;
  endpoint?: string;
  source?: string;
  sourcelinkId?: string;
  status?: string;
  created?: string;
  updated?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (monitor: MonitorRecord) => void;
};

function LinkCombobox({
  options,
  value,
  onChange,
  disabled,
}: {
  options: LinkOption[];
  value: string;
  onChange: (option: LinkOption | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => options.find((option) => option.id === value) ?? null, [options, value]);

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
            {selected ? selected.label : "Select a link"}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(44rem,calc(100vw-2rem))] p-0">
        <Command className="text-black">
          <CommandInput placeholder="Search links..." className="h-9" />
          <CommandList>
            <CommandEmpty>No links found.</CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option.id}
                value={option.searchValue}
                onSelect={() => {
                  onChange(option);
                  setOpen(false);
                }}
              >
                <span className="min-w-0 truncate">{option.label}</span>
                <Check className={cn("ml-auto", value === option.id ? "opacity-100" : "opacity-0")} />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function AddMonitoringResourceDialog({ open, onOpenChange, onCreated }: Props) {
  const { withAuth } = useAuth();
  const [collections, setCollections] = useState<LinkCollection[]>([]);
  const [items, setItems] = useState<LinkItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resourceType, setResourceType] = useState<"link" | "system">("link");
  const [selectedLinkId, setSelectedLinkId] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [method, setMethod] = useState("GET");
  const [expectedStatusCodes, setExpectedStatusCodes] = useState("200-299");
  const [expectedResponseBody, setExpectedResponseBody] = useState("");
  const [endpointAuthMode, setEndpointAuthMode] = useState("none");
  const [basicUsername, setBasicUsername] = useState("");
  const [basicPassword, setBasicPassword] = useState("");
  const [bearerToken, setBearerToken] = useState("");

  useEffect(() => {
    if (!open) {
      setCollections([]);
      setItems([]);
      setLoading(false);
      setSaving(false);
      setError(null);
      setResourceType("link");
      setSelectedLinkId("");
      setEndpoint("");
      setMethod("GET");
      setExpectedStatusCodes("200-299");
      setExpectedResponseBody("");
      setEndpointAuthMode("none");
      setBasicUsername("");
      setBasicPassword("");
      setBearerToken("");
      return;
    }

    let mounted = true;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const collectionsData = await withAuth((auth) => getLinksCollectionsAction(auth));

        if (!mounted) return;

        const collectionRecords = Array.isArray(collectionsData) ? collectionsData : [];
        const itemsByCollection = await Promise.all(
          collectionRecords.map(async (collection: any) => {
            const listItems = await withAuth((auth) => getLinksItemsAction(auth, collection.id));
            return {
              collectionId: collection.id,
              items: Array.isArray(listItems) ? listItems : [],
            };
          }),
        );

        if (!mounted) return;

        const flattenedItems = itemsByCollection.flatMap((entry: any) =>
          (Array.isArray(entry.items) ? entry.items : []).map((item: any) => ({
            id: item.id,
            title: item.title,
            url: item.url,
            collection: item.collection,
          })),
        );

        setCollections(
          collectionRecords.map((collection: any) => ({
            id: collection.id,
            name: collection.name,
          })),
        );
        setItems(flattenedItems);
      } catch (loadError) {
        if (!mounted) return;
        console.error("Failed to load monitor dialog data:", loadError);
        setCollections([]);
        setItems([]);
        setError(loadError instanceof Error ? loadError.message : "Failed to load links");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      mounted = false;
    };
  }, [open, withAuth]);

  const linkOptions = useMemo<LinkOption[]>(() => {
    const collectionById = new Map(collections.map((collection) => [collection.id, collection]));

    return [...items]
      .sort((left, right) => left.title.localeCompare(right.title))
      .map((item) => {
        const collection = collectionById.get(item.collection);
        const collectionName = collection?.name ?? "Links";

        return {
          id: item.id,
          collectionId: item.collection,
          label: `${collectionName} / ${item.title}`,
          searchValue: `${collectionName} ${item.title} ${item.url}`,
          url: item.url,
        };
      });
  }, [collections, items]);

  const selectedLink = useMemo(
    () => linkOptions.find((option) => option.id === selectedLinkId) ?? null,
    [linkOptions, selectedLinkId],
  );

  useEffect(() => {
    if (!open) return;
    if (selectedLink) {
      setEndpoint(selectedLink.url);
    }
  }, [open, selectedLink]);

  const saveMonitor = async () => {
    if (!selectedLink) {
      throw new Error("Select a link to monitor");
    }

    const endpointValue = endpoint.trim();
    if (!endpointValue) {
      throw new Error("Endpoint is required");
    }

    const endpointAuth = buildEndpointAuthPayload({
      mode: endpointAuthMode,
      basicUsername: basicUsername.trim(),
      basicPassword,
      bearerToken: bearerToken.trim(),
    });

    if (endpointAuthMode === "basic" && !basicUsername.trim()) {
      throw new Error("Basic auth username is required");
    }

    if (endpointAuthMode === "bearer" && !bearerToken.trim()) {
      throw new Error("Bearer token is required");
    }

    return withAuth((auth) =>
      createMonitorAction(auth, {
        resourceType,
        linkId: selectedLink.id,
        endpoint: endpointValue,
        method,
        endpointAuth,
        responseUpFilter: buildResponseUpFilter({
          acceptStatusCodes: expectedStatusCodes,
          acceptBodyProperties: expectedResponseBody,
        }),
      }),
    );
  };

  const canSave = Boolean(selectedLink && endpoint.trim()) && !saving;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="frosted text-foreground w-[min(56rem,calc(100vw-1rem))]">
        <DialogHeader>
          <DialogTitle>Add Monitor</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {error ? <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Resource Type</Label>
              <Select value={resourceType} onValueChange={(value) => setResourceType(value as "link" | "system")}> 
                <SelectTrigger className="border-white/10 bg-white/5 text-white">
                  <SelectValue placeholder="Select resource type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="link">Link</SelectItem>
                  <SelectItem value="system" disabled>
                    System
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>HTTP Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="border-white/10 bg-white/5 text-white">
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  {(["GET", "POST", "PUT", "DELETE", "PATCH"] as const).map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Link Selection</Label>
            <LinkCombobox
              options={linkOptions}
              value={selectedLinkId}
              onChange={(option) => {
                setSelectedLinkId(option?.id ?? "");
                if (option) {
                  setEndpoint(option.url);
                }
              }}
              disabled={loading || linkOptions.length === 0}
            />
            {loading ? <p className="text-xs text-white/50">Loading links...</p> : null}
          </div>

          <div className="space-y-2">
            <Label>URL</Label>
            <Input
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="https://example.com/health"
              className="border-white/10 bg-white/5 text-white"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Expected Status Codes</Label>
              <Input
                value={expectedStatusCodes}
                onChange={(event) => setExpectedStatusCodes(event.target.value)}
                placeholder="200-299"
                className="border-white/10 bg-white/5 text-white"
              />
            </div>

            <div className="space-y-2">
              <Label>Endpoint Auth</Label>
              <Select value={endpointAuthMode} onValueChange={setEndpointAuthMode}>
                <SelectTrigger className="border-white/10 bg-white/5 text-white">
                  <SelectValue placeholder="Select auth" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="basic">Basic</SelectItem>
                  <SelectItem value="bearer">Bearer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {endpointAuthMode === "basic" ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Basic Username</Label>
                <Input
                  value={basicUsername}
                  onChange={(event) => setBasicUsername(event.target.value)}
                  className="border-white/10 bg-white/5 text-white"
                />
              </div>
              <div className="space-y-2">
                <Label>Basic Password</Label>
                <Input
                  type="password"
                  value={basicPassword}
                  onChange={(event) => setBasicPassword(event.target.value)}
                  className="border-white/10 bg-white/5 text-white"
                />
              </div>
            </div>
          ) : null}

          {endpointAuthMode === "bearer" ? (
            <div className="space-y-2">
              <Label>Bearer Token</Label>
              <Input
                value={bearerToken}
                onChange={(event) => setBearerToken(event.target.value)}
                className="border-white/10 bg-white/5 text-white"
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label>Expected Response Body</Label>
            <Input
              value={expectedResponseBody}
              onChange={(event) => setExpectedResponseBody(event.target.value)}
              placeholder='{"status":"ok"}'
              className="border-white/10 bg-white/5 text-white"
            />
          </div>
        </div>

        <DialogFooter className="mt-2 gap-2 sm:justify-end">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              try {
                setSaving(true);
                setError(null);
                const monitor = await saveMonitor();
                onCreated?.(monitor as MonitorRecord);
                onOpenChange(false);
              } catch (saveError) {
                setError(saveError instanceof Error ? saveError.message : String(saveError));
              } finally {
                setSaving(false);
              }
            }}
            disabled={!canSave}
          >
            {saving ? "Saving..." : "Create Monitor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}