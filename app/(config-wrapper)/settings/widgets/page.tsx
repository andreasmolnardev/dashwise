"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import WidgetComponent from "@/components/widgets/Widget";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useConfig } from "@/context/ConfigContext";

import WidgetCategoryFilters from "@/components/settings/widgets/WidgetCategoryFilters";
import rawWidgetsData from "@/public/widgets.json";

import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverEvent,
  DragOverlay,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface Widget {
  id: string;
  type: string;
  properties: Record<string, any>;
}

interface WidgetInfo {
  id?: string;
  slug: string;
  name: string;
  properties?: Record<string, any>;
  exampleProps?: Record<string, any>;
}

interface DropZones {
  left: Widget[];
  middle: Widget[];
  right: Widget[];
}

interface WidgetsData {
  [category: string]: WidgetInfo[];
}

const widgetsData = rawWidgetsData as unknown as WidgetsData;

function generateWidgetId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/* ---------- Sortable preview item (renders real WidgetComponent) ---------- */
function SortableWidget({
  widget,
  activeId,
  onEdit,
  onRemove,
}: {
  widget: Widget;
  activeId?: string | null;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: widget.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: activeId === widget.id ? 0 : 1,
    pointerEvents: activeId === widget.id ? "none" : undefined,
  } as any;

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="relative">
      <WidgetComponent type={widget.type} params={widget.properties || {}} className="h-[90px] w-full" />
      {onEdit && (
        <button className="absolute top-2 right-2 p-1 rounded hover:bg-white/10" onClick={onEdit} type="button">
          Edit
        </button>
      )}
      {onRemove && (
        <button
          className="absolute top-2 right-10 p-1 rounded hover:bg-white/10"
          onClick={onRemove}
          type="button"
        >
          Remove
        </button>
      )}
    </div>
  );
}

/* ---------- Library draggable using dnd-kit (stable id per library item) ---------- */
function LibraryDraggable({ info, index }: { info: WidgetInfo; index: number }) {
  // stable id per library item (slug + index)
  const id = useMemo(() => `new-${info.slug}-${index}`, [info.slug, index]);
  // pass data so event.active.data.current is available reliably
  const { attributes, listeners, setNodeRef } = useDraggable({ id, data: { slug: info.slug } });

  return (
    <li
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-new-slug={info.slug}
      className="flex flex-col items-center gap-2"
      style={{ listStyle: "none", touchAction: "none", cursor: "grab" }}
    >
      <WidgetComponent type={info.slug} className="h-[90px] w-full" params={info.exampleProps || {}} />
      <span className="text-sm font-medium">{info.name}</span>
    </li>
  );
}

/* ---------- Droppable wrapper for empty column drops ---------- */
function DroppableColumn({
  id,
  children,
  className,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`${className ?? ""} ${isOver ? "outline outline-2 outline-blue-400/40" : ""}`}
    >
      {children}
    </div>
  );
}

/* -------------------- Page Component -------------------- */
export default function WidgetsSettingsPage() {
  const { config, refreshConfig } = useConfig();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [dropZones, setDropZones] = useState<DropZones>({ left: [], middle: [], right: [] });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedWidget, setSelectedWidget] = useState<WidgetInfo | null>(null);
  const [dropZoneTarget, setDropZoneTarget] = useState<"left" | "middle" | "right" | null>(null);

  const [activeWidgetInfo, setActiveWidgetInfo] = useState<Widget | WidgetInfo | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  // insertion position while dragging
  const [dragOver, setDragOver] = useState<{ zone: "left" | "middle" | "right"; index: number } | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    if (config?.widgets) {
      setDropZones({
        left: config.widgets[0] || [],
        middle: config.widgets[1] || [],
        right: config.widgets[2] || [],
      });
    }
  }, [config?.widgets]);

  const updateWidgetsConfig = useCallback(
    async (zones: Widget[][]) => {
      try {
        const token = localStorage.getItem("pb_token");
        if (!token) throw new Error("Not authenticated");

        await fetch("/api/v1/config?path=widgets", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ updatedItem: zones }),
        });
        await refreshConfig();
      } catch (err) {
        console.error(err);
      }
    },
    [refreshConfig]
  );

  const isEditable = (type: string) =>
    Object.values(widgetsData)
      .flat()
      .some((w) => w.slug === type && w.properties && Object.keys(w.properties).length > 0);

  const removeWidget = (zone: "left" | "middle" | "right", index: number) => {
    const newZones = { ...dropZones };
    newZones[zone].splice(index, 1);
    setDropZones(newZones);
    updateWidgetsConfig([newZones.left, newZones.middle, newZones.right]);
  };

  const editWidget = (widget: Widget, zone: "left" | "middle" | "right") => {
    const info = Object.values(widgetsData).flat().find((w) => w.slug === widget.type);
    if (!info) return;
    setSelectedWidget({ ...info, id: widget.id, properties: widget.properties });
    setDropZoneTarget(zone);
    setDialogOpen(true);
  };

  const displayedWidgets = selectedCategory ? widgetsData[selectedCategory] : Object.values(widgetsData).flat();

  /* helper: find which zone contains an item id */
  const findZoneForId = (id: string | number | null): "left" | "middle" | "right" | null => {
    if (id == null) return null;
    const s = String(id);
    for (const z of ["left", "middle", "right"] as const) {
      if (dropZones[z].some((w) => w.id === s)) return z;
    }
    return null;
  };

  /* ---------- DnD handlers ---------- */
  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    setActiveId(id);

    // If this id matches an existing widget in a drop zone, use that widget
    const srcZone = findZoneForId(id);
    if (srcZone) {
      const w = dropZones[srcZone].find((x) => x.id === id)!;
      setActiveWidgetInfo(w);
      return;
    }

    // If draggable provided data (LibraryDraggable does), use it
    // event.active.data.current may contain { slug }
    const activeData: any = (event.active as any).data;
    const slugFromData = activeData?.current?.slug;
    if (slugFromData) {
      const info = displayedWidgets.find((d) => d.slug === slugFromData);
      if (info) {
        setActiveWidgetInfo(info);
        return;
      }
    }

    // Fallback: parse id if it follows new-<slug>-<index>
    if (id.startsWith("new-")) {
      const parts = id.split("-");
      const slug = parts[1];
      const info = displayedWidgets.find((d) => d.slug === slug);
      if (info) setActiveWidgetInfo(info);
      return;
    }

    setActiveWidgetInfo(null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const over = event.over;
    if (!over) {
      setDragOver(null);
      return;
    }

    const overIdStr = String(over.id);

    // If over is a widget item
    const overZone = findZoneForId(overIdStr);
    if (overZone) {
      const index = dropZones[overZone].findIndex((w) => w.id === overIdStr);
      // show placeholder before this item
      setDragOver({ zone: overZone, index: index >= 0 ? index : dropZones[overZone].length });
      return;
    }

    // If over is a container id like "left-container"
    for (const z of ["left", "middle", "right"] as const) {
      if (overIdStr === `${z}-container`) {
        setDragOver({ zone: z, index: dropZones[z].length });
        return;
      }
    }

    setDragOver(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const active = event.active;
    const over = event.over;

    setActiveId(null);

    const target =
      dragOver ??
      (() => {
        if (!over) return null;
        const overIdStr = String(over.id);
        const overZone = findZoneForId(overIdStr);
        if (overZone) {
          const idx = dropZones[overZone].findIndex((w) => w.id === overIdStr);
          return { zone: overZone, index: idx >= 0 ? idx : dropZones[overZone].length };
        }
        for (const z of ["left", "middle", "right"] as const) {
          if (overIdStr === `${z}-container`) return { zone: z, index: dropZones[z].length };
        }
        return null;
      })();

    if (!target) {
      setActiveWidgetInfo(null);
      setDragOver(null);
      return;
    }

    const activeIdStr = String(active.id);
    const activeZone = findZoneForId(activeIdStr);

    const newZones = { ...dropZones };

    // moving existing widget
    if (activeZone) {
      const fromIndex = newZones[activeZone].findIndex((w) => w.id === activeIdStr);
      if (fromIndex === -1) {
        setActiveWidgetInfo(null);
        setDragOver(null);
        return;
      }

      const [moved] = newZones[activeZone].splice(fromIndex, 1);

      const insertIndex = (() => {
        if (activeZone === target.zone && fromIndex < target.index) return Math.max(0, target.index - 1);
        return target.index;
      })();

      newZones[target.zone].splice(insertIndex, 0, moved);
      setDropZones(newZones);
      updateWidgetsConfig([newZones.left, newZones.middle, newZones.right]);
      setActiveWidgetInfo(null);
      setDragOver(null);
      return;
    }

    // adding a NEW widget from library
    // use event.active.data.current?.slug preferentially
    const activeData: any = (active as any).data;
    const slugFromData = activeData?.current?.slug;
    if (slugFromData) {
      const slug = slugFromData;
      const newWidget: Widget = { id: generateWidgetId(), type: slug, properties: {} };
      newZones[target.zone].splice(target.index, 0, newWidget);
      setDropZones(newZones);
      updateWidgetsConfig([newZones.left, newZones.middle, newZones.right]);
      setActiveWidgetInfo(null);
      setDragOver(null);
      return;
    }

    // fallback to parse id like new-<slug>-<index>
    if (activeId && activeId.startsWith("new-")) {
      const slug = activeId.split("-")[1];
      const newWidget: Widget = { id: generateWidgetId(), type: slug, properties: {} };
      newZones[target.zone].splice(target.index, 0, newWidget);
      setDropZones(newZones);
      updateWidgetsConfig([newZones.left, newZones.middle, newZones.right]);
    }

    setActiveWidgetInfo(null);
    setDragOver(null);
  };

  /* ---------- placeholders (middle top area) ---------- */
  const topPlaceholders = ["Clock", "Search", "Links"];

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Widgets</h1>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-[25%_1fr_25%] gap-2 p-2 h-[500px] bg-(--surface) rounded-lg frosted">
          {(["left", "middle", "right"] as const).map((zoneKey) => (
            <SortableContext key={zoneKey} items={dropZones[zoneKey].map((w) => w.id)} strategy={verticalListSortingStrategy}>
              <DroppableColumn id={`${zoneKey}-container`} className="flex flex-col gap-2">
                {/* top placeholders in middle column stay static */}
                {zoneKey === "middle" &&
                  topPlaceholders.map((p) => (
                    <div key={p} className="frosted rounded-md p-2 flex items-center justify-center">
                      <span className="text-sm">{p}</span>
                    </div>
                  ))}

                {/* render items and inject temporary semi-placeholder */}
                {dropZones[zoneKey].map((w, i) => (
                  <div key={w.id}>
                    {/* insertion placeholder before index i */}
                    {dragOver && dragOver.zone === zoneKey && dragOver.index === i && activeWidgetInfo && (
                      <div className="relative">
                        <div className="opacity-80 border-2 border-dashed border-blue-300 rounded-lg overflow-hidden">
                          <WidgetComponent
                            type={"slug" in activeWidgetInfo ? activeWidgetInfo.slug : (activeWidgetInfo as Widget).type}
                            params={
                              "slug" in activeWidgetInfo
                                ? (activeWidgetInfo as WidgetInfo).exampleProps || {}
                                : (activeWidgetInfo as Widget).properties || {}
                            }
                            className="h-[90px] w-full"
                          />
                        </div>
                      </div>
                    )}

                    <SortableWidget
                      widget={w}
                      activeId={activeId}
                      onEdit={isEditable(w.type) ? () => editWidget(w, zoneKey) : undefined}
                      onRemove={() => removeWidget(zoneKey, i)}
                    />
                  </div>
                ))}

                {/* insertion placeholder at end */}
                {dragOver && dragOver.zone === zoneKey && dragOver.index === dropZones[zoneKey].length && activeWidgetInfo && (
                  <div className="relative">
                    <div className="opacity-80 border-2 border-dashed border-blue-300 rounded-lg overflow-hidden">
                      <WidgetComponent
                        type={"slug" in activeWidgetInfo ? activeWidgetInfo.slug : (activeWidgetInfo as Widget).type}
                        params={
                          "slug" in activeWidgetInfo
                            ? (activeWidgetInfo as WidgetInfo).exampleProps || {}
                            : (activeWidgetInfo as Widget).properties || {}
                        }
                        className="h-[90px] w-full"
                      />
                    </div>
                  </div>
                )}
              </DroppableColumn>
            </SortableContext>
          ))}
        </div>

        <DragOverlay>
          {activeWidgetInfo && (
            <div className="rounded-lg h-[90px] flex items-center justify-center">
              <WidgetComponent
                type={"slug" in activeWidgetInfo ? activeWidgetInfo.slug : (activeWidgetInfo as Widget).type}
                params={
                  "slug" in activeWidgetInfo
                    ? (activeWidgetInfo as WidgetInfo).exampleProps || {}
                    : (activeWidgetInfo as Widget).properties || {}
                }
                className="h-[90px] w-full opacity-95"
              />
            </div>
          )}
        </DragOverlay>

        {/* library and category filters must be inside DndContext so useDraggable works */}
        <WidgetCategoryFilters
          categories={Object.keys(widgetsData)}
          selectedCategory={selectedCategory}
          onCategorySelect={setSelectedCategory}
        />

        <ul
          className="grid gap-4 overflow-x-scroll"
          style={{ gridTemplateColumns: `repeat(${displayedWidgets.length}, 220px)` }}
        >
          {displayedWidgets.map((w, i) => (
            <LibraryDraggable key={`${w.slug}-${i}`} info={w} index={i} />
          ))}
        </ul>
      </DndContext>

      {/* Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="frosted text-(--text-primary)">
          <DialogHeader>
            <DialogTitle>Edit Widget</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {selectedWidget?.properties &&
              Object.entries(selectedWidget.properties).map(([key]) => (
                <div key={key} className="space-y-2">
                  <Label htmlFor={key}>{key}</Label>
                  <Input
                    id={key}
                    value={selectedWidget.properties?.[key] ?? ""}
                    onChange={(e) =>
                      setSelectedWidget((prev) =>
                        prev ? { ...prev, properties: { ...(prev.properties || {}), [key]: e.target.value } } : prev
                      )
                    }
                  />
                </div>
              ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!dropZoneTarget || !selectedWidget) return;
                const newZones = { ...dropZones };
                newZones[dropZoneTarget] = newZones[dropZoneTarget].map((w) =>
                  w.id === selectedWidget.id ? { ...w, properties: selectedWidget.properties || {} } : w
                );
                setDropZones(newZones);
                updateWidgetsConfig([newZones.left, newZones.middle, newZones.right]);
                setDialogOpen(false);
                setSelectedWidget(null);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}