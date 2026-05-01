"use client";

import { useEffect, useMemo, useState, useCallback, type Dispatch, type ReactNode, type SetStateAction } from "react";
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Edit3, GripVertical, PanelLeftDashed, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  onPersistColumns?: (nextColumns: Record<ColumnName, ColumnWidget[]>) => void | Promise<void>;
  enabledColumns: ColumnName[];
  widgetCatalog: WidgetCatalogItem[];
  widgetCategories: string[];
  selectedWidgetCategory: string;
  setSelectedWidgetCategory: (category: string) => void;
};

function WidgetTile({
  columnWidget,
  widgetConfig,
  onRemove,
  onUpdateInput,
  isActive,
}: {
  columnWidget: ColumnWidget;
  widgetConfig?: WidgetCatalogItem;
  onRemove: () => void;
  onUpdateInput: (widgetId: string, input?: ColumnWidget["input"]) => void;
  isActive?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: columnWidget.id,
  });
  const [isDataDialogOpen, setIsDataDialogOpen] = useState(false);
  const [inputValue, setInputValue] = useState(JSON.stringify(columnWidget.input ?? {}, null, 2));
  const [dataError, setDataError] = useState<string | null>(null);

  useEffect(() => {
    if (isDataDialogOpen) return;
    setInputValue(JSON.stringify(columnWidget.input ?? {}, null, 2));
    setDataError(null);
  }, [isDataDialogOpen, columnWidget.input]);

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
    onUpdateInput(columnWidget.id, Object.keys(parsedInput).length > 0 ? parsedInput : undefined);
    setIsDataDialogOpen(false);
  };

  const canEditData = hasEditableWidgetData(columnWidget, widgetConfig);
  const params = {
    ...(widgetConfig?.properties ?? {}),
    ...(columnWidget.input ?? {}),
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative rounded-lg overflow-hidden ${isDragging ? "opacity-40" : "opacity-100"}`}
    >
      {/* Actual widget preview */}
      {renderWidget({
        type: columnWidget.type,
        params,
        className: "w-full h-[90px] pointer-events-none frosted",
        isPreview: true,
      })}

      {/* Hover overlay with controls */}
      <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
        {canEditData && (
          <Dialog open={isDataDialogOpen} onOpenChange={setIsDataDialogOpen}>
            <DialogTrigger asChild>
              <button
                type="button"
                aria-label={`Edit input for ${columnWidget.type}`}
                className="rounded-full bg-white/10 p-2 hover:bg-white/20 backdrop-blur"
              >
                <Edit3 className="h-4 w-4" />
              </button>
            </DialogTrigger>
            <DialogContent className="frosted">
              <DialogHeader>
                <DialogTitle>Edit Widget Input</DialogTitle>
                <DialogDescription>
                  Customize the per-widget input payload used by the preview and saved page config.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor={`widget-data-input-${columnWidget.id}`}>Input JSON</Label>
                  <textarea
                    id={`widget-data-input-${columnWidget.id}`}
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
                  Save input
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        <button
          type="button"
          aria-label={`Drag ${columnWidget.type}`}
          className="rounded-full bg-white/10 p-2 hover:bg-white/20 backdrop-blur cursor-grab active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${columnWidget.type}`}
          className="rounded-full bg-white/10 p-2 hover:bg-red-500/40 backdrop-blur"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function ColumnDropZone({
  id,
  children,
  isOver,
}: {
  id: string;
  children: ReactNode;
  isOver?: boolean;
}) {
  const { setNodeRef, isOver: droppableIsOver } = useDroppable({ id });
  const over = isOver ?? droppableIsOver;

  return (
    <div
      ref={setNodeRef}
      className={`min-h-24 space-y-2 rounded-md border border-dashed p-2 transition-colors ${
        over ? "border-blue-400/80 bg-blue-500/10" : "border-white/20"
      }`}
    >
      {children}
    </div>
  );
}

function LibraryItem({ item }: { item: WidgetCatalogItem }) {
  const draggableId = `library:${item.category}:${item.key}`;
  const { setNodeRef, listeners, attributes, isDragging } = useSortable({
    id: draggableId,
  });

  const previewParams = item.preview.properties ?? item.properties ?? {};
  const mergedPreviewParams = item.input ? { ...previewParams, input: item.input } : previewParams;
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
        type: item.key,
        params: mergedPreviewParams,
        className: "h-[110px] w-full",
        isPreview: true,
        previewTemplate,
      })}
    </div>
  );
}

export function DashboardWidgetPreview({
  template,
  columns,
  setColumns,
  onPersistColumns,
  enabledColumns,
  widgetCatalog,
  widgetCategories,
  selectedWidgetCategory,
  setSelectedWidgetCategory,
}: DashboardWidgetPreviewProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<{ zone: ColumnName; index: number } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const filteredWidgetCatalog = useMemo(() => {
    if (!selectedWidgetCategory) return widgetCatalog;
    return widgetCatalog.filter((item) => item.category === selectedWidgetCategory);
  }, [selectedWidgetCategory, widgetCatalog]);

  const removeWidget = (column: ColumnName, widgetId: string) => {
    setColumns((prev) => ({
      ...prev,
      [column]: prev[column].filter((item) => item.id !== widgetId),
    }));
  };

  const findColumn = useCallback(
    (id: string): ColumnName | null => {
      if (id.startsWith("column:")) {
        const col = id.split(":")[1] as ColumnName;
        if (["left", "middle", "right"].includes(col)) return col;
      }
      for (const col of ["left", "middle", "right"] as ColumnName[]) {
        if (columns[col].some((item) => item.id === id)) return col;
      }
      return null;
    },
    [columns]
  );

  // The widget (or library item) currently being dragged — for DragOverlay
  const activeWidget = useMemo(() => {
    if (!activeId) return null;
    if (activeId.startsWith("library:")) {
      const [, category, ...rest] = activeId.split(":");
      const key = rest.join(":");
      return widgetCatalog.find((item) => item.category === category && item.key === key) ?? null;
    }
    for (const col of ["left", "middle", "right"] as ColumnName[]) {
      const found = columns[col].find((item) => item.id === activeId);
      if (found) return found;
    }
    return null;
  }, [activeId, columns, widgetCatalog]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    setDragOver(null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const over = event.over;
    if (!over) return setDragOver(null);

    const overId = String(over.id);
    const overZone = findColumn(overId);

    if (overZone) {
      const index = columns[overZone].findIndex((w) => w.id === overId);
      setDragOver({ zone: overZone, index: index >= 0 ? index : columns[overZone].length });
      return;
    }

    // Dropped onto empty column droppable
    if (overId.startsWith("column:")) {
      const col = overId.split(":")[1] as ColumnName;
      if (["left", "middle", "right"].includes(col) && enabledColumns.includes(col)) {
        setDragOver({ zone: col, index: columns[col].length });
        return;
      }
    }

    setDragOver(null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const activeIdStr = String(event.active.id);
    setActiveId(null);

    const target = dragOver ?? (() => {
      if (!event.over) return null;
      const overId = String(event.over.id);
      const overZone = findColumn(overId);
      if (overZone) {
        const idx = columns[overZone].findIndex((w) => w.id === overId);
        return { zone: overZone, index: idx >= 0 ? idx : columns[overZone].length };
      }
      if (overId.startsWith("column:")) {
        const col = overId.split(":")[1] as ColumnName;
        if (["left", "middle", "right"].includes(col) && enabledColumns.includes(col)) {
          return { zone: col as ColumnName, index: columns[col as ColumnName].length };
        }
      }
      return null;
    })();

    setDragOver(null);

    if (!target || !enabledColumns.includes(target.zone)) return;

    // Drop from library
    if (activeIdStr.startsWith("library:")) {
      const [, category, ...rest] = activeIdStr.split(":");
      const key = rest.join(":");
      if (!key || !category) return;
      const source = widgetCatalog.find((item) => item.category === category && item.key === key);
      if (!source) return;

      const nextWidget: ColumnWidget = { id: createWidgetId(), type: key, properties: {}, input: undefined };
      const nextColumns = { left: [...columns.left], middle: [...columns.middle], right: [...columns.right] };
      nextColumns[target.zone].splice(target.index, 0, nextWidget);
      setColumns(nextColumns);
      await onPersistColumns?.(nextColumns);
      return;
    }

    // Reorder / cross-column move
    const activeColumn = findColumn(activeIdStr);
    if (!activeColumn) return;

    const nextColumns = moveItem(columns, activeIdStr, event.over ? String(event.over.id) : `column:${target.zone}`, target.zone);
    setColumns(nextColumns);
    await onPersistColumns?.(nextColumns);
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
                template === "left-middle" ? "grid-cols-[1fr_2fr]" : "grid-cols-[1fr_2fr_1fr]"
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
                        isOver={dragOver?.zone === column}
                      >
                        <SortableContext
                          items={columns[column].map((item) => item.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          {columns[column].map((widget, i) => (
                            <div key={widget.id}>
                              {/* Drop preview indicator */}
                              {dragOver?.zone === column && dragOver.index === i && (
                                <div className="mb-2 h-[90px] rounded-lg border-2 border-dashed border-blue-400/60 bg-blue-500/10" />
                              )}
                              <WidgetTile
                                columnWidget={widget}
                                widgetConfig={widgetCatalog.find((item) => item.key === widget.type)}
                                isActive={activeId === widget.id}
                                onRemove={() => removeWidget(column, widget.id)}
                                onUpdateInput={(widgetId, input) => {
                                  setColumns((prev) => ({
                                    ...prev,
                                    [column]: prev[column].map((item) => {
                                      if (item.id !== widgetId) return item;
                                      const source = widgetCatalog.find((w) => w.key === item.type);
                                      const hasInput = input && Object.keys(input).length > 0;
                                      const inputMatchesDefault = hasInput
                                        ? JSON.stringify(input) === JSON.stringify(source?.input ?? {})
                                        : false;
                                      const nextInput = hasInput && !inputMatchesDefault ? input : undefined;
                                      return { ...item, input: nextInput };
                                    }),
                                  }));
                                }}
                              />
                            </div>
                          ))}
                          {/* Drop preview at end of list */}
                          {dragOver?.zone === column && dragOver.index === columns[column].length && (
                            <div className="h-[90px] rounded-lg border-2 border-dashed border-blue-400/60 bg-blue-500/10" />
                          )}
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
              items={filteredWidgetCatalog.map((item) => `library:${item.category}:${item.key}`)}
              strategy={verticalListSortingStrategy}
            >
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filteredWidgetCatalog.map((item) => (
                  <div key={`${item.category}:${item.key}`} className="space-y-2 border-transparent">
                    <LibraryItem item={item} />
                    <p className="text-center text-xs text-white/70">{item.name}</p>
                  </div>
                ))}
              </div>
            </SortableContext>
          </div>
        </div>

        {/* Floating drag overlay */}
        <DragOverlay>
          {activeWidget && (() => {
            const isLibrary = "key" in activeWidget;
            const type = isLibrary ? (activeWidget as WidgetCatalogItem).key : (activeWidget as ColumnWidget).type;
            const catalogItem = isLibrary
              ? (activeWidget as WidgetCatalogItem)
              : widgetCatalog.find((i) => i.key === type);
            const params = {
              ...(catalogItem?.properties ?? {}),
              ...((activeWidget as ColumnWidget).input ?? {}),
            };
            return (
              <div className="w-48 rounded-lg overflow-hidden shadow-2xl opacity-90 rotate-1 scale-105">
                {renderWidget({ type, params, className: "h-[90px] w-full", isPreview: true })}
              </div>
            );
          })()}
        </DragOverlay>
      </DndContext>
    </div>
  );
}