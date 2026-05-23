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
import useAuth from "@/context/useAuth";
import { uploadWallpaperAction } from "@/app/actions/wallpapers";
import { renderWidget } from "../widgets/Widget";

const WIDGET_OPTIONS = [
  "main-clock",
  "search-bar",
  "calendar-week",
  "link-view",
  "monitoring",
];

type Frame = {
  id: string;
  type: string;
  params?: Record<string, any>;
};

type BackgroundMode = "current" | "none" | "upload" | "url";

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
  const [showWidgetParams, setShowWidgetParams] = useState(false);
  const [draftWidgetParamsText, setDraftWidgetParamsText] = useState("");
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
    setShowWidgetParams(false);
    setDraftWidgetParamsText("");
    setWidgetParamsError(null);
    setError(null);
  };

  const handleOpenAdd = () => {
    resetDraft();
    const fallbackFilters = user?.appearancePreferences?.wallpaperFilters;
    const brightness = typeof fallbackFilters?.brightness === "number"
      ? fallbackFilters.brightness
      : 85;
    const blur = typeof fallbackFilters?.blur === "number" ? fallbackFilters.blur : 3;
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
    delete editableParams.backgroundImageUrl;
    delete editableParams.backgroundSource;
    delete editableParams.backgroundFilters;
    const paramsText = Object.keys(editableParams).length
      ? JSON.stringify(editableParams, null, 2)
      : "";
    const fallbackFilters = user?.appearancePreferences?.wallpaperFilters;
    const filters = frame.params?.backgroundFilters as Record<string, any> | undefined;
    const brightness = typeof filters?.brightness === "number"
      ? filters.brightness
      : typeof fallbackFilters?.brightness === "number"
        ? fallbackFilters.brightness
        : 85;
    const blur = typeof filters?.blur === "number"
      ? filters.blur
      : typeof fallbackFilters?.blur === "number"
        ? fallbackFilters.blur
        : 3;

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
    setShowWidgetParams(false);
    setDraftWidgetParamsText(paramsText);
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

    let parsedWidgetParams: Record<string, any> = {};
    if (draftWidgetParamsText.trim()) {
      try {
        const parsed = JSON.parse(draftWidgetParamsText);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setWidgetParamsError("Widget properties must be a JSON object.");
          return;
        }
        parsedWidgetParams = parsed as Record<string, any>;
      } catch (err) {
        console.error(err);
        setWidgetParamsError("Widget properties must be valid JSON.");
        return;
      }
    }

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

    const nextParams = { ...parsedWidgetParams } as Record<string, any>;

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
      type: draftType,
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
        Add Smart Frame
      </Button>

      <Dialog open={dialogOpen} onOpenChange={handleDialogChange}>
        <DialogContent className="frosted text-foreground">
          <DialogHeader>
            <DialogTitle>
              {editFrameId ? "Edit Smart Frame" : "Add Smart Frame"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Widget</Label>
              <Select value={draftType} onValueChange={setDraftType}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a widget" />
                </SelectTrigger>
                <SelectContent>
                  {WIDGET_OPTIONS.map((widget) => (
                    <SelectItem
                      key={widget}
                      value={widget}
                      className="capitalize"
                    >
                      {widget.replace(/-/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                className="px-0 text-sm text-white/70 hover:text-white"
                onClick={() => setShowWidgetParams((prev) => !prev)}
              >
                {showWidgetParams
                  ? "Hide widget properties"
                  : "Edit widget properties"}
              </Button>
              {showWidgetParams && (
                <div className="space-y-2">
                  <Label htmlFor="frame-widget-params">
                    Widget properties (JSON)
                  </Label>
                  <Textarea
                    id="frame-widget-params"
                    value={draftWidgetParamsText}
                    onChange={(event) =>
                      setDraftWidgetParamsText(event.target.value)}
                    placeholder='{"title":"My Widget"}'
                    rows={6}
                    spellCheck={false}
                    className="font-mono text-sm"
                  />
                  {widgetParamsError && (
                    <p className="text-sm text-red-400">{widgetParamsError}</p>
                  )}
                </div>
              )}
            </div>

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
