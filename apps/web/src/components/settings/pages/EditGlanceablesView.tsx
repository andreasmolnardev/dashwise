"use client";

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import ClockWidget from "@/components/widgets/ClockWidget";
import GlanceableComponent from "@dashwise/integrationskit/Glanceable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ClockGlanceableIntervals, ClockGlanceableSelection, DEFAULT_GLANCEABLE_CAROUSEL_INTERVAL, GlanceableSide } from "./utils";
import { useLocalization } from "@/context/LocalizationContext";
import useAuth from "@/context/useAuth";
import { getIntegrationWithGlanceableAction } from '@/lib/apiClient';

const PROGRESS_PERIOD_OPTIONS = [
  { value: "year", label: "Year" },
  { value: "month", label: "Month" },
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
];

type GlanceableCatalogItem = {
  type: string;
  name: string;
  appName?: string;
  integrationName?: string;
  integrationDisplayName?: string;
  exampleProps: Record<string, any>;
  properties?: Record<string, any>;
};

function getGlanceableGroupName(entry?: Partial<GlanceableCatalogItem> & Record<string, any>) {
  const rawLabel = entry?.integrationDisplayName ?? entry?.integrationName ?? entry?.appName ?? entry?.app;
  if (typeof rawLabel === "string" && rawLabel.trim()) {
    return rawLabel.trim();
  }

  return String(entry?.type === "weather" ? "Weather" : "Builtin");
}

type EditGlanceablesViewProps = {
  hasMainClock: boolean;
  glanceablesCatalog: GlanceableCatalogItem[];
  selectedClockPart: GlanceableSide | "clock";
  clockSelection: ClockGlanceableSelection;
  setClockSelection: Dispatch<SetStateAction<ClockGlanceableSelection>>;
  clockGlanceables: Record<string, any>;
  setClockGlanceables: Dispatch<SetStateAction<Record<string, any>>>;
  clockGlanceableIntervals: ClockGlanceableIntervals;
  setClockGlanceableIntervals: Dispatch<SetStateAction<ClockGlanceableIntervals>>;
  clockStyle: Record<string, any>;
  setClockStyle: Dispatch<SetStateAction<Record<string, any>>>;
  fonts: Array<{ name: string; path: string }>;
};

export function EditGlanceablesView({
  hasMainClock,
  glanceablesCatalog,
  selectedClockPart,
  clockSelection,
  setClockSelection,
  clockGlanceables,
  setClockGlanceables,
  clockGlanceableIntervals,
  setClockGlanceableIntervals,
  clockStyle,
  setClockStyle,
  fonts,
}: EditGlanceablesViewProps) {
  const localization = useLocalization();
  const { withAuth, user } = useAuth();
  const editorTitle =
    selectedClockPart === "clock"
      ? "Edit Glanceable Clock"
      : `Edit ${selectedClockPart === "left" ? "Left" : "Right"} Glanceable`;
  const selectedClockSide: GlanceableSide = selectedClockPart === "right"
    ? "right"
    : "left";
  const [selectedGlanceableId, setSelectedGlanceableId] = useState<string | null>(null);
  const glanceablesForSide = clockSelection[selectedClockSide];
  const selectedGlanceable = glanceablesForSide.find((item) => item.id === selectedGlanceableId) ?? glanceablesForSide[0];
  const selectedClockType = selectedGlanceable?.type ?? "";
  const selectedParams = selectedGlanceable ? clockGlanceables[selectedGlanceable.id] ?? {} : {};
  const [integrationInfo, setIntegrationInfo] = useState<{
    environmentDefinitions?: Record<string, { description?: string; required?: boolean; default?: string }>;
    glanceableJSON?: Record<string, any>;
    integration?: Record<string, any>;
  } | null>(null);
  const [selectedGlanceableApp, setSelectedGlanceableApp] = useState("Builtin");
  const selectedCatalogItem = glanceablesCatalog.find((entry) => entry.type === selectedClockType);
  const selectedProperties = selectedCatalogItem?.properties ?? {};
  const glanceableApps = Array.from(
    new Set(glanceablesCatalog.map((entry) => getGlanceableGroupName(entry))),
  );
  const visibleGlanceables = glanceablesCatalog.filter(
    (entry) => getGlanceableGroupName(entry) === selectedGlanceableApp,
  );

  useEffect(() => {
    if (!selectedClockType || ["date", "greeting", "local-timezone", "world-clock", "progress"].includes(selectedClockType)) {
      setIntegrationInfo(null);
      return;
    }

    void withAuth((auth) => getIntegrationWithGlanceableAction(auth, selectedClockType))
      .then((data: any) => {
        setIntegrationInfo(data ?? null);
      })
      .catch(() => setIntegrationInfo(null));
  }, [selectedClockType, withAuth]);

  useEffect(() => {
    setSelectedGlanceableId((currentId) =>
      glanceablesForSide.some((item) => item.id === currentId)
        ? currentId
        : glanceablesForSide[0]?.id ?? null,
    );
  }, [glanceablesForSide, selectedClockPart]);

  const selectedCatalogAppName = getGlanceableGroupName(selectedCatalogItem);

  useEffect(() => {
    if (selectedCatalogAppName) setSelectedGlanceableApp(selectedCatalogAppName);
  }, [selectedCatalogAppName]);

  const updateSelectedParams = (patch: Record<string, any>) => {
    if (!selectedGlanceable) return;
    setClockGlanceables((prev) => ({
      ...prev,
      [selectedGlanceable.id]: { ...(prev[selectedGlanceable.id] ?? {}), ...patch },
    }));
  };

  const addGlanceable = (side: GlanceableSide) => {
    const type = glanceablesCatalog[0]?.type;
    if (!type) return;
    const id = `${side}-${Date.now()}`;
    setClockSelection((prev) => ({
      ...prev,
      [side]: [...prev[side], { id, type }],
    }));
    setClockGlanceables((prev) => ({ ...prev, [id]: {} }));
    setSelectedGlanceableId(id);
  };

  const setSelectedType = (type: string) => {
    if (!selectedGlanceable) return;
    setClockSelection((prev) => ({
      ...prev,
      [selectedClockSide]: prev[selectedClockSide].map((item) => item.id === selectedGlanceable.id ? { ...item, type } : item),
    }));
  };

  const removeSelectedGlanceable = (id: string) => {
    setClockSelection((prev) => ({ ...prev, [selectedClockSide]: prev[selectedClockSide].filter((item) => item.id !== id) }));
    setClockGlanceables((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => key !== id)));
    setSelectedGlanceableId(null);
  };

  if (!hasMainClock) {
    return null;
  }

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden">
      <h2 className="text-lg font-semibold">{editorTitle}</h2>

      <div className="p-4">
        <div className="flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-4">
          {selectedClockPart === "clock" ? (
            <ClockWidget
              className="p-0! text-4xl!"
              font={clockStyle.defaultFont}
              weight={clockStyle.fontWeight}
              color={clockStyle.color}
            />
          ) : selectedClockType ? (
            <div className="flex min-h-10 items-center justify-center rounded-full px-2 py-0.5 frosted">
                <GlanceableComponent
                  type={selectedClockType}
                  glanceableJSON={integrationInfo?.glanceableJSON}
                  integrationJSON={integrationInfo?.integration}
                  params={{
                    ...selectedProperties,
                    ...selectedParams,
                    ...(selectedClockType === "greeting"
                    ? {
                      username: selectedParams.username ??
                        user?.username,
                    }
                    : {}),
                  }}
                formatters={{
                  formatTemperature: localization.formatTemperature,
                  formatTime: localization.formatTime,
                  formatDate: localization.formatDate,
                }}
              />
            </div>
          ) : (
            <p className="text-sm text-white/60">No glanceable selected</p>
          )}
        </div>
      </div>

      {selectedClockPart !== "clock" ? (
        <>
          <div className="min-w-0 space-y-4 overflow-x-hidden">
            <div className="flex max-w-full min-w-0 items-center gap-2 overflow-x-auto pb-1">
              {glanceablesForSide.map((item) => (
                <button key={item.id} type="button" onClick={() => setSelectedGlanceableId(item.id)} className={`group flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${selectedGlanceable?.id === item.id ? "border-primary bg-white/15" : "border-white/20 bg-white/5"}`}>
                  <span>{glanceablesCatalog.find((entry) => entry.type === item.type)?.name ?? item.type}</span>
                  <X className="h-3 w-3 opacity-60 group-hover:opacity-100" onClick={(event) => { event.stopPropagation(); removeSelectedGlanceable(item.id); }} />
                </button>
              ))}
              <button type="button" onClick={() => addGlanceable(selectedClockSide)} aria-label="Add glanceable" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-white/30 text-white/70 hover:bg-white/10"><Plus className="h-4 w-4" /></button>
            </div>

            {selectedGlanceable ? <>
              {glanceablesForSide.length > 1 && (
                <div className="grid gap-3 sm:grid-cols-[120px_1fr] sm:items-center">
                  <label htmlFor={`glanceable-interval-${selectedClockSide}`} className="text-sm text-white/75">Change interval</label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`glanceable-interval-${selectedClockSide}`}
                      type="number"
                      min="1"
                      step="1"
                      value={clockGlanceableIntervals[selectedClockSide] ?? DEFAULT_GLANCEABLE_CAROUSEL_INTERVAL}
                      onChange={(event) => {
                        const interval = Number(event.target.value);
                        if (!Number.isFinite(interval) || interval < 1) return;
                        setClockGlanceableIntervals((prev) => ({ ...prev, [selectedClockSide]: interval }));
                      }}
                      className="h-9 w-24 rounded-full border-white/20 bg-transparent px-3 text-sm"
                    />
                    <span className="text-sm text-white/55">seconds</span>
                  </div>
                </div>
              )}
              <div className="min-w-0 space-y-3 overflow-hidden">
                <h3 className="font-medium">Select Glanceable</h3>
                <div className="flex max-w-full min-w-0 items-center gap-2 overflow-x-auto pb-1">
                  {glanceableApps.map((appName) => (
                    <button
                      key={appName}
                      type="button"
                      onClick={() => setSelectedGlanceableApp(appName)}
                      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs capitalize transition ${
                        selectedGlanceableApp === appName
                          ? "bg-white text-black"
                          : "border border-white/25 text-white/80 hover:bg-white/10"
                      }`}
                    >
                      {appName}
                    </button>
                  ))}
                </div>
                <div className="flex max-w-full min-w-0 snap-x gap-2 overflow-x-auto pb-2">
                  {visibleGlanceables.map((glanceable) => (
                    <button
                      key={glanceable.type}
                      type="button"
                      onClick={() => setSelectedType(glanceable.type)}
                      className={`w-36 shrink-0 snap-start rounded-lg border p-2 text-left transition sm:w-40 ${
                        selectedClockType === glanceable.type
                          ? "border-primary bg-white/15"
                          : "border-white/10 bg-white/5 hover:bg-white/10"
                      }`}
                    >
                      <div className="mb-2 flex min-h-8 items-center justify-center overflow-hidden rounded-md bg-black/10 px-1.5">
                        <GlanceableComponent
                          type={glanceable.type}
                          params={glanceable.exampleProps ?? {}}
                          formatters={{
                            formatTemperature: localization.formatTemperature,
                            formatTime: localization.formatTime,
                            formatDate: localization.formatDate,
                          }}
                          className="truncate rounded-full px-1.5 py-0.5 text-xs"
                        />
                      </div>
                      <p className="truncate text-[11px] font-medium text-white/90">{glanceable.name}</p>
                      <p className="truncate text-[10px] text-white/45">{getGlanceableGroupName(glanceable)}</p>
                    </button>
                  ))}
                </div>
              </div>
              <Separator />
              <div className="space-y-4">
              <h3 className="text-sm font-medium">{selectedCatalogItem?.name ?? "Glanceable"} Properties</h3>

              {selectedClockType === "date" && (
                <div className="space-y-2">
                  <p className="text-xs text-white/70">Date format</p>
                  <Input
                    value={String(selectedParams.format ?? selectedProperties.format ?? "mmm/DD")}
                    onChange={(e) => updateSelectedParams({ format: e.target.value })}
                    placeholder="e.g. YYYY-MM-DD"
                    className="h-9 min-w-32 rounded-full border-white/20 px-3 bg-transparent text-sm"
                  />
                  <div className="text-xs text-white/50 mt-1">
                    Use date format strings (e.g. <code>YYYY-MM-DD</code>, <code>mmmm</code>, <code>mmm</code>)
                  </div>
                </div>
              )}

              {selectedClockType === "progress" && (
                <div className="space-y-2">
                  <p className="text-xs text-white/70">Period</p>
                  <Select
                    value={String(selectedParams.period ?? selectedProperties.period ?? "day")}
                    onValueChange={(value) => updateSelectedParams({ period: value })}
                  >
                    <SelectTrigger className="h-9 min-w-32 rounded-full border-white/20">
                      <SelectValue placeholder="Day" />
                    </SelectTrigger>
                    <SelectContent>
                      {PROGRESS_PERIOD_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {selectedClockType === "weather" && (
                <div className="space-y-2">
                  <p className="text-xs text-white/70">Source</p>
                  <Select
                    value={String(selectedParams.source ?? selectedProperties.source ?? "auto")}
                    onValueChange={(value) => updateSelectedParams({ source: value })}
                  >
                    <SelectTrigger className="h-9 min-w-32 rounded-full border-white/20">
                      <SelectValue placeholder="Auto" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto (Location)</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {selectedClockType === "greeting" && (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-white/75">
                    <Checkbox
                      checked={Boolean(selectedParams.showUsername ?? selectedProperties.showUsername)}
                      onCheckedChange={(checked) => updateSelectedParams({ showUsername: Boolean(checked) })}
                    />
                    Show username
                  </label>
                </div>
              )}

              {integrationInfo?.environmentDefinitions &&
                Object.entries(integrationInfo.environmentDefinitions).map(([key, def]) => (
                  <div key={key} className="space-y-2">
                    <p className="text-xs text-white/70">
                      {key} {def.required ? <span className="text-destructive">*</span> : ""}
                    </p>
                    <Input
                      value={String(selectedParams[key] ?? def.default ?? selectedProperties[key] ?? "")}
                      onChange={(e) => updateSelectedParams({ [key]: e.target.value })}
                      placeholder={def.description ?? `Override ${key}`}
                      className="h-9 min-w-32 rounded-full border-white/20 px-3 bg-transparent text-sm"
                    />
                    {def.description && (
                      <p className="text-[10px] text-white/40">{def.description}</p>
                    )}
                  </div>
                ))}

              {!["date", "weather"].includes(selectedClockType) && !integrationInfo?.environmentDefinitions && (
                <p className="text-xs italic text-white/50">
                  No configurable properties for this glanceable.
                </p>
              )}
              </div>
            </> : <p className="text-sm text-white/60">Add a glanceable to configure this slot.</p>}
          </div>
        </>
      ) : (
        <div className="space-y-3 rounded-xl border p-4">
          <div className="grid gap-3 md:grid-cols-[120px_1fr] md:items-center">
            <p className="text-sm text-white/75">Font</p>
            <Select
              value={String(clockStyle.defaultFont ?? "Default")}
              onValueChange={(value) =>
                setClockStyle((prev) => ({
                  ...prev,
                  defaultFont: value,
                }))}
            >
              <SelectTrigger className="h-9 rounded-full border-white/20">
                <SelectValue placeholder="Default" />
              </SelectTrigger>
              <SelectContent>
                {fonts.map((font) => (
                  <SelectItem key={font.name} value={font.name}>
                    {font.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 md:grid-cols-[120px_1fr] md:items-center">
            <p className="text-sm text-white/75">Font Weight</p>
            <Select
              value={String(clockStyle.fontWeight ?? 400)}
              onValueChange={(value) =>
                setClockStyle((prev) => ({
                  ...prev,
                  fontWeight: Number(value),
                }))}
            >
              <SelectTrigger className="h-9 rounded-full border-white/20">
                <SelectValue placeholder="Regular" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="100">Thin</SelectItem>
                <SelectItem value="200">Extra Light</SelectItem>
                <SelectItem value="300">Light</SelectItem>
                <SelectItem value="400">Regular</SelectItem>
                <SelectItem value="500">Medium</SelectItem>
                <SelectItem value="600">Semi Bold</SelectItem>
                <SelectItem value="700">Bold</SelectItem>
                <SelectItem value="800">Extra Bold</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 md:grid-cols-[120px_1fr] md:items-center">
            <p className="text-sm text-white/75">Digit Color</p>
            <div className="flex items-center gap-2">
              {["#d4d4d8", "#a3a3a3", "#737373", "#ffffff"].map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setClockStyle((prev) => ({ ...prev, color }))}
                  className={`h-6 w-6 rounded-full border ${
                    clockStyle.color === color ? "border-white" : "border-transparent"
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[120px_1fr] md:items-center">
            <p className="text-sm text-white/75">Digit Outline</p>
            <div className="flex items-center gap-2">
              <Select
                value={clockStyle.outlineEnabled ? `${clockStyle.outlineWidth ?? 2}px Solid` : "None"}
                onValueChange={(value) => {
                  if (value === "None") {
                    setClockStyle((prev) => ({
                      ...prev,
                      outlineEnabled: false,
                    }));
                    return;
                  }

                  const parsed = Number(value.replace("px Solid", ""));
                  setClockStyle((prev) => ({
                    ...prev,
                    outlineEnabled: true,
                    outlineWidth: Number.isFinite(parsed) ? parsed : 2,
                  }));
                }}
              >
                <SelectTrigger className="h-9 rounded-full border-white/20">
                  <SelectValue placeholder="2px Solid" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="None">None</SelectItem>
                  <SelectItem value="1px Solid">1px Solid</SelectItem>
                  <SelectItem value="2px Solid">2px Solid</SelectItem>
                  <SelectItem value="3px Solid">3px Solid</SelectItem>
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={() =>
                  setClockStyle((prev) => ({
                    ...prev,
                    outlineColor: prev.outlineColor === "#3b3232"
                      ? "#ffffff"
                      : "#3b3232",
                  }))}
                className="h-5 w-5 rounded-full border border-white/30"
                style={{
                  backgroundColor: clockStyle.outlineColor ?? "#3b3232",
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
