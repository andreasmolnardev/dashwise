"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PopoverClose } from "@radix-ui/react-popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import useAuth from "@/context/useAuth";
import {
  getUserGlanceablesAction,
  getUserWidgetsAction,
  uploadWallpaperAction,
} from "@/lib/apiClient";
import { normalizeWallpaperFilters } from "./wallpaperFilterDefaults";
import { renderWidget } from "../widgets/Widget";
import WidgetPropertiesForm, { type GlanceableOption } from "@dashwise/integrationskit/forms/WidgetPropertiesForm";
import LocationSelectFormComponent from "./LocationSelectForm";
import { EditGlanceablesView } from "./pages/EditGlanceablesView";

const LOCAL_WIDGET_OPTIONS = [
  { value: "glanceable-clock", label: "Glanceable Clock" },
  { value: "calendar-today", label: "Calendar Overview: Today" },
  { value: "calendar-week", label: "Calendar Overview: Week" },
  { value: "calendar-upcoming", label: "Calendar Overview: Upcoming" },
  { value: "progress", label: "Calendar progress" },
  "countdown",
  "rss-feed",
  "latest-links",
  "monitoring",
] as const;

const FRAME_LAYOUTS = [
  { value: "1x1", label: "1x1", cols: 1, rows: 1 },
  { value: "2x1", label: "2x1", cols: 2, rows: 1 },
  { value: "2x2", label: "2x2", cols: 2, rows: 2 },
  { value: "custom", label: "Custom", cols: 2, rows: 2 },
] as const;

const FRAME_PREVIEW_SIZE = {
  width: 240,
  height: 160,
};

const EXCLUDED_FRAME_WIDGETS = new Set([
  "search-bar",
  "link-view",
  "placeholder",
]);

const LOCAL_WIDGET_SCHEMAS: Record<string, Record<string, any>> = {
  "calendar-today": { startMonday: true },
  "calendar-week": { startMonday: true },
  "calendar-upcoming": { maxEvents: 5 },
  countdown: { date: "", date_format: "yyyy-MM-dd", label: "Countdown" },
  "rss-feed": { feedId: "all", maxItems: 8, title: "Latest Articles" },
  "latest-links": { listId: "", maxItems: 8, title: "Latest Links" },
  progress: {
    period: {
      type: "select",
      default: "day",
      options: [
        { value: "year", label: "Year" },
        { value: "month", label: "Month" },
        { value: "day", label: "Day" },
        { value: "week", label: "Week" },
      ],
    },
  },
};

type FrameSection = {
  id: string;
  label: string;
  widgetType: string;
  params?: Record<string, any>;
  consumerKey?: string;
};

type Frame = {
  id: string;
  type: string;
  params?: Record<string, any>;
};

type FrameGlanceable = {
  type: string;
  params: Record<string, any>;
};

type BackgroundMode = "current" | "none" | "upload" | "url";
type RulesScope = "global" | "device";

function readDeviceRules() {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem("dashwise_screensaver_device_rules");
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function getGlobalRules(config?: Record<string, any>) {
  return {
    ...(config?.showButton === undefined ? {} : { showButton: config.showButton }),
    ...(config?.inactivityTimeout === undefined
      ? {}
      : { inactivityTimeout: config.inactivityTimeout }),
    ...(config?.displayRules && typeof config.displayRules === "object"
      ? config.displayRules
      : {}),
  };
}

function getDeviceRules() {
  const config = readDeviceRules();
  return {
    ...(config.showButton === undefined ? {} : { showButton: config.showButton }),
    ...(config.inactivityTimeout === undefined
      ? {}
      : { inactivityTimeout: config.inactivityTimeout }),
    ...(config.displayRules && typeof config.displayRules === "object"
      ? config.displayRules
      : {}),
  };
}

function clampLayoutSize(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(4, Math.round(value)));
}

function getSectionLabel(col: number, row: number, cols: number, rows: number) {
  const vertical = rows === 1
    ? ""
    : row === 0
    ? "top"
    : row === rows - 1
    ? "bottom"
    : "middle";
  const horizontal = cols === 1
    ? ""
    : col === 0
    ? "left"
    : col === cols - 1
    ? "right"
    : "middle";
  if (vertical === "middle" && horizontal === "middle") return "middle";
  return [vertical, horizontal].filter(Boolean).join(" ") || "cell";
}

function buildSections(
  cols: number,
  rows: number,
  current: FrameSection[] = [],
) {
  const currentById = new Map(current.map((section) => [section.id, section]));
  return Array.from({ length: rows }).flatMap((_, row) =>
    Array.from({ length: cols }).map((_, col) => {
      const id = `cell-${row}-${col}`;
      return {
        id,
        label: getSectionLabel(col, row, cols, rows),
        widgetType: currentById.get(id)?.widgetType ?? "glanceable-clock",
        params: currentById.get(id)?.params ?? {},
        consumerKey: currentById.get(id)?.consumerKey,
      };
    })
  );
}

function getFrameName(frame: Frame, index: number) {
  return String(
    frame.params?.name || frame.params?.title || `Page ${index + 1}`,
  );
}

function getFrameLayout(frame: Frame) {
  const layout = frame.params?.layout && typeof frame.params.layout === "object"
    ? frame.params.layout
    : {};
  return {
    cols: clampLayoutSize(Number(layout.cols ?? 1)),
    rows: clampLayoutSize(Number(layout.rows ?? 1)),
  };
}

function stripPrivateSectionParams(params?: Record<string, any>) {
  if (!params) return {};
  const nextParams = { ...params };
  delete nextParams.__pageName;
  return nextParams;
}

function getFrameGlanceables(value: unknown): FrameGlanceable[] {
  const record = value && typeof value === "object"
    ? value as Record<string, any>
    : {};
  const rawItems = Array.isArray(value)
    ? value
    : Array.isArray(record.slots?.list)
    ? record.slots.list
    : [];

  return rawItems.flatMap((item) => {
    if (typeof item === "string" && item.trim()) {
      return [{ type: item.trim(), params: {} }];
    }

    if (!item || typeof item !== "object" || typeof item.type !== "string" || !item.type.trim()) {
      return [];
    }

    return [{
      type: item.type.trim(),
      params: item.params && typeof item.params === "object" && !Array.isArray(item.params)
        ? item.params
        : {},
    }];
  });
}

function FrameGlanceableModal({
  glanceable,
  glanceableOptions,
  onChange,
  onRemove,
}: {
  glanceable: FrameGlanceable;
  glanceableOptions: GlanceableOption[];
  onChange: (next: FrameGlanceable) => void;
  onRemove: () => void;
}) {
  const itemId = "frame-glanceable";
  const [clockSelection, setClockSelection] = useState({
    left: [{ id: itemId, type: glanceable.type }],
    right: [],
  });
  const [clockGlanceables, setClockGlanceables] = useState({
    [itemId]: glanceable.params,
  });
  const [clockGlanceableIntervals, setClockGlanceableIntervals] = useState({
    left: 5,
    right: 5,
  });
  const [clockStyle, setClockStyle] = useState<Record<string, any>>({});
  const onChangeRef = useRef(onChange);
  const onRemoveRef = useRef(onRemove);
  const initializedRef = useRef(false);

  onChangeRef.current = onChange;
  onRemoveRef.current = onRemove;

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }

    const selected = clockSelection.left[0];
    if (!selected) {
      onRemoveRef.current();
      return;
    }

    onChangeRef.current({
      type: selected.type,
      params: clockGlanceables[selected.id] ?? {},
    });
  }, [clockGlanceables, clockSelection]);

  return (
    <EditGlanceablesView
      hasMainClock
      glanceablesCatalog={glanceableOptions.map((option) => ({
        type: option.value,
        name: option.label,
        exampleProps: option.exampleProps ?? {},
        properties: option.properties,
      }))}
      selectedClockPart="left"
      clockSelection={clockSelection}
      setClockSelection={setClockSelection}
      clockGlanceables={clockGlanceables}
      setClockGlanceables={setClockGlanceables}
      clockGlanceableIntervals={clockGlanceableIntervals}
      setClockGlanceableIntervals={setClockGlanceableIntervals}
      clockStyle={clockStyle}
      setClockStyle={setClockStyle}
      fonts={[]}
      titleOverride="Edit Glanceable"
      hideAddGlanceable
    />
  );
}

function LayoutPreview({
  cols,
  rows,
  className = "",
}: {
  cols: number;
  rows: number;
  className?: string;
}) {
  return (
    <div
      className={`grid gap-0.5 ${className}`}
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
    >
      {Array.from({ length: cols * rows }).map((_, index) => (
        <div
          key={index}
          className="min-h-0 rounded-[2px] border border-white/15 bg-white/30"
        />
      ))}
    </div>
  );
}

function normalizeWidgetChoice(type?: string) {
  return [
      "progress",
      "day-progress",
      "week-progress",
      "month-progress",
      "year-progress",
    ].includes(type ?? "")
    ? "progress"
    : type ?? "";
}

function FrameLayoutPreview({
  frame,
  resolveWidgetLabel,
  onSelectSection,
}: {
  frame: Frame;
  resolveWidgetLabel: (type?: string) => string;
  onSelectSection?: (sectionId: string) => void;
}) {
  const layout = getFrameLayout(frame);
  const sections = Array.isArray(frame.params?.sections)
    ? frame.params.sections
    : [];
  return (
    <div
      className="grid h-full w-full min-h-0 min-w-0 gap-2 overflow-hidden"
      style={{
        gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
      }}
    >
      {buildSections(layout.cols, layout.rows, sections).map((section) => (
        <button
          key={section.id}
          type="button"
          onClick={() => onSelectSection?.(section.id)}
          className="frosted min-h-0 min-w-0 overflow-hidden rounded-xl border border-white/10 bg-white/5 p-2 text-center text-xs text-white/75 shadow-sm backdrop-blur-xl transition hover:bg-white/10"
        >
          <span className="flex h-full min-h-0 flex-col items-center justify-center gap-1 text-center leading-tight">
            <span className="whitespace-normal break-words font-medium">
              {resolveWidgetLabel(section.widgetType || frame.type)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function FrameWidgetSlotEditor({
  section,
  isSelected,
  isCarouselOpen,
  widgetCategories,
  selectedWidgetCategory,
  selectedWidgetOptions,
  widgetSchemas,
  glanceableOptions,
  widgetParamsError,
  resolveWidgetLabel,
  onSelect,
  onToggleCarousel,
  onCategoryChange,
  onUpdate,
  onError,
  onEditGlanceable,
}: {
  section: FrameSection;
  isSelected: boolean;
  isCarouselOpen: boolean;
  widgetCategories: string[];
  selectedWidgetCategory: string;
  selectedWidgetOptions: Array<{ value: string; label: string }>;
  widgetSchemas: Record<string, Record<string, any>>;
  glanceableOptions: GlanceableOption[];
  widgetParamsError: string | null;
  resolveWidgetLabel: (type?: string) => string;
  onSelect: () => void;
  onToggleCarousel: () => void;
  onCategoryChange: (category: string) => void;
  onUpdate: (patch: Partial<FrameSection>) => void;
  onError: (message: string | null) => void;
  onEditGlanceable?: (index: number) => void;
}) {
  const updateParams = (params: Record<string, any>) => onUpdate({ params });
  const isGlanceableClock = section.widgetType === "glanceable-clock" || section.widgetType === "main-clock";
  const widgetSchema = isGlanceableClock
    ? { glanceables: { type: "glanceables" } }
    : widgetSchemas[section.widgetType] ?? {};
  const hasWidgetProperties = Object.keys(widgetSchema).length > 0;
  const updateAppearance = (patch: Record<string, any>) =>
    updateParams({
      ...(section.params ?? {}),
      appearance: { ...(section.params?.appearance ?? {}), ...patch },
    });

  return (
    <div
      className={`frosted space-y-3 rounded-2xl border p-4 transition ${
        isSelected ? "border-primary/70 bg-primary/10" : "border-white/10 bg-white/5"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold capitalize">{section.label} Widget</h2>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleCarousel();
          }}
          aria-expanded={isCarouselOpen}
          className="frosted flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/90 transition hover:bg-white/10"
        >
          <span className="max-w-[18rem] truncate">{resolveWidgetLabel(section.widgetType)}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isCarouselOpen ? "rotate-180" : ""}`} />
        </button>
      </div>

      {isCarouselOpen && (
        <div className="space-y-4 border-t border-white/10 pt-3" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {widgetCategories.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => onCategoryChange(category)}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs capitalize transition ${
                  selectedWidgetCategory === category
                    ? "bg-white text-black"
                    : "border border-white/25 text-white/80"
                }`}
              >
                {category.replace(/^integration-/, "")}
              </button>
            ))}
          </div>
          <div className="flex max-w-full snap-x gap-3 overflow-x-auto overscroll-x-contain pb-2">
            {selectedWidgetOptions.map((widget) => (
              <button
                key={widget.value}
                type="button"
                onClick={() => onUpdate({ widgetType: widget.value })}
                className={`w-56 shrink-0 snap-start rounded-xl p-2 text-center transition ${
                  normalizeWidgetChoice(section.widgetType) === widget.value
                    ? "ring-1 ring-primary"
                    : "hover:bg-white/10"
                }`}
              >
                <div className="mb-2 h-24 overflow-hidden rounded-lg">
                  {renderWidget({
                    type: widget.value,
                    params: {},
                    className: "h-full w-full",
                    isPreview: true,
                  })}
                </div>
                <span className="block truncate text-sm text-white/80">{widget.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div onClick={(event) => event.stopPropagation()}>
        {isGlanceableClock && (
          <div className="mb-3 flex items-center justify-between gap-3">
            <Label>Clock Style</Label>
            <div className="flex items-center gap-2 rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm">
              <span>{section.params?.["clock-style"] ? "Custom" : "Default"}</span>
              {section.params?.["clock-style"] && (
                <button
                  type="button"
                  aria-label="Reset clock style"
                  onClick={() => {
                    const { ["clock-style"]: _clockStyle, ...params } = section.params ?? {};
                    updateParams(params);
                  }}
                  className="text-white/60 hover:text-white"
                >
                  x
                </button>
              )}
            </div>
          </div>
        )}
        {section.widgetType === "weather" && (
          <LocationSelectFormComponent
            value={{
              displayName: String(section.params?.displayName ?? ""),
              coordinates: [section.params?.lat, section.params?.lon].filter(Boolean).join(", "),
            }}
            onChange={(value) => {
              const [lat = "", lon = ""] = value.coordinates.split(",").map((part) => part.trim());
              updateParams({ ...(section.params ?? {}), lat, lon, displayName: value.displayName });
            }}
          />
        )}
        {hasWidgetProperties && (
          <WidgetPropertiesForm
            idPrefix={`frame-widget-${section.id}`}
            schema={widgetSchema}
            value={section.params ?? {}}
            onChange={updateParams}
            onError={onError}
            error={widgetParamsError}
            glanceableOptions={isGlanceableClock ? glanceableOptions : undefined}
            glanceableSlotPositions={["list"]}
            onEditGlanceable={isGlanceableClock ? onEditGlanceable : undefined}
          />
        )}
      </div>

      <div className="space-y-4 border-t border-white/10 pt-4" onClick={(event) => event.stopPropagation()}>
        <div className="space-y-2">
          <Label>Border radius</Label>
          <Slider
            value={[Number(section.params?.appearance?.borderRadius ?? 16)]}
            min={0}
            max={32}
            step={1}
            onValueChange={([value]) => updateAppearance({ borderRadius: value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Background opacity</Label>
          <Slider
            value={[Number(section.params?.appearance?.backgroundOpacity ?? 45)]}
            min={0}
            max={100}
            step={1}
            onValueChange={([value]) => updateAppearance({ backgroundOpacity: value })}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor={`frame-widget-header-${section.id}`}>Show widget header</Label>
          <Switch
            id={`frame-widget-header-${section.id}`}
            checked={section.params?.appearance?.showHeader ?? true}
            onCheckedChange={(checked) => updateAppearance({ showHeader: checked })}
          />
        </div>
      </div>
    </div>
  );
}

export default function SmartFramesManager({
  frames,
  onChange,
  onRulesChange,
}: {
  frames: Frame[];
  onChange: (newFrames: Frame[]) => void | Promise<void>;
  onRulesChange?: (scope: RulesScope, rules: Record<string, any>) => void | Promise<void>;
}) {
  const { user, withAuth } = useAuth();
  const [selectedFrameIndex, setSelectedFrameIndex] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(true);
  const [editFrameId, setEditFrameId] = useState<string | null>(null);
  const [draftType, setDraftType] = useState("glanceable-clock");
  const [layoutPreset, setLayoutPreset] = useState("1x1");
  const [customCols, setCustomCols] = useState(2);
  const [customRows, setCustomRows] = useState(2);
  const [selectedSectionId, setSelectedSectionId] = useState("cell-0-0");
  const [editingFrameGlanceable, setEditingFrameGlanceable] = useState<{
    sectionId: string;
    index: number;
  } | null>(null);
  const [sections, setSections] = useState<FrameSection[]>([]);
  const [widgetOptionsByCategory, setWidgetOptionsByCategory] = useState<
    Record<string, Array<{ value: string; label: string }>>
  >({});
  const [widgetCategories, setWidgetCategories] = useState<string[]>([]);
  const [selectedWidgetCategory, setSelectedWidgetCategory] = useState("frame");
  const [isWidgetCarouselOpen, setIsWidgetCarouselOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("widgets");
  const [rulesScope, setRulesScope] = useState<RulesScope>("global");
  const [draftDisplayRules, setDraftDisplayRules] = useState<Record<string, any>>(
    () => getGlobalRules(user?.screensaverPreferences as Record<string, any> | undefined),
  );
  const [draftDeviceRules, setDraftDeviceRules] = useState<Record<string, any>>(
    () => getDeviceRules(),
  );
  const [glanceableOptions, setGlanceableOptions] = useState<GlanceableOption[]>([]);
  const [widgetSchemas, setWidgetSchemas] = useState<
    Record<string, Record<string, any>>
  >({});
  const [draftBackgroundMode, setDraftBackgroundMode] = useState<
    BackgroundMode
  >("current");
  const [draftBackgroundUrl, setDraftBackgroundUrl] = useState("");
  const [existingBackgroundUrl, setExistingBackgroundUrl] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [brightnessPercent, setBrightnessPercent] = useState(35);
  const [blurPercent, setBlurPercent] = useState(8);
  const [widgetParamsError, setWidgetParamsError] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const draftDirtyRef = useRef(false);

  const brightnessValue = Math.round(
    (brightnessPercent / 100) * (150 - 50) + 50,
  );
  const blurValue = Math.round((blurPercent / 100) * (25 - 1) + 1);
  const selectedLayout =
    FRAME_LAYOUTS.find((layout) => layout.value === layoutPreset) ??
      FRAME_LAYOUTS[0];
  const layoutCols = layoutPreset === "custom"
    ? customCols
    : selectedLayout.cols;
  const layoutRows = layoutPreset === "custom"
    ? customRows
    : selectedLayout.rows;
  const selectedSection =
    sections.find((section) => section.id === selectedSectionId) ?? sections[0];
  const selectedFrame = frames[selectedFrameIndex];
  const selectedWidgetOptions = widgetOptionsByCategory[selectedWidgetCategory] ?? [];
  const resolveWidgetLabel = (type?: string) =>
    Object.values(widgetOptionsByCategory).flat().find((widget) =>
      widget.value === normalizeWidgetChoice(type)
    )?.label ?? type ?? "Widget";
  const activeRules = rulesScope === "global" ? draftDisplayRules : draftDeviceRules;
  const updateRules = (patch: Record<string, any>) => {
    const nextRules = { ...activeRules, ...patch };
    if (rulesScope === "global") {
      setDraftDisplayRules(nextRules);
    } else {
      setDraftDeviceRules(nextRules);
    }
    if (onRulesChange) {
      void Promise.resolve(onRulesChange(rulesScope, nextRules)).catch((saveError) => {
        console.error(saveError);
        setError("Failed to save display rules.");
      });
    }
  };

  useEffect(() => {
    if (selectedFrameIndex >= frames.length) {
      setSelectedFrameIndex(Math.max(0, frames.length - 1));
    }
  }, [frames.length, selectedFrameIndex]);

  useEffect(() => {
    if (selectedFrame) {
      handleOpenEdit(selectedFrame);
    } else {
      setDialogOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFrame?.id]);

  const handleRemoveFrame = (id: string) => {
    void Promise.resolve(onChange(frames.filter((frame) => frame.id !== id))).catch((saveError) => {
      console.error(saveError);
      setError("Failed to save frame.");
    });
  };

  const handleRenameFrame = (frame: Frame, index: number) => {
    const currentName = getFrameName(frame, index);
    const nextName = window.prompt("Rename page", currentName);
    if (nextName === null) return;

    const trimmed = nextName.trim();
    void Promise.resolve(onChange(
      frames.map((item) =>
        item.id === frame.id
          ? {
            ...item,
            params: {
              ...(item.params ?? {}),
              ...(trimmed ? { name: trimmed } : {}),
            },
          }
        : item,
      ),
    )).catch((saveError) => {
      console.error(saveError);
      setError("Failed to save frame.");
    });
  };

  const updateSection = (sectionId: string, patch: Partial<FrameSection>) => {
    if (editFrameId) draftDirtyRef.current = true;
    setSections((current) =>
      current.map((section) =>
        section.id === sectionId ? { ...section, ...patch } : section
      )
    );
    if (patch.widgetType && sectionId === selectedSectionId) setDraftType(patch.widgetType);
  };

  const updateSelectedSection = (patch: Partial<FrameSection>) =>
    updateSection(selectedSectionId, patch);

  const updateFrameGlanceable = (next: FrameGlanceable) => {
    if (!editingFrameGlanceable) return;
    const section = sections.find((item) => item.id === editingFrameGlanceable.sectionId);
    if (!section) return;

    const glanceables = getFrameGlanceables(section.params?.glanceables);
    if (!glanceables[editingFrameGlanceable.index]) return;

    updateSection(section.id, {
      params: {
        ...(section.params ?? {}),
        glanceables: glanceables.map((item, index) =>
          index === editingFrameGlanceable.index ? next : item
        ),
      },
    });
  };

  const removeFrameGlanceable = () => {
    if (!editingFrameGlanceable) return;
    const section = sections.find((item) => item.id === editingFrameGlanceable.sectionId);
    if (!section) return;

    const glanceables = getFrameGlanceables(section.params?.glanceables);
    updateSection(section.id, {
      params: {
        ...(section.params ?? {}),
        glanceables: glanceables.filter((_, index) => index !== editingFrameGlanceable.index),
      },
    });
    setEditingFrameGlanceable(null);
  };

  const editingSection = editingFrameGlanceable
    ? sections.find((section) => section.id === editingFrameGlanceable.sectionId)
    : undefined;
  const editingGlanceable = editingSection && editingFrameGlanceable
    ? getFrameGlanceables(editingSection.params?.glanceables)[editingFrameGlanceable.index]
    : undefined;

  useEffect(() => {
    if (!uploadFile) {
      setUploadPreview(null);
      return;
    }

    const url = URL.createObjectURL(uploadFile);
    setUploadPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [uploadFile]);

  useEffect(() => {
    void withAuth(async (auth) => {
      const [widgetsData, glanceablesData] = await Promise.all([
        getUserWidgetsAction(auth).catch(() => ({})),
        getUserGlanceablesAction(auth).catch(() => []),
      ]);

      const localWidgets = LOCAL_WIDGET_OPTIONS.map((item) =>
        typeof item === "string"
          ? { value: item, label: item.replace(/-/g, " ") }
          : item,
      ).filter((item) => !EXCLUDED_FRAME_WIDGETS.has(item.value));

      const integrationWidgetsByCategory = Object.fromEntries(
        Object.entries((widgetsData ?? {}) as Record<string, any[]>).map(([
          category,
          widgets,
        ]) => [
          category,
          (Array.isArray(widgets) ? widgets : []).map((widget) => ({
            value: String(widget.key ?? ""),
            label: String(widget.name ?? widget.key ?? "Integration widget"),
            schema: widget.input && typeof widget.input === "object"
              ? widget.input
              : widget.data?.input && typeof widget.data.input === "object"
              ? widget.data.input
              : widget.properties && typeof widget.properties === "object"
              ? widget.properties
              : {},
          })).filter((widget) => widget.value && !EXCLUDED_FRAME_WIDGETS.has(widget.value)),
        ]),
      );

      const integrationWidgets = Object.values(integrationWidgetsByCategory).flat();
      const nextWidgetOptionsByCategory = {
        frame: localWidgets,
        ...integrationWidgetsByCategory,
      };
      const nextWidgetCategories = Object.entries(nextWidgetOptionsByCategory)
        .filter(([, widgets]) => widgets.length > 0)
        .map(([category]) => category);

      const glanceables =
        (Array.isArray(glanceablesData) ? glanceablesData : []).map((
          glanceable: any,
        ) => ({
          value: String(glanceable.type ?? glanceable.key ?? ""),
          label: String(
            glanceable.name ?? glanceable.displayName ?? glanceable.type ??
              glanceable.key ?? "Glanceable",
          ),
          exampleProps: glanceable.exampleProps && typeof glanceable.exampleProps === "object"
            ? glanceable.exampleProps
            : {},
          properties: glanceable.properties && typeof glanceable.properties === "object"
            ? glanceable.properties
            : {},
        })).filter((glanceable) => glanceable.value);

      setWidgetOptionsByCategory(nextWidgetOptionsByCategory);
      setWidgetCategories(nextWidgetCategories);
      setSelectedWidgetCategory((current) =>
        nextWidgetCategories.includes(current) ? current : nextWidgetCategories[0] ?? "frame"
      );
      setWidgetSchemas({
        ...LOCAL_WIDGET_SCHEMAS,
        ...Object.fromEntries(
          integrationWidgets.map((widget) => [widget.value, widget.schema]),
        ),
      });
      setGlanceableOptions(glanceables);
    });
  }, [withAuth]);

  useEffect(() => {
    setSections((current) => buildSections(layoutCols, layoutRows, current));
  }, [layoutCols, layoutRows]);

  useEffect(() => {
    if (!sections.some((section) => section.id === selectedSectionId)) {
      setSelectedSectionId(sections[0]?.id ?? "cell-0-0");
    }
  }, [sections, selectedSectionId]);

  const resetDraft = () => {
    draftDirtyRef.current = false;
    setEditFrameId(null);
    setEditingFrameGlanceable(null);
    setSettingsTab("widgets");
    setDraftDisplayRules({});
    setDraftDeviceRules({});
    setDraftType("glanceable-clock");
    setLayoutPreset("1x1");
    setCustomCols(2);
    setCustomRows(2);
    setSelectedSectionId("cell-0-0");
    setSections(buildSections(1, 1));
    setDraftBackgroundMode("current");
    setDraftBackgroundUrl("");
    setExistingBackgroundUrl("");
    setUploadFile(null);
    setUploadPreview(null);
    setUploading(false);
    setBrightnessPercent(35);
    setBlurPercent(8);
    setWidgetParamsError(null);
    setError(null);
    setIsWidgetCarouselOpen(false);
  };

  const handleOpenAdd = () => {
    resetDraft();
    setDraftDisplayRules(
      getGlobalRules(user?.screensaverPreferences as Record<string, any> | undefined),
    );
    setDraftDeviceRules(getDeviceRules());
    const fallbackFilters = normalizeWallpaperFilters(
      user?.appearancePreferences?.wallpaperFilters as any,
    );
    const brightness = fallbackFilters.brightness;
    const blur = fallbackFilters.blur;
    setBrightnessPercent(Math.round(((brightness - 50) / (150 - 50)) * 100));
    setBlurPercent(Math.round(((blur - 1) / (25 - 1)) * 100));
    setDialogOpen(true);
  };

  const handleOpenEdit = (frame: Frame) => {
    setEditingFrameGlanceable(null);
    const backgroundImageUrl = String(frame.params?.backgroundImageUrl ?? "");
    const backgroundSource = frame.params?.backgroundSource as
      | BackgroundMode
      | undefined;
    const inferredMode: BackgroundMode = backgroundSource
      ? backgroundSource
      : backgroundImageUrl
      ? "url"
      : "current";
    const editableParams = { ...(frame.params ?? {}) } as Record<string, any>;
    const layout =
      editableParams.layout && typeof editableParams.layout === "object"
        ? editableParams.layout as Record<string, any>
        : undefined;
    const cols = clampLayoutSize(Number(layout?.cols ?? 1));
    const rows = clampLayoutSize(Number(layout?.rows ?? 1));
    const preset =
      FRAME_LAYOUTS.some((item) => item.value === `${cols}x${rows}`)
        ? `${cols}x${rows}`
        : "custom";
    const legacyWidgetParams = { ...editableParams };
    delete legacyWidgetParams.backgroundImageUrl;
    delete legacyWidgetParams.backgroundSource;
    delete legacyWidgetParams.backgroundFilters;
    delete legacyWidgetParams.layout;
    delete legacyWidgetParams.sections;
    delete legacyWidgetParams.__pageName;
    const nextSections = buildSections(
      cols,
      rows,
      Array.isArray(editableParams.sections)
        ? editableParams.sections
        : [{ id: "cell-0-0", widgetType: frame.type, params: legacyWidgetParams }],
    ).map((section) => ({
      ...section,
      params: stripPrivateSectionParams(section.params),
    }));
    delete editableParams.backgroundImageUrl;
    delete editableParams.backgroundSource;
    delete editableParams.backgroundFilters;
    delete editableParams.layout;
    delete editableParams.sections;
    delete editableParams.__pageName;
    const fallbackFilters = normalizeWallpaperFilters(
      user?.appearancePreferences?.wallpaperFilters as any,
    );
    const filters = frame.params?.backgroundFilters as
      | Record<string, any>
      | undefined;
    const brightness = typeof filters?.brightness === "number"
      ? filters.brightness
      : fallbackFilters.brightness;
    const blur = typeof filters?.blur === "number"
      ? filters.blur
      : fallbackFilters.blur;

    setEditFrameId(frame.id);
    setDraftDisplayRules(
      getGlobalRules(user?.screensaverPreferences as Record<string, any> | undefined),
    );
    setDraftDeviceRules(
      getDeviceRules(),
    );
    setSettingsTab("widgets");
    setDraftType(nextSections[0]?.widgetType ?? frame.type);
    setLayoutPreset(preset);
    setCustomCols(cols);
    setCustomRows(rows);
    setSections(nextSections);
    setSelectedSectionId(nextSections[0]?.id ?? "cell-0-0");
    setDraftBackgroundMode(inferredMode);
    setDraftBackgroundUrl(backgroundImageUrl);
    setExistingBackgroundUrl(backgroundImageUrl);
    setUploadFile(null);
    setUploadPreview(null);
    setUploading(false);
    setBrightnessPercent(Math.round(((brightness - 50) / (150 - 50)) * 100));
    setBlurPercent(Math.round(((blur - 1) / (25 - 1)) * 100));
    setWidgetParamsError(null);
    setError(null);
    setIsWidgetCarouselOpen(false);
    setDialogOpen(true);
  };

  const handleDialogChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) resetDraft();
  };

  const handleSaveFrame = async (closeAfterSave = true) => {
    setError(null);
    setWidgetParamsError(null);

    const selectedParams: Record<string, any> = stripPrivateSectionParams(
      selectedSection?.params,
    );

    let backgroundImageUrl: string | undefined;
    let backgroundSource: BackgroundMode | undefined;

    if (draftBackgroundMode === "current") {
      backgroundSource = "current";
    }

    if (draftBackgroundMode === "none") {
      backgroundSource = "none";
    }

    if (draftBackgroundMode === "upload") {
      if (uploadFile) {
        setUploading(true);
        try {
          const formData = new FormData();
          formData.append("image", uploadFile, uploadFile.name);
          formData.append("fileName", uploadFile.name);
          formData.append("convertToWebp", "false");

          const body: any = await withAuth((auth) =>
            uploadWallpaperAction(auth, formData)
          );
          backgroundImageUrl = String(body.path || "");
          backgroundSource = "upload";
        } catch (err) {
          console.error(err);
          setError("Failed to upload image.");
          setUploading(false);
          return;
        } finally {
          setUploading(false);
        }
      } else if (existingBackgroundUrl) {
        backgroundImageUrl = existingBackgroundUrl;
        backgroundSource = "upload";
      } else {
        setError("Please choose an image to upload.");
        return;
      }
    }

    if (draftBackgroundMode === "url") {
      if (!draftBackgroundUrl.trim()) {
        setError("Please enter a background URL.");
        return;
      }
      backgroundImageUrl = draftBackgroundUrl.trim();
      backgroundSource = "url";
    }

    const existingFrame = editFrameId
      ? frames.find((frame) => frame.id === editFrameId)
      : undefined;

    const nextParams = { ...(existingFrame?.params ?? {}) } as Record<string, any>;
    delete nextParams.backgroundImageUrl;
    delete nextParams.backgroundSource;
    delete nextParams.backgroundFilters;
    delete nextParams.layout;
    delete nextParams.sections;
    delete nextParams.displayRules;
    delete nextParams.deviceRules;
    const normalizedSections = buildSections(layoutCols, layoutRows, sections)
      .map((section) => ({
        ...section,
        params: Object.fromEntries(
          Object.entries(
            section.id === selectedSectionId
              ? selectedParams
              : stripPrivateSectionParams(section.params),
          ),
        ),
      }));
    nextParams.layout = { cols: layoutCols, rows: layoutRows };
    nextParams.sections = normalizedSections;

    if (draftBackgroundMode === "current" || draftBackgroundMode === "none") {
      delete nextParams.backgroundImageUrl;
      nextParams.backgroundSource = backgroundSource;
    } else if (backgroundImageUrl) {
      nextParams.backgroundImageUrl = backgroundImageUrl;
      nextParams.backgroundSource = backgroundSource;
    }

    if (draftBackgroundMode === "none") {
      delete nextParams.backgroundFilters;
    } else {
      nextParams.backgroundFilters = {
        brightness: brightnessValue,
        blur: blurValue,
      };
    }

    const nextFrame: Frame = {
      id: existingFrame?.id ??
        `frame-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type: normalizedSections[0]?.widgetType ?? draftType,
      params: nextParams,
    };

    try {
      if (existingFrame) {
        await onChange(
          frames.map((
            frame,
          ) => (frame.id === existingFrame.id ? nextFrame : frame)),
        );
      } else {
        await onChange([...frames, nextFrame]);
        setSelectedFrameIndex(frames.length);
      }
    } catch (saveError) {
      console.error(saveError);
      setError("Failed to save frame.");
      return;
    }

    draftDirtyRef.current = false;
    if (closeAfterSave) {
      setDialogOpen(false);
      resetDraft();
    }
  };

  useEffect(() => {
    if (!editFrameId || !dialogOpen || !draftDirtyRef.current) return;

    const timer = window.setTimeout(() => {
      void handleSaveFrame(false);
    }, 500);

    return () => window.clearTimeout(timer);
    // Save draft widget changes without closing editor or resetting its state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dialogOpen,
    editFrameId,
    layoutCols,
    layoutRows,
    sections,
    draftBackgroundMode,
    draftBackgroundUrl,
    uploadFile,
    brightnessPercent,
    blurPercent,
  ]);

  return (
    <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Pages</h3>
          <Button
            type="button"
            variant="outline"
            className="rounded-md border border-transparent bg-white/5 hover:bg-white/10 frosted group text-white"
            onClick={handleOpenAdd}
          >
            <Plus className="w-4 h-4 group-hover:text-primary" />
            Add Frame
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 rounded-t-xl rounded-md py-2">
          {frames.map((frame, index) => (
            <div key={frame.id} className="mx-auto min-w-0 max-w-full" style={{ width: FRAME_PREVIEW_SIZE.width }}>
              <div
                className="rounded-2xl bg-transparent p-3 transition"
              >
                <div
                  className="h-40 w-full max-w-full overflow-hidden rounded-2xl bg-transparent"
                  style={{ height: FRAME_PREVIEW_SIZE.height }}
                >
                  <FrameLayoutPreview
                    frame={frame}
                    resolveWidgetLabel={resolveWidgetLabel}
                    onSelectSection={(sectionId) => {
                      setSelectedFrameIndex(index);
                      setSelectedSectionId(sectionId);
                    }}
                  />
                </div>
                <div className="relative mt-3 flex items-center gap-2 pr-8">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 rounded-full text-white/70 hover:bg-white/10 hover:text-white"
                        onClick={() => setSelectedFrameIndex(index)}
                        aria-label={`Change layout for ${getFrameName(frame, index)}`}
                      >
                        <LayoutPreview
                          cols={getFrameLayout(frame).cols}
                          rows={getFrameLayout(frame).rows}
                          className="h-4 w-4"
                        />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-72 space-y-3 frosted text-foreground">
                      <div>
                        <div className="text-sm font-medium">Layout</div>
                        <div className="text-xs text-white/60">Choose page grid</div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {FRAME_LAYOUTS.map((layout) => {
                          const active = layout.value === layoutPreset;
                          const tile = (
                            <button
                              type="button"
                              onClick={() => setLayoutPreset(layout.value)}
                              className={`space-y-2 rounded-xl border p-2 text-left transition ${
                                active
                                  ? "border-primary bg-primary/15"
                                  : "border-white/10 bg-white/5 hover:bg-white/10"
                              }`}
                            >
                              <LayoutPreview cols={layout.cols} rows={layout.rows} className="h-12 w-12" />
                              <div className="text-sm font-medium">{layout.label}</div>
                            </button>
                          );
                          return (
                            layout.value === "custom"
                              ? <div key={layout.value}>{tile}</div>
                              : <PopoverClose asChild key={layout.value}>{tile}</PopoverClose>
                          );
                        })}
                      </div>
                      {layoutPreset === "custom" && (
                        <div className="grid grid-cols-2 gap-2 border-t border-white/10 pt-3">
                          <div className="space-y-1">
                            <Label className="text-xs text-white/70">Columns</Label>
                            <Input
                              type="number"
                              min={1}
                              max={4}
                              value={customCols}
                              onChange={(event) =>
                                setCustomCols(
                                  clampLayoutSize(Number(event.target.value)),
                                )}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-white/70">Rows</Label>
                            <Input
                              type="number"
                              min={1}
                              max={4}
                              value={customRows}
                              onChange={(event) =>
                                setCustomRows(
                                  clampLayoutSize(Number(event.target.value)),
                                )}
                            />
                          </div>
                        </div>
                      )}
                    </PopoverContent>
                  </Popover>
                  <button
                    type="button"
                    onClick={() => setSelectedFrameIndex(index)}
                    className={`mx-auto text-center font-medium ${
                    selectedFrameIndex === index
                      ? "rounded-full bg-primary px-3 py-1 text-primary-foreground"
                      : "text-white/90"
                  }`}
                  >
                    {getFrameName(frame, index)}
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 h-8 w-8 text-white/70 hover:bg-white/10 hover:text-white"
                        onClick={(event) => event.stopPropagation()}
                        aria-label={`Page actions for ${getFrameName(frame, index)}`}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem
                        onSelect={() => handleRenameFrame(frame, index)}
                      >
                        <Pencil className="h-4 w-4" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => handleRemoveFrame(frame.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          ))}
        {frames.length > 1 && (
          <div className="flex justify-center gap-2 col-span-2">
            {frames.map((frame, index) => (
              <button
                key={frame.id}
                type="button"
                aria-label={`Show page ${index + 1}`}
                onClick={() => setSelectedFrameIndex(index)}
                className={`h-2 rounded-full transition-all ${
                  selectedFrameIndex === index
                    ? "w-6 bg-primary"
                    : "w-2 bg-white/30 hover:bg-white/60"
                }`}
              />
            ))}
          </div>
        )}
      </div>

      <div
        className={`grid transition-all duration-250 ease-out ${
          dialogOpen
            ? "grid-rows-[1fr] opacity-100"
            : "grid-rows-[0fr] opacity-0 pointer-events-none"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <section className="space-y-4 rounded-md rounded-b-xl border border-transparent text-foreground">

            <div className="min-w-0 space-y-4 overflow-hidden">
              <Tabs value={settingsTab} onValueChange={setSettingsTab} className="space-y-4">
                <TabsList className="self-center">
                  <TabsTrigger value="background">Background</TabsTrigger>
                  <TabsTrigger value="widgets">Widgets</TabsTrigger>
                  <TabsTrigger value="rules">Display Rules</TabsTrigger>
                </TabsList>

                <TabsContent value="widgets" className="space-y-4">
                  <div className="frosted space-y-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-semibold">Layout</h2>
                      </div>
                      <div className="flex items-center gap-2">
                        <LayoutPreview cols={layoutCols} rows={layoutRows} className="h-8 w-8" />
                        <select
                          aria-label="Frame layout"
                          value={layoutPreset}
                          onChange={(event) => {
                            if (editFrameId) draftDirtyRef.current = true;
                            setLayoutPreset(event.target.value);
                          }}
                          className="rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm outline-none"
                        >
                          {FRAME_LAYOUTS.map((layout) => (
                            <option key={layout.value} value={layout.value}>{layout.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {layoutPreset === "custom" && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label>Columns</Label>
                          <Input type="number" min={1} max={4} value={customCols} onChange={(event) => {
                            if (editFrameId) draftDirtyRef.current = true;
                            setCustomCols(clampLayoutSize(Number(event.target.value)));
                          }} />
                        </div>
                        <div className="space-y-1">
                          <Label>Rows</Label>
                          <Input type="number" min={1} max={4} value={customRows} onChange={(event) => {
                            if (editFrameId) draftDirtyRef.current = true;
                            setCustomRows(clampLayoutSize(Number(event.target.value)));
                          }} />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="space-y-4">
                    {sections.map((section) => (
                      <FrameWidgetSlotEditor
                        key={section.id}
                        section={section}
                        isSelected={selectedSectionId === section.id}
                        isCarouselOpen={selectedSectionId === section.id && isWidgetCarouselOpen}
                        widgetCategories={widgetCategories}
                        selectedWidgetCategory={selectedWidgetCategory}
                        selectedWidgetOptions={selectedWidgetOptions}
                        widgetSchemas={widgetSchemas}
                        glanceableOptions={glanceableOptions}
                        widgetParamsError={widgetParamsError}
                        resolveWidgetLabel={resolveWidgetLabel}
                        onSelect={() => {
                          setSelectedSectionId(section.id);
                          setIsWidgetCarouselOpen(false);
                        }}
                        onToggleCarousel={() => {
                          setSelectedSectionId(section.id);
                          setIsWidgetCarouselOpen((current) => selectedSectionId !== section.id || !current);
                        }}
                        onCategoryChange={setSelectedWidgetCategory}
                        onUpdate={(patch) => {
                          setSelectedSectionId(section.id);
                          updateSection(section.id, patch);
                        }}
                        onError={setWidgetParamsError}
                        onEditGlanceable={(index) =>
                          setEditingFrameGlanceable({ sectionId: section.id, index })}
                      />
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="background" className="space-y-3">
                  <div className="frosted space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">Background</h2>
                    <p className="text-sm text-white/60">Choose the background for this frame.</p>
                  </div>
                </div>
                <RadioGroup
                  value={draftBackgroundMode}
                  onValueChange={(value) => {
                    if (editFrameId) draftDirtyRef.current = true;
                    setDraftBackgroundMode(value as BackgroundMode);
                  }}
                  className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(140px,1fr))]"
                >
                  {(["none", "current", "upload", "url"] as const).map((mode) => (
                    <div key={mode}>
                      <RadioGroupItem
                        id={`frame-bg-${mode}`}
                        value={mode}
                        className="peer sr-only"
                      />
                      <Label
                        htmlFor={`frame-bg-${mode}`}
                        className="group flex h-20 cursor-pointer flex-col items-center justify-center rounded-xl border border-transparent p-3 text-center text-sm frosted outline outline-transparent outline-offset-2 peer-data-[state=checked]:outline-(--primary) peer-focus-visible:outline peer-focus-visible:outline-(--primary)"
                      >
                        {mode === "none"
                          ? "None"
                          : mode === "current"
                          ? "Current"
                          : mode === "upload"
                          ? "Upload"
                          : "Add from URL"}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>

                {draftBackgroundMode === "upload" && (
                  <div className="space-y-2">
                    <Label htmlFor="frame-bg-file">Image file</Label>
                    <Input
                      id="frame-bg-file"
                      type="file"
                      accept="image/*"
                      onChange={(event) => {
                        if (editFrameId) draftDirtyRef.current = true;
                        setUploadFile(event.target.files?.[0] ?? null);
                      }}
                    />
                  </div>
                )}

                {draftBackgroundMode === "url" && (
                  <div className="space-y-2">
                    <Label htmlFor="frame-bg-url-input">Image URL</Label>
                    <Input
                      id="frame-bg-url-input"
                      type="url"
                      placeholder="https://example.com/background.jpg"
                      value={draftBackgroundUrl}
                      onChange={(event) => {
                        if (editFrameId) draftDirtyRef.current = true;
                        setDraftBackgroundUrl(event.target.value);
                      }}
                    />
                  </div>
                )}

                {(uploadPreview ||
                  (draftBackgroundMode === "url" && draftBackgroundUrl) ||
                  (draftBackgroundMode === "upload" &&
                    existingBackgroundUrl)) && (
                  <div className="relative h-40 w-full overflow-hidden rounded-md border border-white/10">
                    <img
                      src={uploadPreview || (draftBackgroundMode === "url"
                        ? draftBackgroundUrl
                        : existingBackgroundUrl)}
                      alt="Background preview"
                      className="h-full w-full object-cover"
                    />
                  </div>
                )}

                {draftBackgroundMode !== "none" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm font-medium">Darken/Brighten</p>
                      <span className="min-w-[50px] text-right text-sm text-white/70">
                        {brightnessValue}%
                      </span>
                    </div>
                    <Slider
                      value={[brightnessPercent]}
                      max={100}
                      step={1}
                      onValueChange={([value]) => {
                        if (editFrameId) draftDirtyRef.current = true;
                        setBrightnessPercent(value);
                      }}
                    />
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm font-medium">Blur</p>
                      <span className="min-w-[50px] text-right text-sm text-white/70">
                        {blurValue}px
                      </span>
                    </div>
                    <Slider
                      value={[blurPercent]}
                      max={100}
                      step={1}
                      onValueChange={([value]) => {
                        if (editFrameId) draftDirtyRef.current = true;
                        setBlurPercent(value);
                      }}
                    />
                  </div>
                )}
                  </div>
                </TabsContent>

                <TabsContent value="rules" className="space-y-4">
                  <div className="flex items-center gap-2 overflow-x-auto">
                    <button
                      type="button"
                      onClick={() => setRulesScope("global")}
                      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm ${rulesScope === "global" ? "bg-white text-black" : "border border-white/25 text-white/75"}`}
                    >
                      Global
                    </button>
                    <button
                      type="button"
                      onClick={() => setRulesScope("device")}
                      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm ${rulesScope === "device" ? "bg-white text-black" : "border border-white/25 text-white/75"}`}
                    >
                      This device
                    </button>
                  </div>
                  <div className="frosted space-y-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor={`frame-rules-button-${rulesScope}`}>Manual trigger button</Label>
                      <Switch
                        id={`frame-rules-button-${rulesScope}`}
                        checked={!!activeRules.showButton}
                        onCheckedChange={(checked) => updateRules({ showButton: checked })}
                      />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                      <Label htmlFor={`frame-rules-timeout-${rulesScope}`}>Inactivity period (seconds)</Label>
                      <Input
                        id={`frame-rules-timeout-${rulesScope}`}
                        type="number"
                        min={0}
                        value={activeRules.inactivityTimeout ?? ""}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (Number.isFinite(value)) updateRules({ inactivityTimeout: value });
                        }}
                        className="w-full sm:w-32"
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {(["inactivityPageId", "manualPageId"] as const).map((rule) => (
                        <div key={rule} className="space-y-2">
                          <Label>{rule === "inactivityPageId" ? "After inactivity go to" : "Manual trigger go to"}</Label>
                          <Select
                            value={activeRules[rule] ?? "frame"}
                            onValueChange={(value) => updateRules({ [rule]: value })}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="frame">Frame</SelectItem>
                              {frames.map((frame, index) => (
                                <SelectItem key={frame.id} value={frame.id}>
                                  {getFrameName(frame, index)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  </div>
                </TabsContent>
              </Tabs>

              {error && <div className="text-sm text-red-400">{error}</div>}
            </div>

            <div className="flex items-center justify-end gap-2">
              {!editFrameId && (
                <>
                  <Button variant="ghost" onClick={() => handleDialogChange(false)}>
                    Cancel
                  </Button>
              <Button onClick={handleSaveFrame} disabled={uploading}>
                    {uploading ? "Saving..." : "Add Frame"}
                  </Button>
                </>
              )}
            </div>
          </section>
        </div>
      </div>
      <Dialog
        open={Boolean(editingGlanceable)}
        onOpenChange={(open) => {
          if (!open) setEditingFrameGlanceable(null);
        }}
      >
        <DialogContent className="frosted max-h-[90vh] overflow-x-hidden overflow-y-auto text-foreground">
          {editingGlanceable && editingFrameGlanceable && (
            <FrameGlanceableModal
              key={`${editingFrameGlanceable.sectionId}-${editingFrameGlanceable.index}`}
              glanceable={editingGlanceable}
              glanceableOptions={glanceableOptions}
              onChange={updateFrameGlanceable}
              onRemove={removeFrameGlanceable}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
