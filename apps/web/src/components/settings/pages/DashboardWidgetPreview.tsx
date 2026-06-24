"use client";

import { useEffect, useMemo, useRef, useState, useCallback, type Dispatch, type ReactNode, type SetStateAction } from "react";
import useAuth from "@/context/useAuth";
import { getConsumerDataAction } from '@/lib/apiClient';
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
import { Edit3, Eye, EyeOff, GripVertical, PanelLeftDashed, Trash2 } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

type DisplayCustomizations = {
  order?: string[];
  hidden?: string[];
};

function getPreviewGridTemplate(template: TemplateId) {
  if (template === "left-middle") return "25% 75%";
  if (template === "right-middle") return "75% 25%";
  return "25% 50% 25%";
}

type DashboardWidgetPreviewProps = {
  template: TemplateId;
  columns: Record<ColumnName, ColumnWidget[]>;
  setColumns: Dispatch<SetStateAction<Record<ColumnName, ColumnWidget[]>>>;
  onPersistColumns?: (nextColumns: Record<ColumnName, ColumnWidget[]>) => void | Promise<void>;
  loadWidgetPreviewData?: (widgetKey: string, input?: Record<string, any>) => Promise<Record<string, any> | null>;
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
  loadWidgetPreviewData,
  isActive,
}: {
  columnWidget: ColumnWidget;
  widgetConfig?: WidgetCatalogItem;
  onRemove: () => void;
  onUpdateInput: (widgetId: string, input?: ColumnWidget["input"]) => void;
  loadWidgetPreviewData?: (widgetKey: string, input?: Record<string, any>) => Promise<Record<string, any> | null>;
  isActive?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: columnWidget.id,
  });
  const [isDataDialogOpen, setIsDataDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"input" | "displayed">("input");
  const [inputDraft, setInputDraft] = useState<Record<string, any>>({});
  const [dataError, setDataError] = useState<string | null>(null);
  const [previewResolved, setPreviewResolved] = useState<Record<string, any> | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [displayOrder, setDisplayOrder] = useState<string[]>([]);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const hasInitializedDisplayOrder = useRef(false);
  const customizationSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const supportsUserCustomizations = useMemo(() => {
    const flags = widgetConfig?.properties?.columns?.user_customizations;
    return Array.isArray(flags) && flags.some((flag) => flag === "allow_reorder" || flag === "allow_hide");
  }, [widgetConfig?.properties?.columns?.user_customizations]);

  const supportedCustomizations = useMemo(
    () => new Set(widgetConfig?.properties?.columns?.user_customizations ?? []),
    [widgetConfig?.properties?.columns?.user_customizations],
  );

  const currentCustomizations = useMemo(() => readDisplayCustomizations(columnWidget.input), [columnWidget.input]);
  const integrationDataEntries = useMemo(() => extractIntegrationDataEntries(previewResolved), [previewResolved]);
  console.log("integration", integrationDataEntries);
  const integrationDataEntriesById = useMemo(
    () => new Map(integrationDataEntries.map((item) => [item.id, item] as const)),
    [integrationDataEntries],
  );

  useEffect(() => {
    if (isDataDialogOpen) return;
    hasInitializedDisplayOrder.current = false;
    const baseInput = {
      ...(columnWidget.properties ?? {}),
      ...stripDisplayCustomizations(columnWidget.input ?? {}),
    };
    const defaultInput = stripDisplayCustomizations(widgetConfig?.input ?? {});
    const mergedInput = { ...defaultInput, ...baseInput };
    setInputDraft(mergedInput);
    setDataError(null);
    setPreviewResolved(null);
    setDisplayOrder([]);
    setHiddenIds([]);
    setActiveTab("input");
  }, [isDataDialogOpen, columnWidget.input, columnWidget.properties, widgetConfig?.input]);

  const { withAuth } = useAuth();

  useEffect(() => {
    if (!isDataDialogOpen || !supportsUserCustomizations || !widgetConfig?.key || !withAuth) {
      return;
    }

    let cancelled = false;
    setIsPreviewLoading(true);

    const previewInput = {
      ...(columnWidget.properties ?? {}),
      ...stripDisplayCustomizations(columnWidget.input ?? {}),
    };

    void withAuth((auth) =>
      getConsumerDataAction(auth, widgetConfig.key, previewInput ?? {}, { type: "widget", isPreview: false }),
    )
      .then((payload) => {
        if (cancelled) return;
        setPreviewResolved(payload as any);
      })
      .catch(() => {
        if (cancelled) return;
        setPreviewResolved(null);
      })
      .finally(() => {
        if (!cancelled) {
          setIsPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [columnWidget.input, columnWidget.properties, isDataDialogOpen, supportsUserCustomizations, widgetConfig?.key, withAuth]);

  useEffect(() => {
    if (!isDataDialogOpen || !supportsUserCustomizations || hasInitializedDisplayOrder.current) {
      return;
    }

    const integrationDataEntryIds = integrationDataEntries.map((item) => item.id);
    if (integrationDataEntryIds.length === 0) {
      return;
    }

    const savedOrder = Array.isArray(currentCustomizations.order) ? currentCustomizations.order : [];
    const savedHidden = Array.isArray(currentCustomizations.hidden) ? currentCustomizations.hidden : [];
    const orderedIds = [
      ...savedOrder.filter((id) => integrationDataEntryIds.includes(id)),
      ...integrationDataEntryIds.filter((id) => !savedOrder.includes(id)),
    ];

    setDisplayOrder(orderedIds);
    setHiddenIds(savedHidden.filter((id) => integrationDataEntryIds.includes(id)));
    hasInitializedDisplayOrder.current = true;
  }, [currentCustomizations.hidden, currentCustomizations.order, isDataDialogOpen, integrationDataEntries, supportsUserCustomizations]);

  const mergedInput = useMemo(() => {
    const baseInput = inputDraft ?? {};
    const customizations = buildDisplayCustomizationsPayload({
      order: displayOrder,
      hidden: hiddenIds,
      supportsReorder: supportedCustomizations.has("allow_reorder"),
      supportsHide: supportedCustomizations.has("allow_hide"),
    });

    if (customizations) {
      return { ...baseInput, display_customizations: customizations };
    }

    return baseInput;
  }, [displayOrder, hiddenIds, inputDraft, supportedCustomizations]);

  const handleSaveData = () => {
    setDataError(null);
    const nextInput = mergePersistedInput(inputDraft ?? {}, {
      order: displayOrder,
      hidden: hiddenIds,
      supportsReorder: supportedCustomizations.has("allow_reorder"),
      supportsHide: supportedCustomizations.has("allow_hide"),
    });

    onUpdateInput(columnWidget.id, Object.keys(nextInput).length > 0 ? nextInput : undefined);
    setIsDataDialogOpen(false);
  };

  const toggleHidden = (id: string) => {
    setHiddenIds((prev) => prev.includes(id) ? prev.filter((hiddenId) => hiddenId !== id) : [...prev, id]);
  };

  const handleCustomizationDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId || activeId === overId) return;

    setDisplayOrder((prev) => {
      const fromIndex = prev.indexOf(activeId);
      const toIndex = prev.indexOf(overId);
      if (fromIndex < 0 || toIndex < 0) return prev;
      const next = [...prev];
      next.splice(fromIndex, 1);
      next.splice(toIndex, 0, activeId);
      return next;
    });
  };

  const canEditData = hasEditableWidgetData(columnWidget, widgetConfig) || supportsUserCustomizations;
  const params = {
    ...(widgetConfig?.properties ?? {}),
    ...(columnWidget.properties ?? {}),
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
        className: "w-full h-[90px]",
      })}

      {/* Hover overlay with controls */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg backdrop-blur-[2px]">
        {widgetConfig?.name && (
          <p className="font-bold py-0.5 text-sm text-center">
            {widgetConfig.name}
          </p>
        )}
        <div className="flex items-center justify-center gap-1">
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
                <DialogTitle>{supportsUserCustomizations ? "Edit Widget Settings" : "Edit Widget Input"}</DialogTitle>
                <DialogDescription>
                  {supportsUserCustomizations
                    ? "Adjust the input payload and displayed items for this widget instance."
                    : "Customize the per-widget input payload used by the preview and saved page config."}
                </DialogDescription>
              </DialogHeader>
              {supportsUserCustomizations ? (
                <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "input" | "displayed")} className="py-4">
                  <TabsList className="grid w-full grid-cols-2 frosted rounded-full">
                    <TabsTrigger value="input" className="rounded-full">Input</TabsTrigger>
                    <TabsTrigger value="displayed" className="rounded-full">Displayed Items</TabsTrigger>
                  </TabsList>

                  <TabsContent value="input" className="space-y-4 pt-4 max-h-[50vh] overflow-y-auto">
                    <WidgetInputEditor
                      widgetId={columnWidget.id}
                      inputDraft={inputDraft}
                      onChange={setInputDraft}
                      dataError={dataError}
                      setDataError={setDataError}
                    />
                    {dataError ? <p className="text-sm text-red-400">{dataError}</p> : null}
                  </TabsContent>

                  <TabsContent value="displayed" className="space-y-3 pt-4">
                    {isPreviewLoading ? (
                      <p className="text-sm text-white/60">Loading items...</p>
                    ) : integrationDataEntries.length > 0 ? (
                      <DndContext
                        collisionDetection={closestCenter}
                        onDragEnd={handleCustomizationDragEnd}
                        sensors={customizationSensors}
                      >
                        <SortableContext items={displayOrder} strategy={verticalListSortingStrategy}>
                          <div className="space-y-2">
                            {displayOrder.map((itemId) => {
                              const item = integrationDataEntriesById.get(itemId);
                              if (!item) return null;
                              return (
                                <DisplayedItemRow
                                  key={itemId}
                                  id={itemId}
                                  title={item.title}
                                  subtitle={item.subtitle}
                                  hidden={hiddenIds.includes(itemId)}
                                  onToggleHidden={() => toggleHidden(itemId)}
                                />
                              );
                            })}
                          </div>
                        </SortableContext>
                      </DndContext>
                    ) : (
                      <p className="text-sm text-white/60">This widget has no items yet.</p>
                    )}
                  </TabsContent>
                </Tabs>
              ) : (
                <div className="space-y-4 py-4">
                  <WidgetInputEditor
                    widgetId={columnWidget.id}
                    inputDraft={inputDraft}
                    onChange={setInputDraft}
                    dataError={dataError}
                    setDataError={setDataError}
                  />
                  {dataError ? <p className="text-sm text-red-400">{dataError}</p> : null}
                </div>
              )}
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
  </div>
);
}

function WidgetInputEditor({
  widgetId,
  inputDraft,
  onChange,
  dataError,
  setDataError,
}: {
  widgetId: string;
  inputDraft: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
  dataError: string | null;
  setDataError: (value: string | null) => void;
}) {
  const inputEntries = Object.entries(inputDraft ?? {});
  if (inputEntries.length === 0) {
    return <p className="text-sm text-white/60">No input properties for this widget.</p>;
  }

  return (
    <div className="space-y-3">
      {inputEntries.map(([key, value]) => {
        const inputId = `widget-input-${widgetId}-${key}`;
        const isBoolean = typeof value === "boolean";
        const isNumber = typeof value === "number" && Number.isFinite(value);
        const isText = typeof value === "string" || value === null || value === undefined;

        if (isBoolean) {
          return (
            <label key={key} htmlFor={inputId} className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/20 px-3 py-2">
              <span className="text-sm text-white">{key}</span>
              <input
                id={inputId}
                type="checkbox"
                checked={Boolean(value)}
                onChange={(event) => {
                  setDataError(null);
                  onChange({ ...inputDraft, [key]: event.target.checked });
                }}
                className="h-4 w-4 accent-white"
              />
            </label>
          );
        }

        if (isNumber) {
          return (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={inputId}>{key}</Label>
              <input
                id={inputId}
                type="number"
                value={value}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setDataError(null);
                  onChange({
                    ...inputDraft,
                    [key]: nextValue === "" ? null : Number(nextValue),
                  });
                }}
                className="w-full rounded-md border border-white/15 bg-black/20 px-3 py-2 text-sm outline-none"
              />
            </div>
          );
        }

        if (isText) {
          return (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={inputId}>{key}</Label>
              <input
                id={inputId}
                type="text"
                value={value ?? ""}
                onChange={(event) => {
                  setDataError(null);
                  onChange({ ...inputDraft, [key]: event.target.value });
                }}
                className="w-full rounded-md border border-white/15 bg-black/20 px-3 py-2 text-sm outline-none"
              />
            </div>
          );
        }

        return (
          <div key={key} className="space-y-1.5">
            <Label htmlFor={inputId}>{key}</Label>
            <textarea
              id={inputId}
              value={JSON.stringify(value, null, 2)}
              onChange={(event) => {
                try {
                  const parsed = JSON.parse(event.target.value);
                  setDataError(null);
                  onChange({ ...inputDraft, [key]: parsed });
                } catch {
                  setDataError("Input must be valid JSON.");
                }
              }}
              className="min-h-24 w-full rounded-md border border-white/15 bg-black/20 p-3 text-sm outline-none"
              spellCheck={false}
            />
            {dataError ? <p className="text-xs text-red-400">{dataError}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

function DisplayedItemRow({
  id,
  title,
  subtitle,
  hidden,
  onToggleHidden,
}: {
  id: string;
  title: string;
  subtitle?: string;
  hidden: boolean;
  onToggleHidden: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 ${isDragging ? "opacity-50" : "opacity-100"}`}
    >
      <button
        type="button"
        className="cursor-grab rounded-md p-1.5 text-white/60 active:cursor-grabbing hover:text-white"
        aria-label={`Drag ${title}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-medium ${hidden ? "text-white/45 line-through" : "text-white"}`}>
          {title}
        </p>
        {subtitle ? <p className="truncate text-xs text-white/50">{subtitle}</p> : null}
      </div>

      <button
        type="button"
        onClick={onToggleHidden}
        className="rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
        aria-label={hidden ? `Show ${title}` : `Hide ${title}`}
      >
        {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

type IntegrationDataEntry = {
  id: string;
  title: string;
  subtitle?: string;
};

function extractIntegrationDataEntries(previewResolved: Record<string, any> | null): IntegrationDataEntry[] {
  const resolvedColumns = Array.isArray(previewResolved?.blueprint?.resolved?.columns)
    ? previewResolved!.blueprint.resolved.columns
    : Array.isArray(previewResolved?.columns)
    ? previewResolved.columns
    : [];
  if (resolvedColumns.length > 0) {
    return resolvedColumns.map((column: any, index: number) => normalizeResolvedColumnEntry(column, index));
  }

  const source = previewResolved?.blueprint?.widgetJSON?.data?.source;
  const items = source ? asArray(getPathValue(previewResolved?.data, source)) : [];

  return items.map((item, index) => normalizeIntegrationDataEntry(item, index));
}

function normalizeResolvedColumnEntry(column: Record<string, any>, index: number): IntegrationDataEntry {
  const id = getFirstString(column.id, String(index + 1));
  const title = getFirstString(column.title, column.label, column.primary, id);
  const subtitle = getFirstString(column.secondary, column.badge?.tooltip);

  return {
    id,
    title,
    subtitle: subtitle && subtitle !== title ? subtitle : undefined,
  };
}

function normalizeIntegrationDataEntry(item: unknown, index: number): IntegrationDataEntry {
  const record = item && typeof item === "object" && !Array.isArray(item)
    ? (item as Record<string, any>)
    : {};

  const id = getFirstString(record.id, record.key, record.displayName, record.name, record.title, record.label, String(index + 1));
  const title = getFirstString(record.displayName, record.name, record.title, record.label, id);
  const subtitle = getFirstString(record.secondary, record.subtitle, record.description, record.group);

  return {
    id,
    title,
    subtitle: subtitle && subtitle !== title ? subtitle : undefined,
  };
}

function getPathValue(value: unknown, path: string): unknown {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }

    return (current as Record<string, unknown>)[segment];
  }, value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getFirstString(...values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }

  return "";
}

function readDisplayCustomizations(input?: ColumnWidget["input"]): DisplayCustomizations {
  const raw = stripDisplayCustomizations(input);
  const displayCustomizations = (input as Record<string, any> | undefined)?.display_customizations;
  const order = Array.isArray(displayCustomizations?.order)
    ? displayCustomizations.order.filter((value: unknown): value is string => typeof value === "string")
    : [];
  const hidden = Array.isArray(displayCustomizations?.hidden)
    ? displayCustomizations.hidden.filter((value: unknown): value is string => typeof value === "string")
    : [];
  if (Object.keys(raw ?? {}).length === 0 && order.length === 0 && hidden.length === 0) {
    return {};
  }
  return { order, hidden };
}

function stripDisplayCustomizations(input?: ColumnWidget["input"]) {
  if (!input || typeof input !== "object") return {};
  const { display_customizations: _displayCustomizations, ...rest } = input as Record<string, any>;
  return rest;
}

function buildDisplayCustomizationsPayload(opts: {
  order: string[];
  hidden: string[];
  supportsReorder: boolean;
  supportsHide: boolean;
}): DisplayCustomizations | null {
  const order = opts.supportsReorder ? opts.order.filter(Boolean) : [];
  const hidden = opts.supportsHide ? Array.from(new Set(opts.hidden.filter(Boolean))) : [];

  if (order.length === 0 && hidden.length === 0) {
    return null;
  }

  return {
    order: order.length > 0 ? order : undefined,
    hidden: hidden.length > 0 ? hidden : undefined,
  };
}

function mergePersistedInput(
  baseInput: Record<string, any>,
  opts: {
    order: string[];
    hidden: string[];
    supportsReorder: boolean;
    supportsHide: boolean;
  },
) {
  const nextInput = { ...baseInput };
  const customizations = buildDisplayCustomizationsPayload(opts);

  if (customizations) {
    nextInput.display_customizations = customizations;
  } else {
    delete nextInput.display_customizations;
  }

  return nextInput;
}

function normalizeWidgetInput(
  input: ColumnWidget["input"] | undefined,
  _defaultInput: Record<string, any>,
) {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const nextInput = { ...(input as Record<string, any>) };
  return Object.keys(nextInput).length > 0 ? nextInput : undefined;
}

function isDisplayCustomizations(value: unknown): value is DisplayCustomizations {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const order = candidate.order;
  const hidden = candidate.hidden;
  return (
    (order === undefined || Array.isArray(order))
    && (hidden === undefined || Array.isArray(hidden))
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

      const nextWidget: ColumnWidget = {
        id: createWidgetId(),
        type: key,
        configKey: source.integrationId ? `${source.integrationId}#${key}` : key,
        properties: {},
        input: undefined,
      };
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
              className="grid gap-0"
              style={{ gridTemplateColumns: getPreviewGridTemplate(template) }}
            >
              {(["left", "middle", "right"] as ColumnName[])
                .filter((column) => enabledColumns.includes(column))
                .map((column) => {
                  const isMiddle = column === "middle";
                  return (
                    <div
                      key={column}
                      className={`min-h-65 border-white/20 p-3 ${
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
                                <div className="mb-2 h-22.5 rounded-lg border-2 border-dashed border-blue-400/60 bg-blue-500/10" />
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
                                      const persistedInput = normalizeWidgetInput(input, source?.input ?? {});
                                      return { ...item, input: persistedInput };
                                    }),
                                  }));
                                }}
                              />
                            </div>
                          ))}
                          {/* Drop preview at end of list */}
                          {dragOver?.zone === column && dragOver.index === columns[column].length && (
                            <div className="h-22.5 rounded-lg border-2 border-dashed border-blue-400/60 bg-blue-500/10" />
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
              ...("properties" in activeWidget ? (activeWidget as ColumnWidget).properties : {}),
              ...((activeWidget as ColumnWidget).input ?? {}),
            };
            return (
              <div className="w-48 rounded-lg overflow-hidden shadow-2xl opacity-90 rotate-1 scale-105">
                {renderWidget({ type, params, className: "h-[90px] w-full" })}
              </div>
            );
          })()}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
