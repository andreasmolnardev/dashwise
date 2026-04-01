"use client";

import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Edit3, GripVertical, PanelLeftDashed, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { renderWidget } from "@/components/widgets/Widget";
import {
  ColumnName,
  ColumnWidget,
  TemplateId,
  WidgetCatalogItem,
  createWidgetId,
  hasEditableWidgetData,
  moveItem,
} from "./utils";

type DashboardWidgetPreviewProps = {
  template: TemplateId;
  columns: Record<ColumnName, ColumnWidget[]>;
  setColumns: Dispatch<SetStateAction<Record<ColumnName, ColumnWidget[]>>>;
  enabledColumns: ColumnName[];
  widgetCatalog: WidgetCatalogItem[];
  widgetCategories: string[];
  selectedWidgetCategory: string;
  setSelectedWidgetCategory: (category: string) => void;
};

function WidgetTile({
  widget,
  onRemove,
  onUpdateData,
}: {
  widget: ColumnWidget;
  onRemove: () => void;
  onUpdateData: (widgetId: string, data?: ColumnWidget["data"]) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
  });
  const [isDataDialogOpen, setIsDataDialogOpen] = useState(false);
  const [sourceValue, setSourceValue] = useState(widget.data?.source ?? "");
  const [inputValue, setInputValue] = useState(JSON.stringify(widget.data?.input ?? {}, null, 2));
  const [dataError, setDataError] = useState<string | null>(null);

  useEffect(() => {
    if (isDataDialogOpen) {
      return;
    }

    setSourceValue(widget.data?.source ?? "");
    setInputValue(JSON.stringify(widget.data?.input ?? {}, null, 2));
    setDataError(null);
  }, [isDataDialogOpen, widget.data?.input, widget.data?.source]);

  const handleSaveData = () => {
    setDataError(null);

    let parsedInput: Record<string, any> = {};
    const trimmedInput = inputValue.trim();
    if (trimmedInput) {
      try {
        const parsed = JSON.parse(trimmedInput);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setDataError("Input must be a JSON object.");
          return;
        }
        parsedInput = parsed as Record<string, any>;
      } catch {
        setDataError("Input must be valid JSON.");
        return;
      }
    }

    const nextData = {
      source: sourceValue.trim() || undefined,
      input: parsedInput,
    };

    onUpdateData(widget.id, nextData.source || Object.keys(nextData.input).length > 0 ? nextData : undefined);
    setIsDataDialogOpen(false);
  };

  const canEditData = hasEditableWidgetData(widget);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`frosted rounded-md border p-2 ${isDragging ? "opacity-50" : "opacity-100"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{widget.type}</p>
        </div>
        <div className="flex items-center gap-1">
          {canEditData ? (
            <Dialog open={isDataDialogOpen} onOpenChange={setIsDataDialogOpen}>
              <DialogTrigger asChild>
                <button
                  type="button"
                  aria-label={`Edit data for ${widget.type}`}
                  className="rounded p-1 hover:bg-white/10"
                >
                  <Edit3 className="h-4 w-4" />
                </button>
              </DialogTrigger>
              <DialogContent className="frosted">
                <DialogHeader>
                  <DialogTitle>Edit Widget Data</DialogTitle>
                  <DialogDescription>
                    Customize the per-widget source and input payload used by the preview and saved page config.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor={`widget-data-source-${widget.id}`}>Source</Label>
                    <Input
                      id={`widget-data-source-${widget.id}`}
                      value={sourceValue}
                      onChange={(event) => setSourceValue(event.target.value)}
                      placeholder="computed.weather"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`widget-data-input-${widget.id}`}>Input JSON</Label>
                    <textarea
                      id={`widget-data-input-${widget.id}`}
                      value={inputValue}
                      onChange={(event) => setInputValue(event.target.value)}
                      className="min-h-40 w-full rounded-md border border-white/15 bg-black/20 p-3 text-sm outline-none"
                      spellCheck={false}
                    />
                  </div>

                  {dataError ? <p className="text-sm text-red-400">{dataError}</p> : null}
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsDataDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={handleSaveData}>
                    Save data
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null}
          <button
            type="button"
            aria-label={`Drag ${widget.type}`}
            className="rounded p-1 hover:bg-white/10"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${widget.type}`}
            className="rounded p-1 hover:bg-white/10"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ColumnDropZone({
  id,
  children,
  disabled,
}: {
  id: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id,
    disabled,
  });

  return (
    <div className={`p-1 ${disabled ? "opacity-50" : ""}`}>
      <div
        ref={setNodeRef}
        className={`min-h-24 space-y-2 rounded-md border border-dashed p-2 ${
          isOver ? "border-blue-400/80 bg-blue-500/10" : "border-white/20"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function LibraryItem({ item }: { item: WidgetCatalogItem }) {
  const draggableId = `library:${item.category}:${item.slug}`;
  const { setNodeRef, listeners, attributes, isDragging } = useSortable({
    id: draggableId,
  });

  const previewParams = item.preview.properties ?? item.properties ?? {};
  const mergedPreviewParams = item.data
    ? {
        ...previewParams,
        data: item.data,
      }
    : previewParams;
  const isIntegrationPreview = item.category.startsWith("integration-");
  const previewTemplate = isIntegrationPreview ? item.preview.template : undefined;

  return (
    <div
      className={`rounded-xl ${isDragging ? "opacity-40" : "opacity-100"}`}
      ref={setNodeRef}
      {...listeners}
      {...attributes}
    >
      {renderWidget({
        type: item.slug,
        params: mergedPreviewParams,
        className: "h-[110px] w-full",
        isPreview: isIntegrationPreview,
        previewTemplate,
      })}
    </div>
  );
}

export function DashboardWidgetPreview({
  template,
  columns,
  setColumns,
  enabledColumns,
  widgetCatalog,
  widgetCategories,
  selectedWidgetCategory,
  setSelectedWidgetCategory,
}: DashboardWidgetPreviewProps) {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [lastOverId, setLastOverId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const filteredWidgetCatalog = useMemo(() => {
    if (!selectedWidgetCategory) {
      return widgetCatalog;
    }

    return widgetCatalog.filter((item) => item.category === selectedWidgetCategory);
  }, [selectedWidgetCategory, widgetCatalog]);

  const removeWidget = (column: ColumnName, widgetId: string) => {
    setColumns((prev) => ({
      ...prev,
      [column]: prev[column].filter((item) => item.id !== widgetId),
    }));
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
    setLastOverId(null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const activeId = String(event.active.id);
    if (activeId.startsWith("library:")) return;
    if (!event.over) return;

    const overId = String(event.over.id);
    if (overId !== activeId) {
      setLastOverId(overId);
    }

    const findColumn = (id: string): ColumnName | null => {
      if (id.startsWith("column:")) {
        const column = id.split(":")[1];
        if (column === "left" || column === "middle" || column === "right") {
          return column as ColumnName;
        }
      }

      for (const column of Object.keys(columns) as ColumnName[]) {
        if (columns[column].some((item) => item.id === id)) return column;
      }

      return null;
    };

    const activeColumn = findColumn(activeId);
    const overColumn = findColumn(overId);

    if (!activeColumn || !overColumn) return;
    if (activeColumn === overColumn) return;
    if (!enabledColumns.includes(overColumn)) return;

    setColumns((prev) => moveItem(prev, activeId, overId, overColumn));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);

    const activeId = String(event.active.id);
    const eventOverId = event.over ? String(event.over.id) : null;
    const overId = eventOverId && eventOverId !== activeId ? eventOverId : lastOverId;
    setLastOverId(null);

    if (!overId) return;

    const parseOverColumn = (id: string): ColumnName | null => {
      if (id.startsWith("column:")) {
        const column = id.split(":")[1];
        if (column === "left" || column === "middle" || column === "right") {
          return column as ColumnName;
        }
      }

      for (const column of Object.keys(columns) as ColumnName[]) {
        if (columns[column].some((item) => item.id === id)) return column;
      }

      return null;
    };

    const overColumn = parseOverColumn(overId);
    if (!overColumn || !enabledColumns.includes(overColumn)) return;

    if (activeId.startsWith("library:")) {
      const [, category, ...rest] = activeId.split(":");
      const slug = rest.join(":");
      if (!slug || !category) return;

      const source = widgetCatalog.find((item) => item.category === category && item.slug === slug);
      if (!source) return;

      const nextWidget: ColumnWidget = {
        id: createWidgetId(),
        type: slug,
        properties: source.properties ?? {},
        data: source.data ?? undefined,
      };

      setColumns((prev) => {
        const copy: Record<ColumnName, ColumnWidget[]> = {
          left: [...prev.left],
          middle: [...prev.middle],
          right: [...prev.right],
        };

        const overIndex = copy[overColumn].findIndex((item) => item.id === overId);

        if (overIndex >= 0) {
          copy[overColumn].splice(overIndex, 0, nextWidget);
        } else {
          copy[overColumn].push(nextWidget);
        }

        return copy;
      });
      return;
    }

    setColumns((prev) => moveItem(prev, activeId, overId, overColumn));
  };

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Widgets</h2>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="space-y-4">
          <div className="relative overflow-hidden rounded-lg p-4 frosted">
            <div
              className={`grid gap-0 ${
                template === "left-middle"
                  ? "grid-cols-[1fr_2fr]"
                  : "grid-cols-[1fr_2fr_1fr]"
              }`}
            >
              {(["left", "middle", "right"] as ColumnName[])
                .filter((column) => enabledColumns.includes(column))
                .map((column) => {
                  const isMiddle = column === "middle";

                  return (
                    <div
                      key={column}
                      className={`min-h-[260px] border-white/20 p-3 ${
                        !isMiddle ? "border-r" : template === "main" ? "border-r" : ""
                      }`}
                    >
                      <ColumnDropZone
                        id={`column:${column}`}
                        disabled={columns[column].length > 0}
                      >
                        <SortableContext
                          items={columns[column].map((item) => item.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          {columns[column].map((widget) => (
                            <WidgetTile
                              key={widget.id}
                              widget={widget}
                              onRemove={() => removeWidget(column, widget.id)}
                              onUpdateData={(widgetId, data) => {
                                setColumns((prev) => ({
                                  ...prev,
                                  [column]: prev[column].map((item) =>
                                    item.id === widgetId ? { ...item, data } : item,
                                  ),
                                }));
                              }}
                            />
                          ))}
                        </SortableContext>
                      </ColumnDropZone>
                    </div>
                  );
                })}
            </div>
            <div className="mt-3 flex items-start justify-center gap-2 text-xs text-white/50">
              <PanelLeftDashed className="h-3.5 w-3.5" />
              dashwise
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Add a widget</h3>
              <p className="text-xs text-white/70">Drag&apos;n&apos;drop a widget into the desired column</p>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {widgetCategories.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => setSelectedWidgetCategory(category)}
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

            <SortableContext
              items={filteredWidgetCatalog.map((item) => `library:${item.category}:${item.slug}`)}
              strategy={verticalListSortingStrategy}
            >
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filteredWidgetCatalog.map((item) => (
                  <div key={`${item.category}:${item.slug}`} className="space-y-2 border-transparent">
                    <LibraryItem item={item} />
                    <p className="text-center text-xs text-white/70">{item.name}</p>
                  </div>
                ))}
              </div>
            </SortableContext>
          </div>
        </div>
      </DndContext>

      {activeDragId ? <p className="text-xs text-white/60">Dragging: {activeDragId}</p> : null}
    </div>
  );
}