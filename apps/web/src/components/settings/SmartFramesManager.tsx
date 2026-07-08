"use client";

import { useEffect, useState } from "react";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import useAuth from "@/context/useAuth";
import {
  getUserGlanceablesAction,
  getUserWidgetsAction,
  uploadWallpaperAction,
} from "@/lib/apiClient";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { normalizeWallpaperFilters } from "./wallpaperFilterDefaults";
import { renderWidget } from "../widgets/Widget";
import WidgetPropertiesForm from "@dashwise/integrationskit/forms/WidgetPropertiesForm";
import LocationSelectFormComponent from "./LocationSelectForm";

const LOCAL_WIDGET_OPTIONS = [
  { value: "glanceable-clock", label: "Frame glanceable clock" },
  { value: "calendar-today", label: "Calendar Overview: Today" },
  { value: "calendar-week", label: "Calendar Overview: Week" },
  { value: "calendar-upcoming", label: "Calendar Overview: Upcoming" },
  { value: "progress", label: "Calendar progress" },
  "countdown",
  "rss-feed",
  "monitoring",
] as const;

const FRAME_LAYOUTS = [
  { value: "1x1", label: "1x1", cols: 1, rows: 1 },
  { value: "2x1", label: "2x1", cols: 2, rows: 1 },
  { value: "2x2", label: "2x2", cols: 2, rows: 2 },
  { value: "custom", label: "Custom", cols: 2, rows: 2 },
] as const;

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

type BackgroundMode = "current" | "none" | "upload" | "url";

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
  selectedSectionId,
  onSelectSection,
}: {
  frame: Frame;
  resolveWidgetLabel: (type?: string) => string;
  selectedSectionId?: string;
  onSelectSection?: (sectionId: string) => void;
}) {
  const layout = getFrameLayout(frame);
  const sections = Array.isArray(frame.params?.sections)
    ? frame.params.sections
    : [];
  return (
    <div
      className="grid h-full gap-2"
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
          className={`frosted min-w-0 overflow-hidden rounded-xl border bg-white/5 p-2 text-center text-xs shadow-sm backdrop-blur-xl transition ${
            selectedSectionId === section.id
              ? "border-primary/70 bg-primary/15 text-white"
              : "border-white/10 text-white/75 hover:bg-white/10"
          }`}
        >
          <span className="flex h-full min-h-0 flex-col items-center justify-center gap-1 text-center leading-tight">
            {selectedSectionId === section.id ? <span className="text-primary">•</span> : null}
            <span className="whitespace-normal break-words font-medium">
              {resolveWidgetLabel(section.widgetType || frame.type)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

export default function SmartFramesManager({
  frames,
  onChange,
}: {
  frames: Frame[];
  onChange: (newFrames: Frame[]) => void;
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
  const [sections, setSections] = useState<FrameSection[]>([]);
  const [widgetOptions, setWidgetOptions] = useState<
    Array<{ value: string; label: string }>
  >(
    LOCAL_WIDGET_OPTIONS.map((item) =>
      typeof item === "string"
        ? { value: item, label: item.replace(/-/g, " ") }
        : item
    ),
  );
  const [glanceableOptions, setGlanceableOptions] = useState<
    Array<{ value: string; label: string }>
  >([]);
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
  const selectedWidgetLabel =
    widgetOptions.find((widget) =>
      widget.value === normalizeWidgetChoice(selectedSection?.widgetType)
    )?.label ?? selectedSection?.widgetType ?? "Widget";
  const resolveWidgetLabel = (type?: string) =>
    widgetOptions.find((widget) =>
      widget.value === normalizeWidgetChoice(type)
    )?.label ?? type ?? "Widget";

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
    onChange(frames.filter((frame) => frame.id !== id));
  };

  const handleRenameFrame = (frame: Frame, index: number) => {
    const currentName = getFrameName(frame, index);
    const nextName = window.prompt("Rename page", currentName);
    if (nextName === null) return;

    const trimmed = nextName.trim();
    onChange(
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
    );
  };

  const updateSelectedSection = (patch: Partial<FrameSection>) => {
    setSections((current) =>
      current.map((section) =>
        section.id === selectedSectionId ? { ...section, ...patch } : section
      )
    );
    if (patch.widgetType) setDraftType(patch.widgetType);
  };

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

      const integrationWidgets = Object.entries(
        (widgetsData ?? {}) as Record<string, any[]>,
      ).flatMap(([, widgets]) =>
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
        })).filter((widget) =>
          widget.value && !EXCLUDED_FRAME_WIDGETS.has(widget.value)
        )
      );

      const glanceables =
        (Array.isArray(glanceablesData) ? glanceablesData : []).map((
          glanceable: any,
        ) => ({
          value: String(glanceable.type ?? glanceable.key ?? ""),
          label: String(
            glanceable.name ?? glanceable.displayName ?? glanceable.type ??
              glanceable.key ?? "Glanceable",
          ),
        })).filter((glanceable) => glanceable.value);

      setWidgetOptions([
        ...LOCAL_WIDGET_OPTIONS.map((item) =>
          typeof item === "string"
            ? { value: item, label: item.replace(/-/g, " ") }
            : item
        ).filter((item) => !EXCLUDED_FRAME_WIDGETS.has(item.value)),
        ...integrationWidgets,
      ]);
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
    setEditFrameId(null);
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
  };

  const handleOpenAdd = () => {
    resetDraft();
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
    const nextSections = buildSections(
      cols,
      rows,
      Array.isArray(editableParams.sections)
        ? editableParams.sections
        : [{ id: "cell-0-0", widgetType: frame.type, params: editableParams }],
    );
    if (nextSections[0]) {
      nextSections[0].params = {
        ...(nextSections[0].params ?? {}),
        __pageName: String(frame.params?.name ?? ""),
      };
    }
    delete editableParams.backgroundImageUrl;
    delete editableParams.backgroundSource;
    delete editableParams.backgroundFilters;
    delete editableParams.layout;
    delete editableParams.sections;
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
    setDialogOpen(true);
  };

  const handleDialogChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) resetDraft();
  };

  const handleSaveFrame = async () => {
    setError(null);
    setWidgetParamsError(null);

    const selectedParams: Record<string, any> = selectedSection?.params ?? {};

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

    const nextParams = {} as Record<string, any>;
    const normalizedSections = buildSections(layoutCols, layoutRows, sections)
      .map((section) => ({
        ...section,
        params: Object.fromEntries(
          Object.entries(
            section.id === selectedSectionId
              ? selectedParams
              : section.params ?? {},
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

    if (existingFrame) {
      onChange(
        frames.map((
          frame,
        ) => (frame.id === existingFrame.id ? nextFrame : frame)),
      );
    } else {
      onChange([...frames, nextFrame]);
      setSelectedFrameIndex(frames.length);
    }

    setDialogOpen(false);
    resetDraft();
  };

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
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 frosted rounded-t-xl rounded-md">
          {frames.map((frame, index) => (
            <div key={frame.id} className="mx-auto min-w-0 max-w-[250px]">
              <div
                className={`rounded-2xl p-3 transition ${
                  "bg-transparent"
                }`}
              >
                <div className="aspect-[3/2] w-full overflow-hidden rounded-2xl bg-transparent outline outline-offset-4 outline-dotted">
                  <FrameLayoutPreview
                    frame={frame}
                    resolveWidgetLabel={resolveWidgetLabel}
                    selectedSectionId={selectedFrameIndex === index ? selectedSectionId : undefined}
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
          <div className="flex justify-center gap-2">
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
              <Tabs
                defaultValue="style"
                className="min-w-0 space-y-3 overflow-hidden"
              >
                <TabsList className="w-full grid grid-cols-2">
                  <TabsTrigger value="style">Widget style</TabsTrigger>
                  <TabsTrigger value="properties">
                    Widget properties
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="style" className="space-y-3">
                  <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="font-medium">
                      Customize {selectedWidgetLabel}
                    </div>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Border radius</Label>
                        <Slider
                          value={[
                            Number(
                              selectedSection?.params?.appearance
                                ?.borderRadius ?? 16,
                            ),
                          ]}
                          min={0}
                          max={32}
                          step={1}
                          onValueChange={([value]) =>
                            updateSelectedSection({
                              params: {
                                ...(selectedSection?.params ?? {}),
                                appearance: {
                                  ...(selectedSection?.params?.appearance ??
                                    {}),
                                  borderRadius: value,
                                },
                              },
                            })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Background opacity</Label>
                        <Slider
                          value={[
                            Number(
                              selectedSection?.params?.appearance
                                ?.backgroundOpacity ?? 45,
                            ),
                          ]}
                          min={0}
                          max={100}
                          step={1}
                          onValueChange={([value]) =>
                            updateSelectedSection({
                              params: {
                                ...(selectedSection?.params ?? {}),
                                appearance: {
                                  ...(selectedSection?.params?.appearance ??
                                    {}),
                                  backgroundOpacity: value,
                                },
                              },
                            })}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <Label htmlFor="frame-widget-header">
                          Show widget header
                        </Label>
                        <Switch
                          id="frame-widget-header"
                          checked={selectedSection?.params?.appearance
                            ?.showHeader ?? true}
                          onCheckedChange={(checked) =>
                            updateSelectedSection({
                              params: {
                                ...(selectedSection?.params ?? {}),
                                appearance: {
                                  ...(selectedSection?.params?.appearance ??
                                    {}),
                                  showHeader: checked,
                                },
                              },
                            })}
                        />
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent
                  value="properties"
                  className="min-w-0 space-y-3 overflow-hidden"
                >
                <div className="frosted space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="grid gap-3 sm:grid-cols-[auto_1fr_1.4fr] sm:items-center">
                    <Label>Widget</Label>
                    <div className="sm:col-span-2 text-sm text-white/70">
                      Click cell preview above to edit.
                    </div>
                    <Select
                      value={normalizeWidgetChoice(
                        selectedSection?.widgetType,
                        )}
                        onValueChange={(value) =>
                          updateSelectedSection({ widgetType: value })}
                      >
                        <SelectTrigger
                          className={sections.length > 1 ? "" : "sm:col-span-2"}
                        >
                          <SelectValue placeholder="Select widget" />
                        </SelectTrigger>
                        <SelectContent>
                          {widgetOptions.map((widget) => (
                            <SelectItem key={widget.value} value={widget.value}>
                              {widget.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-rows-[1fr] transition-[grid-template-rows] duration-250 ease-out">
                      <div className="min-h-0 overflow-hidden">
                        <div className="flex max-w-full snap-x gap-2 overflow-x-auto overscroll-x-contain pb-2">
                          {widgetOptions.map((widget) => (
                            <button
                              key={widget.value}
                              type="button"
                              onClick={() =>
                                updateSelectedSection({
                                  widgetType: widget.value,
                                })}
                              className={`shrink-0 snap-start rounded-full border px-3 py-1.5 text-sm transition ${
                                normalizeWidgetChoice(
                                    selectedSection?.widgetType,
                                  ) === widget.value
                                  ? "border-primary bg-primary/20 text-white"
                                  : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                              }`}
                            >
                              {widget.label}
                            </button>
                          ))}
                        </div>
                        <div className="flex max-w-full snap-x gap-3 overflow-x-auto overscroll-x-contain pb-2">
                          {widgetOptions.map((widget) => (
                            <button
                              key={widget.value}
                              type="button"
                              onClick={() =>
                                updateSelectedSection({
                                  widgetType: widget.value,
                                })}
                              className={`w-56 shrink-0 snap-start rounded-xl p-2 text-center transition ${
                                normalizeWidgetChoice(
                                    selectedSection?.widgetType,
                                  ) === widget.value
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
                              <span className="block truncate text-sm text-white/80">
                                {widget.label}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                  {selectedSection?.widgetType === "glanceable-clock" &&
                    glanceableOptions.length > 0 && (
                    <div className="space-y-2">
                      <Label>Glanceables</Label>
                      <div className="grid grid-cols-2 gap-3">
                        {(["left", "right"] as const).map((side) => (
                          <Select
                            key={side}
                            value={String(
                              selectedSection?.params?.glanceables?.[side] ??
                                "",
                            )}
                            onValueChange={(value) =>
                              updateSelectedSection({
                                params: {
                                  ...(selectedSection?.params ?? {}),
                                  glanceables: {
                                    ...(selectedSection?.params?.glanceables ??
                                      {}),
                                    [side]: value,
                                  },
                                },
                              })}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder={`${side} glanceable`} />
                            </SelectTrigger>
                            <SelectContent>
                              {glanceableOptions.map((item) => (
                                <SelectItem key={item.value} value={item.value}>
                                  {item.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedSection?.widgetType === "weather" && (
                    <LocationSelectFormComponent
                      value={{
                        displayName: String(
                          selectedSection?.params?.displayName ?? "",
                        ),
                        coordinates: [
                          selectedSection?.params?.lat,
                          selectedSection?.params?.lon,
                        ].filter(Boolean).join(", "),
                      }}
                      onChange={(value) => {
                        const [lat = "", lon = ""] = value.coordinates.split(
                          ",",
                        ).map((part) => part.trim());
                        updateSelectedSection({
                          params: {
                            ...(selectedSection?.params ?? {}),
                            lat,
                            lon,
                            displayName: value.displayName,
                          },
                        });
                      }}
                    />
                  )}
                  <WidgetPropertiesForm
                    idPrefix={`frame-widget-${selectedSection?.id ?? "cell"}`}
                    schema={widgetSchemas[selectedSection?.widgetType ?? ""] ??
                      {}}
                    value={selectedSection?.params ?? {}}
                    onChange={(params) => updateSelectedSection({ params })}
                    onError={setWidgetParamsError}
                    error={widgetParamsError}
                  />
                </TabsContent>
              </Tabs>

              <div className="frosted space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">Page Background</h2>
                </div>
                <RadioGroup
                  value={draftBackgroundMode}
                  onValueChange={(value) =>
                    setDraftBackgroundMode(value as BackgroundMode)}
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
                      onChange={(event) =>
                        setUploadFile(event.target.files?.[0] ?? null)}
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
                      onChange={(event) =>
                        setDraftBackgroundUrl(event.target.value)}
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
                      onValueChange={([value]) => setBrightnessPercent(value)}
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
                      onValueChange={([value]) => setBlurPercent(value)}
                    />
                  </div>
                )}
              </div>

              {error && <div className="text-sm text-red-400">{error}</div>}
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => handleDialogChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveFrame} disabled={uploading}>
                {uploading
                  ? "Saving..."
                  : editFrameId
                  ? "Save Changes"
                  : "Add Frame"}
              </Button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
