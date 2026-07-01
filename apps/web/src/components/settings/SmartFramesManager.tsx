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
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import useAuth from "@/context/useAuth";
import { uploadWallpaperAction } from '@/lib/apiClient';
import { normalizeWallpaperFilters } from "./wallpaperFilterDefaults";

const WIDGET_OPTIONS = [
  "main-clock",
  "search-bar",
  "calendar-week",
  "countdown",
  "link-view",
  "monitoring",
];

const GRID_PRESETS = [
  { value: "1x1", label: "1x1", rows: 1, columns: 1 },
  { value: "2x1", label: "2x1", rows: 1, columns: 2 },
  { value: "2x2", label: "2x2", rows: 2, columns: 2 },
  { value: "3x1", label: "3x1", rows: 1, columns: 3 },
  { value: "custom", label: "Custom", rows: 1, columns: 1 },
];

type GridPreset = (typeof GRID_PRESETS)[number]["value"];

type LayoutCellDraft = {
  id: string;
  name: string;
  widget: string;
  paramsText: string;
};

type Frame = {
  id: string;
  type: string;
  params?: Record<string, any>;
};

type BackgroundMode = "current" | "none" | "upload" | "url";

function getCellName(row: number, column: number, rows: number, columns: number) {
  const vertical = rows === 1
    ? "middle"
    : row === 0
    ? "top"
    : row === rows - 1
    ? "bottom"
    : "middle";
  const horizontal = columns === 1
    ? "center"
    : column === 0
    ? "left"
    : column === columns - 1
    ? "right"
    : "center";

  return rows === 1 && columns === 1 ? "middle" : `${vertical} ${horizontal}`;
}

function buildCells(
  rows: number,
  columns: number,
  existingCells: Partial<LayoutCellDraft>[] = [],
) {
  return Array.from({ length: rows * columns }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const existing = existingCells[index];
    return {
      id: `${row}-${column}`,
      name: getCellName(row, column, rows, columns),
      widget: existing?.widget || WIDGET_OPTIONS[0],
      paramsText: existing?.paramsText || "",
    };
  });
}

function stripLayoutAndBackgroundParams(params?: Record<string, any>) {
  const nextParams = { ...(params ?? {}) };
  delete nextParams.backgroundImageUrl;
  delete nextParams.backgroundSource;
  delete nextParams.backgroundFilters;
  delete nextParams.layoutGrid;
  return nextParams;
}

function parseParamsText(paramsText: string) {
  if (!paramsText.trim()) return {};
  const parsed = JSON.parse(paramsText);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Widget properties must be a JSON object.");
  }
  return parsed as Record<string, any>;
}

function WidgetPropertiesEditor({
  cell,
  onChange,
}: {
  cell: LayoutCellDraft;
  onChange: (paramsText: string) => void;
}) {
  let parsedParams: Record<string, any> | null = null;
  let parseError = false;

  try {
    parsedParams = parseParamsText(cell.paramsText);
  } catch {
    parseError = true;
  }

  const updateParam = (key: string, value: any) => {
    const nextParams = { ...(parsedParams ?? {}), [key]: value };
    onChange(JSON.stringify(nextParams, null, 2));
  };

  const entries = Object.entries(parsedParams ?? {});

  return (
    <Tabs defaultValue="form" className="space-y-3">
      <TabsList className="grid w-full grid-cols-2 bg-black/30">
        <TabsTrigger value="form">Form</TabsTrigger>
        <TabsTrigger value="json">JSON</TabsTrigger>
      </TabsList>

      <TabsContent value="form" className="space-y-3">
        {parseError ? (
          <p className="text-sm text-red-400">Fix invalid JSON before using the form editor.</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-white/60">No properties yet. Add keys in the JSON tab.</p>
        ) : (
          entries.map(([key, value]) => {
            const inputId = `frame-cell-param-${cell.id}-${key}`;
            if (typeof value === "boolean") {
              return (
                <label key={key} htmlFor={inputId} className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/20 px-3 py-2">
                  <span className="text-sm text-white">{key}</span>
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={value}
                    onChange={(event) => updateParam(key, event.target.checked)}
                    className="h-4 w-4 accent-white"
                  />
                </label>
              );
            }

            if (typeof value === "number" && Number.isFinite(value)) {
              return (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={inputId}>{key}</Label>
                  <Input
                    id={inputId}
                    type="number"
                    value={value}
                    onChange={(event) =>
                      updateParam(key, event.target.value === "" ? null : Number(event.target.value))}
                  />
                </div>
              );
            }

            if (typeof value === "string" || value === null || value === undefined) {
              return (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={inputId}>{key}</Label>
                  <Input
                    id={inputId}
                    value={value ?? ""}
                    onChange={(event) => updateParam(key, event.target.value)}
                  />
                </div>
              );
            }

            return (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={inputId}>{key}</Label>
                <Textarea
                  id={inputId}
                  value={JSON.stringify(value, null, 2)}
                  onChange={(event) => {
                    try {
                      updateParam(key, JSON.parse(event.target.value));
                    } catch {
                      onChange(cell.paramsText);
                    }
                  }}
                  rows={4}
                  spellCheck={false}
                  className="font-mono text-sm"
                />
              </div>
            );
          })
        )}
      </TabsContent>

      <TabsContent value="json" className="space-y-2">
        <Textarea
          id={`frame-cell-params-${cell.id}`}
          value={cell.paramsText}
          onChange={(event) => onChange(event.target.value)}
          placeholder='{"title":"My Widget"}'
          rows={5}
          spellCheck={false}
          className="font-mono text-sm"
        />
      </TabsContent>
    </Tabs>
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
  const [draftType, setDraftType] = useState(WIDGET_OPTIONS[0]);
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
  const [draftGridPreset, setDraftGridPreset] = useState<GridPreset>("1x1");
  const [draftGridRows, setDraftGridRows] = useState(1);
  const [draftGridColumns, setDraftGridColumns] = useState(1);
  const [draftCells, setDraftCells] = useState<LayoutCellDraft[]>(() =>
    buildCells(1, 1)
  );
  const [widgetParamsError, setWidgetParamsError] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const brightnessValue = Math.round((brightnessPercent / 100) * (150 - 50) + 50);
  const blurValue = Math.round((blurPercent / 100) * (25 - 1) + 1);

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

  useEffect(() => {
    if (!uploadFile) {
      setUploadPreview(null);
      return;
    }

    const url = URL.createObjectURL(uploadFile);
    setUploadPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [uploadFile]);

  const resetDraft = () => {
    setEditFrameId(null);
    setDraftType(WIDGET_OPTIONS[0]);
    setDraftBackgroundMode("current");
    setDraftBackgroundUrl("");
    setExistingBackgroundUrl("");
    setUploadFile(null);
    setUploadPreview(null);
    setUploading(false);
    setBrightnessPercent(35);
    setBlurPercent(8);
    setDraftGridPreset("1x1");
    setDraftGridRows(1);
    setDraftGridColumns(1);
    setDraftCells(buildCells(1, 1));
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
    const fallbackFilters = normalizeWallpaperFilters(user?.appearancePreferences?.wallpaperFilters);
    const filters = frame.params?.backgroundFilters as Record<string, any> | undefined;
    const brightness = typeof filters?.brightness === "number"
      ? filters.brightness
      : fallbackFilters.brightness;
    const blur = typeof filters?.blur === "number"
      ? filters.blur
      : fallbackFilters.blur;
    const layoutGrid = frame.params?.layoutGrid as Record<string, any> | undefined;
    const layoutRows = Number(layoutGrid?.rows) || 1;
    const layoutColumns = Number(layoutGrid?.columns) || 1;
    const matchedPreset = GRID_PRESETS.find((preset) =>
      preset.value !== "custom" &&
      preset.rows === layoutRows &&
      preset.columns === layoutColumns
    );
    const legacyWidgetParams = stripLayoutAndBackgroundParams(frame.params);
    const layoutCells = Array.isArray(layoutGrid?.cells)
      ? layoutGrid.cells.map((cell: any, index: number) => ({
        id: String(cell?.id ?? index),
        name: String(cell?.name ?? ""),
        widget: String(cell?.widget ?? WIDGET_OPTIONS[0]),
        paramsText: cell?.params && typeof cell.params === "object"
          ? JSON.stringify(cell.params, null, 2)
          : Object.keys(legacyWidgetParams).length
          ? JSON.stringify(legacyWidgetParams, null, 2)
          : "",
      }))
      : buildCells(layoutRows, layoutColumns, [
        {
          id: "0-0",
          widget: frame.type,
          paramsText: Object.keys(legacyWidgetParams).length
            ? JSON.stringify(legacyWidgetParams, null, 2)
            : "",
        },
      ]);

    setEditFrameId(frame.id);
    setDraftType(frame.type);
    setDraftBackgroundMode(inferredMode);
    setDraftBackgroundUrl(backgroundImageUrl);
    setExistingBackgroundUrl(backgroundImageUrl);
    setUploadFile(null);
    setUploadPreview(null);
    setUploading(false);
    setBrightnessPercent(Math.round(((brightness - 50) / (150 - 50)) * 100));
    setBlurPercent(Math.round(((blur - 1) / (25 - 1)) * 100));
    setDraftGridPreset(matchedPreset?.value ?? "custom");
    setDraftGridRows(layoutRows);
    setDraftGridColumns(layoutColumns);
    setDraftCells(buildCells(layoutRows, layoutColumns, layoutCells));
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

    let parsedCells: Array<Record<string, any>>;
    try {
      parsedCells = draftCells.map((cell) => {
        let parsedParams: Record<string, any> | undefined;
        if (cell.paramsText.trim()) {
          parsedParams = parseParamsText(cell.paramsText);
        }

        return {
          id: cell.id,
          name: cell.name.trim() || cell.id,
          widget: cell.widget,
          ...(parsedParams ? { params: parsedParams } : {}),
        };
      });
    } catch (err) {
      console.error(err);
      setWidgetParamsError("Each widget properties block must be valid JSON.");
      return;
    }

    nextParams.layoutGrid = {
      rows: draftGridRows,
      columns: draftGridColumns,
      cells: parsedCells,
    };

    const nextFrame: Frame = {
      id: existingFrame?.id ??
        `frame-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type: draftCells[0]?.widget ?? draftType,
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

  const handleGridPresetChange = (value: string) => {
    const preset = GRID_PRESETS.find((item) => item.value === value) ?? GRID_PRESETS[0];
    setDraftGridPreset(preset.value);
    if (preset.value !== "custom") {
      setDraftGridRows(preset.rows);
      setDraftGridColumns(preset.columns);
      setDraftCells((cells) => buildCells(preset.rows, preset.columns, cells));
    }
  };

  const handleCustomGridSizeChange = (field: "rows" | "columns", value: string) => {
    const nextValue = Math.min(4, Math.max(1, Number(value) || 1));
    const nextRows = field === "rows" ? nextValue : draftGridRows;
    const nextColumns = field === "columns" ? nextValue : draftGridColumns;
    setDraftGridRows(nextRows);
    setDraftGridColumns(nextColumns);
    setDraftCells((cells) => buildCells(nextRows, nextColumns, cells));
  };

  const updateCell = (index: number, updates: Partial<LayoutCellDraft>) => {
    setDraftCells((cells) =>
      cells.map((cell, cellIndex) =>
        cellIndex === index ? { ...cell, ...updates } : cell
      )
    );
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
        Add Smart Frame
      </Button>

      <Dialog open={dialogOpen} onOpenChange={handleDialogChange}>
        <DialogContent className="frosted text-foreground">
          <DialogHeader>
            <DialogTitle>
              {editFrameId ? "Edit Smart Frame" : "Add Smart Frame"}
            </DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="widgets" className="space-y-4">
            <TabsList className="grid w-full grid-cols-2 bg-black/30">
              <TabsTrigger value="background">Background</TabsTrigger>
              <TabsTrigger value="widgets">Widgets</TabsTrigger>
            </TabsList>

            <TabsContent value="widgets" className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Label className="whitespace-nowrap w-full">Layout grid</Label>
                <Select value={draftGridPreset} onValueChange={handleGridPresetChange}>
                  <SelectTrigger className="w-min">
                    <SelectValue placeholder="Select a grid" />
                  </SelectTrigger>
                  <SelectContent>
                    {GRID_PRESETS.map((preset) => (
                      <SelectItem key={preset.value} value={preset.value} className="whitespace-nowrap">
                        {preset.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {draftGridPreset === "custom" && (
                <div className="grid grid-cols-2 gap-1">
                    <Label htmlFor="frame-grid-rows">Rows</Label>
                    <Input
                      id="frame-grid-rows"
                      type="number"
                      min={1}
                      max={4}
                      value={draftGridRows}
                      onChange={(event) =>
                        handleCustomGridSizeChange("rows", event.target.value)}
                    />
                    <Label htmlFor="frame-grid-columns">Columns</Label>
                    <Input
                      id="frame-grid-columns"
                      type="number"
                      min={1}
                      max={4}
                      value={draftGridColumns}
                      onChange={(event) =>
                        handleCustomGridSizeChange("columns", event.target.value)}
                    />
                  </div>
              )}

              <div className="space-y-3">
                {draftCells.map((cell, index) => (
                  <div key={cell.id} className="space-y-3 rounded-xl">
                    <div className="text-sm font-medium capitalize text-white/80">
                      {cell.name}
                    </div>
                    <div className="space-y-2">
                      <Label>Widget</Label>
                      <Select
                        value={cell.widget}
                        onValueChange={(value) => updateCell(index, { widget: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Widget" />
                        </SelectTrigger>
                        <SelectContent>
                          {WIDGET_OPTIONS.map((widget) => (
                            <SelectItem key={widget} value={widget} className="capitalize">
                              {widget.replace(/-/g, " ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Widget properties</Label>
                      <WidgetPropertiesEditor
                        cell={cell}
                        onChange={(paramsText) => updateCell(index, { paramsText })}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {widgetParamsError && (
                <p className="text-sm text-red-400">{widgetParamsError}</p>
              )}
            </div>

            </TabsContent>

            <TabsContent value="background" className="space-y-4">

            <div className="space-y-3">
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
            </div>

            </TabsContent>

            {error && <div className="text-sm text-red-400">{error}</div>}
          </Tabs>

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
