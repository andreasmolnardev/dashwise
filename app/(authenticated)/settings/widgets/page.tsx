"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { usePageConfig } from "@/hooks/usePageConfig";
import { updateConfigPathAction } from "@/app/actions/config";
import WidgetCategoryFilters from "@/components/settings/widgets/WidgetCategoryFilters";
import rawWidgetsData from "@/public/widgets.json";
import useAuth from "@/context/useAuth";
import { getIntegrationsAction } from "@/app/actions/integrations";

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
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { SortableWidget } from "@/components/settings/widgets/SortableWidget";
import { LibraryDraggable } from "@/components/settings/widgets/LibraryDraggable";
import { DroppableColumn } from "@/components/settings/widgets/DroppableColumn";
import WidgetEditDialog from "@/components/settings/widgets/EditWidgetDialog";
import { SettingsWidgetPreview } from "@/components/settings/widgets/SettingsWidgetPreview";

export interface Widget {
  id: string;
  type: string;
  properties: Record<string, any>;
}

export interface WidgetInfo {
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

function generateWidgetId(): string {
  return Math.random().toString(36).substring(2, 15);
}

export default function WidgetsSettingsPage() {
  const { config, refreshConfig } = usePageConfig();
  const { token, withAuth } = useAuth();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [dropZones, setDropZones] = useState<DropZones>({ left: [], middle: [], right: [] });
  const [integrationWidgetsData, setIntegrationWidgetsData] = useState<WidgetsData>({});
  const [enabledIntegrations, setEnabledIntegrations] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedWidget, setSelectedWidget] = useState<WidgetInfo | null>(null);
  const [dropZoneTarget, setDropZoneTarget] = useState<"left" | "middle" | "right" | null>(null);
  const [activeWidgetInfo, setActiveWidgetInfo] = useState<Widget | WidgetInfo | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
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
        await withAuth((auth) => updateConfigPathAction(auth, "widgets", zones, "home"));
        await refreshConfig();
      } catch (err) {
        console.error(err);
      }
    },
    [refreshConfig, withAuth]
  );

  const widgetsData = rawWidgetsData as unknown as WidgetsData;

  useEffect(() => {
    let cancelled = false;

    const normalizeIntegrationName = (value: unknown) =>
      typeof value === "string" ? value.trim().toLowerCase() : "";

    async function loadIntegrationWidgets() {
      if (!token) {
        if (!cancelled) {
          setIntegrationWidgetsData({});
          setEnabledIntegrations(new Set());
        }
        return;
      }

      try {
        const response = await withAuth((auth) => getIntegrationsAction(auth));
        const integrations: any[] =
          response && "integrations" in response && Array.isArray(response.integrations)
            ? response.integrations
            : [];

        const enabledNames = new Set<string>();
        for (const integration of integrations) {
          const normalized = normalizeIntegrationName(
            integration?.name ?? integration?.config?.details?.name
          );
          if (normalized) {
            enabledNames.add(normalized);
          }
        }

        const mapped = integrations.reduce((acc: WidgetsData, integration: any) => {
          const integrationName = integration?.name ?? integration?.config?.details?.name;
          if (!integrationName) {
            return acc;
          }

          const widgets = integration?.config?.configuration?.widgets;
          if (!Array.isArray(widgets) || widgets.length === 0) {
            return acc;
          }

          const category = `int:${integrationName}`;
          const existing = acc[category] ?? [];

          const mappedWidgets: WidgetInfo[] = widgets.map((widget: any, index: number) => {
            const explicitSlug = typeof widget?.slug === "string" ? widget.slug : null;
            const normalizedName =
              typeof widget?.name === "string" && widget.name.trim().length > 0
                ? widget.name.trim()
                : `${integrationName} Widget ${index + 1}`;

            return {
              slug:
                explicitSlug ??
                `${String(integrationName).toLowerCase().replace(/\s+/g, "-")}-${normalizedName
                  .toLowerCase()
                  .replace(/\s+/g, "-")}`,
              name: normalizedName,
              properties:
                widget?.properties && typeof widget.properties === "object"
                  ? widget.properties
                  : undefined,
              exampleProps: {},
            };
          });

          acc[category] = [...existing, ...mappedWidgets];
          return acc;
        }, {} as WidgetsData);

        if (!cancelled) {
          setEnabledIntegrations(enabledNames);
          setIntegrationWidgetsData(mapped);
        }
      } catch (error) {
        console.error("Failed to load integration widgets", error);
        if (!cancelled) {
          setIntegrationWidgetsData({});
          setEnabledIntegrations(new Set());
        }
      }
    }

    void loadIntegrationWidgets();

    return () => {
      cancelled = true;
    };
  }, [token, withAuth]);

  const mergedWidgetsData = useMemo(() => {
    const merged: WidgetsData = { ...widgetsData };

    for (const [category, widgets] of Object.entries(integrationWidgetsData)) {
      const existing = merged[category] ?? [];
      const existingSlugs = new Set(existing.map((widget) => widget.slug));

      const deduped = widgets.filter((widget) => !existingSlugs.has(widget.slug));
      merged[category] = [...existing, ...deduped];
    }

    return merged;
  }, [integrationWidgetsData, widgetsData]);

  const filteredWidgetsData = useMemo(() => {
    const normalizeIntegrationName = (value: unknown) =>
      typeof value === "string" ? value.trim().toLowerCase() : "";

    const legacyEnabledIntegrations = new Set<string>(
      Object.keys(config?.integrations ?? {}).map((name) => normalizeIntegrationName(name))
    );

    const filtered: WidgetsData = {};

    for (const [category, widgets] of Object.entries(mergedWidgetsData)) {
      if (!category.startsWith("int:")) {
        filtered[category] = widgets;
        continue;
      }

      const integrationName = normalizeIntegrationName(category.slice(4));
      if (
        integrationName &&
        (enabledIntegrations.has(integrationName) || legacyEnabledIntegrations.has(integrationName))
      ) {
        filtered[category] = widgets;
      }
    }

    return filtered;
  }, [config?.integrations, enabledIntegrations, mergedWidgetsData]);

  const isEditable = (type: string) => {
    return Object.values(filteredWidgetsData)
      .flat()
      .some((w) => w.slug === type && w.properties && Object.keys(w.properties).length > 0);
  }


  const removeWidget = (zone: "left" | "middle" | "right", index: number) => {
    const newZones = { ...dropZones };
    newZones[zone].splice(index, 1);
    setDropZones(newZones);
    updateWidgetsConfig([newZones.left, newZones.middle, newZones.right]);
  };

  const editWidget = (widget: Widget, zone: "left" | "middle" | "right") => {
    const info = Object.values(filteredWidgetsData).flat().find((w) => w.slug === widget.type);
    if (!info) return;
    setSelectedWidget({ ...info, id: widget.id, properties: info.properties });
    setDropZoneTarget(zone);
    setDialogOpen(true);
  };

  const displayedWidgets = selectedCategory
    ? filteredWidgetsData[selectedCategory]
    : Object.values(filteredWidgetsData).flat();

  const integrationWidgetSlugs = useMemo(() => {
    const slugs = new Set<string>();
    for (const [category, widgets] of Object.entries(filteredWidgetsData)) {
      if (!category.startsWith("int:")) {
        continue;
      }
      for (const widget of widgets) {
        if (widget.slug) {
          slugs.add(widget.slug);
        }
      }
    }
    return slugs;
  }, [filteredWidgetsData]);

  const getWidgetType = (value: Widget | WidgetInfo) =>
    "slug" in value ? value.slug : value.type;

  const getWidgetParams = (value: Widget | WidgetInfo) =>
    "slug" in value ? (value.exampleProps || {}) : (value.properties || {});

  /* ---------- DnD helpers ---------- */
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

    const srcZone = findZoneForId(id);
    if (srcZone) {
      const w = dropZones[srcZone].find((x) => x.id === id)!;
      setActiveWidgetInfo(w);
      return;
    }

    const slugFromData = (event.active as any).data?.current?.slug;
    if (slugFromData) {
      const info = displayedWidgets.find((d) => d.slug === slugFromData);
      if (info) setActiveWidgetInfo(info);
      return;
    }

    if (id.startsWith("new-")) {
      const slug = id.split("-")[1];
      const info = displayedWidgets.find((d) => d.slug === slug);
      if (info) setActiveWidgetInfo(info);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const over = event.over;
    if (!over) return setDragOver(null);

    const overIdStr = String(over.id);
    const overZone = findZoneForId(overIdStr);
    if (overZone) {
      const index = dropZones[overZone].findIndex((w) => w.id === overIdStr);
      setDragOver({ zone: overZone, index: index >= 0 ? index : dropZones[overZone].length });
      return;
    }

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

    if (activeZone) {
      const fromIndex = newZones[activeZone].findIndex((w) => w.id === activeIdStr);
      const [moved] = newZones[activeZone].splice(fromIndex, 1);
      const insertIndex = activeZone === target.zone && fromIndex < target.index ? target.index - 1 : target.index;
      newZones[target.zone].splice(insertIndex, 0, moved);
    } else {
      const slug = (active as any).data?.current?.slug ?? activeIdStr.split("-")[1];
      if (slug) {
        const newWidget: Widget = { id: generateWidgetId(), type: slug, properties: {} };
        newZones[target.zone].splice(target.index, 0, newWidget);
      }
    }

    setDropZones(newZones);
    updateWidgetsConfig([newZones.left, newZones.middle, newZones.right]);
    setActiveWidgetInfo(null);
    setDragOver(null);
  };

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
        {/* main layout */}
        <div className="grid grid-cols-[25%_1fr_25%] gap-2 p-2 h-[500px] bg-(--surface) rounded-lg frosted">
          {(["left", "middle", "right"] as const).map((zoneKey) => (
            <SortableContext key={zoneKey} items={dropZones[zoneKey].map((w) => w.id)} strategy={verticalListSortingStrategy}>
              <DroppableColumn id={`${zoneKey}-container`} className="flex flex-col gap-2">
                {zoneKey === "middle" &&
                  topPlaceholders.map((p) => {
                    const h =
                      p === "Clock"
                        ? "h-[4rem]"
                        : p === "Links"
                          ? "h-[8rem]"
                          : "h-[3rem]";

                    return (
                      <div
                        key={p}
                        className={`frosted rounded-md p-2 flex items-center justify-center ${h}`}
                      >
                        <span className="text-sm">{p}</span>
                      </div>
                    );
                  })}
                {dropZones[zoneKey].map((w, i) => (
                  <div key={w.id}>
                    {dragOver && dragOver.zone === zoneKey && dragOver.index === i && activeWidgetInfo && (
                      <div className="relative">
                        <div className="opacity-80 border-2 border-dashed border-blue-300 rounded-lg overflow-hidden">
                          <SettingsWidgetPreview
                            type={getWidgetType(activeWidgetInfo)}
                            params={getWidgetParams(activeWidgetInfo)}
                            isIntegrationWidget={integrationWidgetSlugs.has(getWidgetType(activeWidgetInfo))}
                            className="h-[90px] w-full"
                          />
                        </div>
                      </div>
                    )}
                    <SortableWidget
                      widget={w}
                      activeId={activeId}
                      isIntegrationWidget={integrationWidgetSlugs.has(w.type)}
                      onEdit={isEditable(w.type) ? () => editWidget(w, zoneKey) : undefined}
                      onRemove={() => removeWidget(zoneKey, i)}
                    />
                  </div>
                ))}
              </DroppableColumn>
            </SortableContext>
          ))}
        </div>

        <DragOverlay>
          {activeWidgetInfo && (
            <div className="rounded-lg h-[90px] flex items-center justify-center">
              <SettingsWidgetPreview
                type={getWidgetType(activeWidgetInfo)}
                params={getWidgetParams(activeWidgetInfo)}
                isIntegrationWidget={integrationWidgetSlugs.has(getWidgetType(activeWidgetInfo))}
                className="h-[90px] w-full opacity-95"
              />
            </div>
          )}
        </DragOverlay>

        <WidgetCategoryFilters
          categories={Object.keys(filteredWidgetsData)}
          selectedCategory={selectedCategory}
          onCategorySelect={setSelectedCategory}
        />

        <ul className="grid gap-4 overflow-x-scroll" style={{ gridTemplateColumns: `repeat(${displayedWidgets.length}, 220px)` }}>
          {displayedWidgets.map((w, i) => (
            <LibraryDraggable
              key={`${w.slug}-${i}`}
              info={w}
              index={i}
              isIntegrationWidget={integrationWidgetSlugs.has(w.slug)}
            />
          ))}
        </ul>
      </DndContext>
      <WidgetEditDialog
        open={dialogOpen}
        widget={selectedWidget}
        onClose={() => setDialogOpen(false)}
        onSave={(updated) => {
          if (!dropZoneTarget || !updated) return;

          const newZones = { ...dropZones };
          newZones[dropZoneTarget] = newZones[dropZoneTarget].map((w) =>
            w.id === updated.id ? { ...w, properties: updated.properties || {} } : w
          );

          setDropZones(newZones);
          updateWidgetsConfig([newZones.left, newZones.middle, newZones.right]);

          setDialogOpen(false);
          setSelectedWidget(null);
        }}
      />
    </section>
  );
}
