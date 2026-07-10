"use client";

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
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
import { GlanceableSide } from "./utils";
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
  exampleProps: Record<string, any>;
};

type EditGlanceablesViewProps = {
  hasMainClock: boolean;
  glanceablesCatalog: GlanceableCatalogItem[];
  selectedClockPart: GlanceableSide | "clock";
  clockSelection: Record<GlanceableSide, string>;
  setClockSelection: Dispatch<SetStateAction<Record<GlanceableSide, string>>>;
  clockGlanceables: Record<string, any>;
  setClockGlanceables: Dispatch<SetStateAction<Record<string, any>>>;
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
  const selectedClockType = clockSelection[selectedClockSide];
  const selectedClockLabel = selectedClockPart === "clock"
    ? "Clock"
    : selectedClockPart === "left"
      ? "Left Glanceable"
      : "Right Glanceable";

  const [integrationInfo, setIntegrationInfo] = useState<{
    environmentDefinitions?: Record<string, { description?: string; required?: boolean; default?: string }>;
  } | null>(null);

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

  const setGlanceableForSide = (side: GlanceableSide, type: string) => {
    setClockSelection((prev) => ({
      ...prev,
      [side]: type,
    }));
    setClockGlanceables((prev) => {
      const leftType = side === "left" ? type : clockSelection.left;
      const rightType = side === "right" ? type : clockSelection.right;
      return {
        ...prev,
        [leftType]: prev[leftType] ?? {},
        [rightType]: prev[rightType] ?? {},
      };
    });
  };

  if (!hasMainClock) {
    return null;
  }

  return (
    <div className="space-y-4">
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
                  params={selectedClockType === "greeting"
                    ? {
                      ...(clockGlanceables[selectedClockType] ?? {}),
                      username: clockGlanceables[selectedClockType]?.username ??
                        user?.username,
                    }
                    : clockGlanceables[selectedClockType] ?? {}}
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
          <p className={`text-xs ${selectedClockPart ? "font-semibold" : "text-white/70"}`}>
            {selectedClockLabel}
          </p>
        </div>
      </div>

      {selectedClockPart !== "clock" ? (
        <>
          <h3 className="font-medium">Edit {selectedClockPart} Glanceable</h3>
          <div className="grid gap-4 lg:grid-cols-[2fr_auto_1fr] lg:items-start">
          <div className="flex max-w-full snap-x gap-3 overflow-x-auto pb-2">
              {glanceablesCatalog.map((glanceable) => (
                <button
                  key={glanceable.type}
                  type="button"
                  onClick={() => setGlanceableForSide(selectedClockSide, glanceable.type)}
                  className={`w-56 shrink-0 snap-start rounded-xl border p-3 text-left transition ${selectedClockType === glanceable.type ? "border-primary bg-white/10" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
                >
                  <div className="mb-3 overflow-hidden rounded-lg">
                    <GlanceableComponent
                      type={glanceable.type}
                      params={glanceable.exampleProps ?? {}}
                      formatters={{
                        formatTemperature: localization.formatTemperature,
                        formatTime: localization.formatTime,
                        formatDate: localization.formatDate,
                      }}
                      className="h-10 rounded-full px-2 py-0.5"
                    />
                  </div>
                  <p className="truncate text-xs text-white/75">
                    {glanceable.name}
                  </p>
                </button>
              ))}
            </div>
            <Separator orientation="vertical" />
            <div className="space-y-4">
              <h3 className="text-sm font-medium">Properties: {selectedClockType}</h3>

              {selectedClockType === "date" && (
                <div className="space-y-2">
                  <p className="text-xs text-white/70">Date format</p>
                  <Input
                    value={String(clockGlanceables[selectedClockType]?.format ?? "mmm/DD")}
                    onChange={(e) => {
                      setClockGlanceables((prev) => ({
                        ...prev,
                        [selectedClockType]: {
                          ...(prev[selectedClockType] ?? {}),
                          format: e.target.value,
                        },
                      }));
                    }}
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
                    value={String(clockGlanceables[selectedClockType]?.period ?? "day")}
                    onValueChange={(value) => {
                      setClockGlanceables((prev) => ({
                        ...prev,
                        [selectedClockType]: {
                          ...(prev[selectedClockType] ?? {}),
                          period: value,
                        },
                      }));
                    }}
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
                    value={String(clockGlanceables[selectedClockType]?.source ?? "auto")}
                    onValueChange={(value) => {
                      setClockGlanceables((prev) => ({
                        ...prev,
                        [selectedClockType]: {
                          ...(prev[selectedClockType] ?? {}),
                          source: value,
                        },
                      }));
                    }}
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
                      checked={Boolean(
                        clockGlanceables[selectedClockType]?.showUsername,
                      )}
                      onCheckedChange={(checked) => {
                        setClockGlanceables((prev) => ({
                          ...prev,
                          [selectedClockType]: {
                            ...(prev[selectedClockType] ?? {}),
                            showUsername: Boolean(checked),
                          },
                        }));
                      }}
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
                      value={String(clockGlanceables[selectedClockType]?.[key] ?? "")}
                      onChange={(e) => {
                        setClockGlanceables((prev) => ({
                          ...prev,
                          [selectedClockType]: {
                            ...(prev[selectedClockType] ?? {}),
                            [key]: e.target.value,
                          },
                        }));
                      }}
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
