import { arrayMove } from "@dnd-kit/sortable";

export type GlanceableDefinition = {
  displayName?: string;
  description?: string;
  exampleProps?: Record<string, any>;
};

export type WidgetDefinition = {
  key: string;
  index?: number;
  data?: {
    input?: Record<string, any>;
  };
  name?: string;
  description?: string;
  template?: string;
  properties?: Record<string, any>;
  input?: Record<string, any>;
  preview?: {
    template?: string;
    properties?: Record<string, any>;
  };
};

export type TemplateId = "main" | "left-middle" | "right-middle";
export type ColumnName = "left" | "middle" | "right";
export type GlanceableSide = "left" | "right";

export type GlanceableCatalogItem = {
  type: string;
  name: string;
  exampleProps: Record<string, any>;
};

export type ColumnWidget = {
  id: string;
  type: string;
  index?: number;
  properties: Record<string, any>;
  input?: Record<string, any>;
};

export type WidgetCatalogItem = {
  category: string;
  key: string;
  index?: number;
  name: string;
  description: string;
  preview: {
    template?: string;
    properties?: Record<string, any>;
  };
  properties: Record<string, any>;
  input?: Record<string, any>;
};

function sortByIndex<T extends { index?: number }>(items: T[]) {
  return [...items]
    .map((item, position) => ({ item, position }))
    .sort((left, right) => {
      const leftIndex = typeof left.item.index === "number" && Number.isFinite(left.item.index)
        ? left.item.index
        : Number.MAX_SAFE_INTEGER;
      const rightIndex = typeof right.item.index === "number" && Number.isFinite(right.item.index)
        ? right.item.index
        : Number.MAX_SAFE_INTEGER;

      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      return left.position - right.position;
    })
    .map(({ item }) => item);
}

function normalizeWidgetConfig(config: unknown) {
  const record = config && typeof config === "object" && !Array.isArray(config)
    ? (config as Record<string, any>)
    : {};
  const index = typeof record.index === "number" && Number.isFinite(record.index)
    ? record.index
    : undefined;
  const input = record.input && typeof record.input === "object"
    ? (record.input as Record<string, any>)
    : record.data?.input && typeof record.data.input === "object"
      ? (record.data.input as Record<string, any>)
      : undefined;
  const properties = record.properties && typeof record.properties === "object"
    ? { ...(record.properties as Record<string, any>) }
    : Object.fromEntries(
        Object.entries(record).filter(([key]) => ![
          "id",
          "type",
          "key",
          "index",
          "name",
          "description",
          "template",
          "preview",
          "input",
          "data",
          "properties",
          "category",
          "slug",
        ].includes(key)),
      );

  return { index, input, properties };
}

export const TEMPLATE_OPTIONS: Array<{ id: TemplateId; label: string }> = [
  { id: "main", label: "Default" },
  { id: "left-middle", label: "Left Sidebar" },
];

export const COLUMN_LABELS: Record<ColumnName, string> = {
  left: "Left",
  middle: "Middle",
  right: "Right",
};

export const EMPTY_COLUMNS: Record<ColumnName, ColumnWidget[]> = {
  left: [],
  middle: [],
  right: [],
};

export function createWidgetId() {
  return Math.random().toString(36).slice(2, 12);
}

export function flattenWidgetCatalog(widgetsData: Record<string, WidgetDefinition[]>) {
  return Object.entries(widgetsData).flatMap(([category, widgets]) =>
    sortByIndex(widgets).map((widget) => ({
      category,
      key: widget.key,
      index: widget.index,
      name: widget.name ?? widget.key,
      description: widget.description ?? "",
      preview: widget.preview ?? {},
      properties: widget.properties ?? {},
      input:
        widget.input && typeof widget.input === "object"
          ? (widget.input as Record<string, any>)
          : widget.data?.input && typeof widget.data.input === "object"
            ? (widget.data.input as Record<string, any>)
            : undefined,
    }))
  );
}

export function inferTemplateFromColumns(
  columns: Record<string, any> | undefined,
): TemplateId {
  const hasLeft = !!columns?.left;
  const hasRight = !!columns?.right;

  if (hasLeft && hasRight) return "main";
  if (hasLeft) return "left-middle";
  if (hasRight) return "right-middle";
  return "main";
}

export function enabledColumnsFromTemplate(template: TemplateId): ColumnName[] {
  if (template === "left-middle") return ["left", "middle"];
  if (template === "right-middle") return ["middle", "right"];
  return ["left", "middle", "right"];
}

export function hasEditableWidgetData(widget: ColumnWidget, catalogItem?: WidgetCatalogItem) {
  // Prefer checking the widget definition from the catalog for editable input fields.
  if (catalogItem?.key == "main-clock") return false
  else if (catalogItem) {
    const defInput = (catalogItem.input ?? (catalogItem as any).data?.input) as
      | Record<string, any>
      | undefined;

    if (defInput && typeof defInput === "object") {
      return Object.keys(defInput).length > 0;
    }
  }

  // Fallback to the instance's input if no catalog definition is present.
  const input = widget.input;
  if (!input || typeof input !== "object") {
    return false;
  }

  return Object.keys(input).length > 0;
}

export function normalizeColumns(config: any): Record<ColumnName, ColumnWidget[]> {
  const columns = config?.columns;
  if (columns && typeof columns === "object") {
    const normalizeColumnEntries = (columnEntries: Record<string, any> | undefined) =>
      sortByIndex(Object.entries(columnEntries ?? {}).map(([type, cfg]) => {
        const normalized = normalizeWidgetConfig(cfg);
        return {
          type,
          index: normalized.index,
          properties: normalized.properties,
          input: normalized.input,
        };
      })).map((entry) => ({
        id: createWidgetId(),
        type: entry.type,
        index: entry.index,
        properties: entry.properties,
        input: entry.input,
      }));

    return {
      left: normalizeColumnEntries(columns.left),
      middle: normalizeColumnEntries(columns.middle),
      right: normalizeColumnEntries(columns.right),
    };
  }

  const widgetsColumns = Array.isArray(config?.widgets) ? config.widgets : [[], [], []];
  return {
    left: sortByIndex((widgetsColumns[0] ?? []).map((widget: any) => {
      const normalized = normalizeWidgetConfig(widget);
      return {
        id: widget?.id ?? createWidgetId(),
        type: widget?.type ?? "placeholder",
        index: normalized.index,
        properties: normalized.properties,
        input: normalized.input,
      };
    })),
    middle: sortByIndex((widgetsColumns[1] ?? []).map((widget: any) => {
      const normalized = normalizeWidgetConfig(widget);
      return {
        id: widget?.id ?? createWidgetId(),
        type: widget?.type ?? "placeholder",
        index: normalized.index,
        properties: normalized.properties,
        input: normalized.input,
      };
    })),
    right: sortByIndex((widgetsColumns[2] ?? []).map((widget: any) => {
      const normalized = normalizeWidgetConfig(widget);
      return {
        id: widget?.id ?? createWidgetId(),
        type: widget?.type ?? "placeholder",
        index: normalized.index,
        properties: normalized.properties,
        input: normalized.input,
      };
    })),
  };
}

export function findMainClock(columns: Record<ColumnName, ColumnWidget[]>) {
  return columns.middle.find((widget) => widget.type === "main-clock");
}

export function readClockGlanceables(
  columns: Record<ColumnName, ColumnWidget[]>,
  fallbackGlanceables: any[],
  catalogGlanceables: GlanceableCatalogItem[] = [],
) {
  const mainClock = findMainClock(columns);
  const overrides = mainClock?.properties?.glanceables &&
      typeof mainClock.properties.glanceables === "object"
    ? (mainClock.properties.glanceables as Record<string, any>)
    : undefined;

  const fallbackTypes = [
    ...fallbackGlanceables,
    ...catalogGlanceables,
  ]
    .map((entry) => entry?.type)
    .filter((entry: unknown): entry is string => typeof entry === "string");

  const selectedFromOverrides = overrides ? Object.keys(overrides) : [];
  const left = selectedFromOverrides[0] ?? fallbackTypes[0] ?? "";
  const right = selectedFromOverrides[1] ?? fallbackTypes[1] ?? fallbackTypes[0] ?? "";

  const map: Record<string, any> = {};
  if (overrides && Object.keys(overrides).length > 0) {
    map[left] = overrides[left] ?? null;
    map[right] = overrides[right] ?? null;
  } else {
    map[left] = null;
    map[right] = null;
  }

  return {
    selected: { left, right } as Record<GlanceableSide, string>,
    map,
  };
}

export function getDefaultGlanceableSelection(catalogGlanceables: GlanceableCatalogItem[]) {
  const fallbackTypes = catalogGlanceables
    .map((entry) => entry?.type)
    .filter((entry): entry is string => typeof entry === "string");

  return {
    left: fallbackTypes[0] ?? "",
    right: fallbackTypes[1] ?? fallbackTypes[0] ?? "",
  };
}

export function moveItem(
  columns: Record<ColumnName, ColumnWidget[]>,
  activeId: string,
  overId: string,
  overColumn: ColumnName,
) {
  const findLocation = (widgetId: string) => {
    for (const column of Object.keys(columns) as ColumnName[]) {
      const index = columns[column].findIndex((item) => item.id === widgetId);
      if (index !== -1) {
        return { column, index };
      }
    }
    return null;
  };

  const activeLocation = findLocation(activeId);
  if (!activeLocation) return columns;

  const isColumnSentinel = overId.startsWith("column:");
  const overWidgetLocation = isColumnSentinel ? null : findLocation(overId);
  const targetColumn = overWidgetLocation?.column ?? overColumn;
  const targetIndex = overWidgetLocation?.index ?? columns[targetColumn].length;

  if (activeLocation.column === targetColumn) {
    return {
      ...columns,
      [targetColumn]: arrayMove(
        columns[targetColumn],
        activeLocation.index,
        targetIndex,
      ),
    };
  }

  const next = {
    left: [...columns.left],
    middle: [...columns.middle],
    right: [...columns.right],
  };

  const [moved] = next[activeLocation.column].splice(activeLocation.index, 1);
  if (!moved) return columns;

  const adjustedTargetIndex =
    activeLocation.index < targetIndex && activeLocation.column === targetColumn
      ? targetIndex - 1
      : targetIndex;

  next[targetColumn].splice(adjustedTargetIndex, 0, moved);
  return next;
}

export function buildPageConfigPatch(
  template: TemplateId,
  columns: Record<ColumnName, ColumnWidget[]>,
  clockSelection: Record<GlanceableSide, string>,
  clockGlanceables: Record<string, any>,
  clockStyle: Record<string, any>,
  widgetCatalog?: WidgetCatalogItem[],
) {
  const nextColumnsObject: Record<string, Record<string, any>> = {};
  const templateColumns = enabledColumnsFromTemplate(template);

  templateColumns.forEach((column) => {
    nextColumnsObject[column] = {};
    columns[column].forEach((widget, index) => {
      const widgetProps = { ...(widget.properties ?? {}) };

      if (widget.type === "main-clock") {
        const left = clockSelection.left;
        const right = clockSelection.right;
        widgetProps.glanceables = {
          [left]: clockGlanceables[left] ?? null,
          [right]: clockGlanceables[right] ?? null,
        };
        widgetProps["clock-style"] = { ...clockStyle };
      }

      nextColumnsObject[column][widget.type] =
        widget.input && Object.keys(widget.input).length > 0
          ? { index, ...widget.input }
          : { index, ...widgetProps };
    });
  });

  return {
    template,
    columns: nextColumnsObject
  };
}