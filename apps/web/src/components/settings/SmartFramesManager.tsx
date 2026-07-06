"use client";

import { useEffect, useState } from "react";
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import useAuth from "@/context/useAuth";
import { getUserGlanceablesAction, getUserWidgetsAction, uploadWallpaperAction } from '@/lib/apiClient';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WidgetPickerCard } from "./pages/DashboardWidgetPreview";
import { normalizeWallpaperFilters } from "./wallpaperFilterDefaults";
import { renderWidget } from "../widgets/Widget";
import WidgetPropertiesForm from "@dashwise/integrationskit/forms/WidgetPropertiesForm";

const LOCAL_WIDGET_OPTIONS = [
  { value: "glanceable-clock", label: "Frame glanceable clock" },
  { value: "calendar-today", label: "Calendar today" },
  "calendar-week",
  { value: "calendar-upcoming", label: "Calendar upcoming" },
  "countdown",
  "rss-feed",
  "day-progress",
  "week-progress",
  "month-progress",
  "year-progress",
  "monitoring",
] as const;

const FRAME_LAYOUTS = [
  { value: "1x1", label: "1x1", cols: 1, rows: 1 },
  { value: "2x1", label: "2x1", cols: 2, rows: 1 },
  { value: "2x2", label: "2x2", cols: 2, rows: 2 },
  { value: "custom", label: "Custom", cols: 2, rows: 2 },
] as const;

const EXCLUDED_FRAME_WIDGETS = new Set(["search-bar", "link-view"]);

const LOCAL_WIDGET_SCHEMAS: Record<string, Record<string, any>> = {
  "calendar-today": { startMonday: true },
  "calendar-week": { startMonday: true },
  "calendar-upcoming": { maxEvents: 5 },
  countdown: { date: "", date_format: "yyyy-MM-dd", label: "Countdown" },
  "rss-feed": { feedId: "all", maxItems: 8, title: "Latest Articles" },
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
  const vertical = rows === 1 ? "" : row === 0 ? "top" : row === rows - 1 ? "bottom" : "middle";
  const horizontal = cols === 1 ? "" : col === 0 ? "left" : col === cols - 1 ? "right" : "middle";
  if (vertical === "middle" && horizontal === "middle") return "middle";
  return [vertical, horizontal].filter(Boolean).join(" ") || "cell";
}

function buildSections(cols: number, rows: number, current: FrameSection[] = []) {
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

function SortableFrame({
  frame,
  onRemove,
  onEdit,
}: {
  frame: Frame;
  onRemove: () => void;
  onEdit: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: frame.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative flex items-center gap-4 w-full border frosted rounded-xl overflow-hidden bg-black/20 p-3"
    >
      <div
        className="w-8 h-8 flex items-center justify-center cursor-grab active:cursor-grabbing bg-black/50 rounded-md text-white/80"
        {...attributes}
        {...listeners}
      >
        <GripHorizontal className="w-4 h-4" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium capitalize truncate">
          {frame.type.replace(/-/g, " ")}
        </p>
         </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 px-2"
          onClick={onEdit}
        >
          <Pencil className="w-4 h-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="h-8 px-2"
          onClick={onRemove}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editFrameId, setEditFrameId] = useState<string | null>(null);
  const [draftType, setDraftType] = useState("glanceable-clock");
  const [layoutPreset, setLayoutPreset] = useState("1x1");
  const [customCols, setCustomCols] = useState(2);
  const [customRows, setCustomRows] = useState(2);
  const [selectedSectionId, setSelectedSectionId] = useState("cell-0-0");
  const [sections, setSections] = useState<FrameSection[]>([]);
  const [widgetOptions, setWidgetOptions] = useState<Array<{ value: string; label: string }>>(
    LOCAL_WIDGET_OPTIONS.map((item) => typeof item === "string" ? { value: item, label: item.replace(/-/g, " ") } : item),
  );
  const [glanceableOptions, setGlanceableOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [widgetSchemas, setWidgetSchemas] = useState<Record<string, Record<string, any>>>({});
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

  const brightnessValue = Math.round((brightnessPercent / 100) * (150 - 50) + 50);
  const blurValue = Math.round((blurPercent / 100) * (25 - 1) + 1);
  const selectedLayout = FRAME_LAYOUTS.find((layout) => layout.value === layoutPreset) ?? FRAME_LAYOUTS[0];
  const layoutCols = layoutPreset === "custom" ? customCols : selectedLayout.cols;
  const layoutRows = layoutPreset === "custom" ? customRows : selectedLayout.rows;
  const selectedSection = sections.find((section) => section.id === selectedSectionId) ?? sections[0];

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = frames.findIndex((frame) => frame.id === active.id);
      const newIndex = frames.findIndex((frame) => frame.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        onChange(arrayMove(frames, oldIndex, newIndex));
      }
    }
  };

  const handleRemoveFrame = (id: string) => {
    onChange(frames.filter((frame) => frame.id !== id));
  };

  const updateSelectedSection = (patch: Partial<FrameSection>) => {
    setSections((current) => current.map((section) => section.id === selectedSectionId ? { ...section, ...patch } : section));
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

      const integrationWidgets = Object.entries((widgetsData ?? {}) as Record<string, any[]>).flatMap(([, widgets]) =>
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
      );

      const glanceables = (Array.isArray(glanceablesData) ? glanceablesData : []).map((glanceable: any) => ({
        value: String(glanceable.type ?? glanceable.key ?? ""),
        label: String(glanceable.name ?? glanceable.displayName ?? glanceable.type ?? glanceable.key ?? "Glanceable"),
      })).filter((glanceable) => glanceable.value);

      setWidgetOptions([...LOCAL_WIDGET_OPTIONS.map((item) => typeof item === "string" ? { value: item, label: item.replace(/-/g, " ") } : item).filter((item) => !EXCLUDED_FRAME_WIDGETS.has(item.value)), ...integrationWidgets]);
      setWidgetSchemas({
        ...LOCAL_WIDGET_SCHEMAS,
        ...Object.fromEntries(integrationWidgets.map((widget) => [widget.value, widget.schema])),
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
    const fallbackFilters = normalizeWallpaperFilters(user?.appearancePreferences?.wallpaperFilters);
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
    const layout = editableParams.layout && typeof editableParams.layout === "object"
      ? editableParams.layout as Record<string, any>
      : undefined;
    const cols = clampLayoutSize(Number(layout?.cols ?? 1));
    const rows = clampLayoutSize(Number(layout?.rows ?? 1));
    const preset = FRAME_LAYOUTS.some((item) => item.value === `${cols}x${rows}`) ? `${cols}x${rows}` : "custom";
    const nextSections = buildSections(cols, rows, Array.isArray(editableParams.sections) ? editableParams.sections : [{ id: "cell-0-0", widgetType: frame.type, params: editableParams }]);
    delete editableParams.backgroundImageUrl;
    delete editableParams.backgroundSource;
    delete editableParams.backgroundFilters;
    delete editableParams.layout;
    delete editableParams.sections;
    const fallbackFilters = normalizeWallpaperFilters(user?.appearancePreferences?.wallpaperFilters);
    const filters = frame.params?.backgroundFilters as Record<string, any> | undefined;
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
    const normalizedSections = buildSections(layoutCols, layoutRows, sections).map((section) => ({
      ...section,
      params: section.id === selectedSectionId ? selectedParams : section.params ?? {},
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
    }

    setDialogOpen(false);
    resetDraft();
  };

  return (
    <div className="space-y-4">
      <div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={frames.map((frame) => frame.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-3">
              {frames.map((frame) => (
                <SortableFrame
                  key={frame.id}
                  frame={frame}
                  onRemove={() => handleRemoveFrame(frame.id)}
                  onEdit={() => handleOpenEdit(frame)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full h-12 border-dashed border-white/20 frosted hover:bg-white/5"
        onClick={handleOpenAdd}
      >
        <Plus className="w-4 h-4 mr-2" />
        Add Frame
      </Button>

      <Dialog open={dialogOpen} onOpenChange={handleDialogChange}>
          <DialogContent className="frosted max-h-[90vh] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto overflow-x-hidden text-foreground">
          <DialogHeader>
            <DialogTitle>
              {editFrameId ? "Edit Frame" : "Add Frame"}
            </DialogTitle>
          </DialogHeader>

            <div className="min-w-0 space-y-4 overflow-hidden">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Label className="shrink-0">Layout</Label>
                <Select value={layoutPreset} onValueChange={setLayoutPreset}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FRAME_LAYOUTS.map((layout) => <SelectItem key={layout.value} value={layout.value}>{layout.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {layoutPreset === "custom" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>Columns</Label><Input type="number" min={1} max={4} value={customCols} onChange={(event) => setCustomCols(clampLayoutSize(Number(event.target.value)))} /></div>
                  <div className="space-y-2"><Label>Rows</Label><Input type="number" min={1} max={4} value={customRows} onChange={(event) => setCustomRows(clampLayoutSize(Number(event.target.value)))} /></div>
                </div>
              )}
              <div className="grid gap-2 rounded-xl border border-white/10 bg-black/20 p-2" style={{ gridTemplateColumns: `repeat(${layoutCols}, minmax(0, 1fr))` }}>
                {sections.map((section) => (
                  <button key={section.id} type="button" onClick={() => setSelectedSectionId(section.id)} className={`min-h-20 rounded-lg border p-2 text-sm capitalize transition ${selectedSectionId === section.id ? "border-primary bg-primary/20" : "border-white/10 bg-white/5 hover:bg-white/10"}`}>
                    {section.label}
                  </button>
                ))}
              </div>
            </div>

            <Tabs defaultValue="background" className="min-w-0 space-y-3 overflow-hidden">
              <TabsList className="w-full grid grid-cols-3">
                <TabsTrigger value="background">Frame background</TabsTrigger>
                <TabsTrigger value="style">Widget style</TabsTrigger>
                <TabsTrigger value="properties">Widget properties</TabsTrigger>
              </TabsList>

            <TabsContent value="background" className="space-y-3">
              <Label>Background</Label>
              <RadioGroup
                value={draftBackgroundMode}
                onValueChange={(value) =>
                  setDraftBackgroundMode(value as BackgroundMode)}
                className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(140px,1fr))]"
              >
                <div>
                  <RadioGroupItem
                    id="frame-bg-none"
                    value="none"
                    className="peer sr-only"
                  />
                  <Label
                    htmlFor="frame-bg-none"
                    className="group flex flex-col items-center justify-center rounded-xl outline outline-transparent outline-offset-2 p-3 text-center cursor-pointer frosted text-sm
                      peer-data-[state=checked]:outline-(--primary)
                      peer-focus-visible:outline peer-focus-visible:outline-(--primary) h-20"
                  >
                    None
                  </Label>
                </div>
                <div>
                  <RadioGroupItem
                    id="frame-bg-current"
                    value="current"
                    className="peer sr-only"
                  />
                  <Label
                    htmlFor="frame-bg-current"
                    className="group flex flex-col items-center justify-center rounded-xl outline outline-transparent outline-offset-2 p-3 text-center cursor-pointer frosted text-sm
                      peer-data-[state=checked]:outline-(--primary)
                      peer-focus-visible:outline peer-focus-visible:outline-(--primary) h-20"
                  >
                    Current
                  </Label>
                </div>
                <div>
                  <RadioGroupItem
                    id="frame-bg-upload"
                    value="upload"
                    className="peer sr-only"
                  />
                  <Label
                    htmlFor="frame-bg-upload"
                    className="group flex flex-col items-center justify-center rounded-xl outline outline-transparent p-3 text-center cursor-pointer frosted text-sm
                      peer-data-[state=checked]:outline-(--primary)
                      peer-focus-visible:outline peer-focus-visible:outline-(--primary) h-20"
                  >
                    Upload
                  </Label>
                </div>
                <div>
                  <RadioGroupItem
                    id="frame-bg-url"
                    value="url"
                    className="peer sr-only"
                  />
                  <Label
                    htmlFor="frame-bg-url"
                    className="group flex flex-col items-center justify-center rounded-xl outline outline-transparent p-3 text-center cursor-pointer frosted text-sm
                      peer-data-[state=checked]:outline-(--primary)
                      peer-focus-visible:outline peer-focus-visible:outline-(--primary) h-20"
                  >
                    Add from URL
                  </Label>
                </div>
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
                (draftBackgroundMode === "upload" && existingBackgroundUrl)) &&
                (
                  <div className="relative w-full h-40 rounded-md overflow-hidden border border-white/10">
                    <img
                      src={uploadPreview ||
                        (draftBackgroundMode === "url"
                          ? draftBackgroundUrl
                          : existingBackgroundUrl)}
                      alt="Background preview"
                      className="object-cover h-full w-full"
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
            </TabsContent>

            <TabsContent value="style" className="space-y-3">
              <p className="text-sm text-white/70">Widget style options coming here. Current section keeps dashboard default styling.</p>
            </TabsContent>

            <TabsContent value="properties" className="min-w-0 space-y-3 overflow-hidden">
              <Label>{selectedSection?.label ?? "Cell"} widget</Label>
              <WidgetPickerCard
                title="Select widget"
                compact
                selectedLabel={widgetOptions.find((widget) => widget.value === selectedSection?.widgetType)?.label ?? selectedSection?.widgetType}
              >
                <div className="flex max-w-full snap-x gap-3 overflow-x-auto overscroll-x-contain pb-2">
                  {widgetOptions.map((widget) => (
                    <button
                      key={widget.value}
                      type="button"
                      onClick={() => updateSelectedSection({ widgetType: widget.value })}
                      className={`w-56 shrink-0 snap-start rounded-xl p-2 text-center transition ${
                        selectedSection?.widgetType === widget.value
                          ? "bg-white/15 ring-1 ring-primary"
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
              </WidgetPickerCard>
              {selectedSection?.widgetType === "glanceable-clock" && glanceableOptions.length > 0 && (
                <div className="space-y-2">
                  <Label>Glanceables</Label>
                  <div className="grid grid-cols-2 gap-3">
                    {(["left", "right"] as const).map((side) => (
                      <Select key={side} value={String(selectedSection?.params?.glanceables?.[side] ?? "")} onValueChange={(value) => updateSelectedSection({ params: { ...(selectedSection?.params ?? {}), glanceables: { ...(selectedSection?.params?.glanceables ?? {}), [side]: value } } })}>
                        <SelectTrigger><SelectValue placeholder={`${side} glanceable`} /></SelectTrigger>
                        <SelectContent>{glanceableOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                      </Select>
                    ))}
                  </div>
                </div>
              )}
              <WidgetPropertiesForm
                idPrefix={`frame-widget-${selectedSection?.id ?? "cell"}`}
                schema={widgetSchemas[selectedSection?.widgetType ?? ""] ?? {}}
                value={selectedSection?.params ?? {}}
                onChange={(params) => updateSelectedSection({ params })}
                onError={setWidgetParamsError}
                error={widgetParamsError}
              />
            </TabsContent>
            </Tabs>

            {error && <div className="text-sm text-red-400">{error}</div>}
          </div>

          <DialogFooter>
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
