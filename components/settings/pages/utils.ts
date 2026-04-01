import { arrayMove } from "@dnd-kit/sortable";

export type GlanceableDefinition = {
  displayName?: string;
  description?: string;
  exampleProps?: Record<string, any>;
};

export type WidgetDefinition = {
  slug: string;
  name?: string;
  description?: string;
  template?: string;
  properties?: Record<string, any>;
  data?: {
    source?: string;
    input?: Record<string, any>;
  };
  preview?: {
    template?: string;
    properties?: Record<string, any>;
  };
};

export type TemplateId = "main" | "left-middle" | "right-middle";
export type ColumnName = "left" | "middle" | "right";
export type GlanceableSide = "left" | "right";

export type ColumnWidget = {
  id: string;
  type: string;
  properties: Record<string, any>;
  data?: {
    source?: string;
    input?: Record<string, any>;
  };
};

export type WidgetCatalogItem = {
  category: string;
  slug: string;
  name: string;
  description: string;
  preview: {
    template?: string;
    properties?: Record<string, any>;
  };
  properties: Record<string, any>;
  data?: {
    source?: string;
    input?: Record<string, any>;
  };
};

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
    widgets.map((widget) => ({
      category,
      slug: widget.slug,
      name: widget.name ?? widget.slug,
      description: widget.description ?? "",
      preview: widget.preview ?? {},
      properties: widget.properties ?? {},
      data: widget.data ?? undefined,
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

export function hasEditableWidgetData(widget: ColumnWidget) {
  const data = widget.data;
  if (!data || typeof data !== "object") {
    return false;
  }

  const hasSource = typeof data.source === "string" && data.source.trim().length > 0;
  const hasInput = !!data.input && typeof data.input === "object" && Object.keys(data.input).length > 0;
  return hasSource || hasInput;
}

export function normalizeColumns(config: any): Record<ColumnName, ColumnWidget[]> {
  const columns = config?.columns;
  if (columns && typeof columns === "object") {
    return {
      left: Object.entries(columns.left ?? {}).map(([type, cfg]) => ({
        id: createWidgetId(),
        type,
        properties:
          (cfg as Record<string, any>) && typeof cfg === "object"
            ? { ...((cfg as Record<string, any>).properties ?? cfg) }
            : {},
        data: (cfg as Record<string, any>)?.data,
      })),
      middle: Object.entries(columns.middle ?? {}).map(([type, cfg]) => ({
        id: createWidgetId(),
        type,
        properties:
          (cfg as Record<string, any>) && typeof cfg === "object"
            ? { ...((cfg as Record<string, any>).properties ?? cfg) }
            : {},
        data: (cfg as Record<string, any>)?.data,
      })),
      right: Object.entries(columns.right ?? {}).map(([type, cfg]) => ({
        id: createWidgetId(),
        type,
        properties:
          (cfg as Record<string, any>) && typeof cfg === "object"
            ? { ...((cfg as Record<string, any>).properties ?? cfg) }
            : {},
        data: (cfg as Record<string, any>)?.data,
      })),
    };
  }

  const widgetsColumns = Array.isArray(config?.widgets) ? config.widgets : [[], [], []];
  return {
    left: (widgetsColumns[0] ?? []).map((widget: any) => ({
      id: widget?.id ?? createWidgetId(),
      type: widget?.type ?? "placeholder",
      properties: widget?.properties ?? {},
      data: widget?.data,
    })),
    middle: (widgetsColumns[1] ?? []).map((widget: any) => ({
      id: widget?.id ?? createWidgetId(),
      type: widget?.type ?? "placeholder",
      properties: widget?.properties ?? {},
      data: widget?.data,
    })),
    right: (widgetsColumns[2] ?? []).map((widget: any) => ({
      id: widget?.id ?? createWidgetId(),
      type: widget?.type ?? "placeholder",
      properties: widget?.properties ?? {},
      data: widget?.data,
    })),
  };
}

export function findMainClock(columns: Record<ColumnName, ColumnWidget[]>) {
  return columns.middle.find((widget) => widget.type === "main-clock");
}

export function readClockGlanceables(
  columns: Record<ColumnName, ColumnWidget[]>,
  fallbackGlanceables: any[],
) {
  const mainClock = findMainClock(columns);
  const overrides = mainClock?.properties?.glanceables &&
      typeof mainClock.properties.glanceables === "object"
    ? (mainClock.properties.glanceables as Record<string, any>)
    : undefined;

  const fallbackTypes = fallbackGlanceables
    .map((entry) => entry?.type)
    .filter((entry: unknown): entry is string => typeof entry === "string");

  const selectedFromOverrides = overrides ? Object.keys(overrides) : [];
  const left = selectedFromOverrides[0] ?? fallbackTypes[0] ?? "date";
  const right = selectedFromOverrides[1] ?? fallbackTypes[1] ?? "weather";

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
) {
  const nextColumnsObject: Record<string, Record<string, any>> = {};
  const templateColumns = enabledColumnsFromTemplate(template);

  templateColumns.forEach((column) => {
    nextColumnsObject[column] = {};
    columns[column].forEach((widget) => {
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

      if (widget.data) {
        widgetProps.data = widget.data;
      }

      nextColumnsObject[column][widget.type] = widgetProps;
    });
  });

  const nextWidgets = [columns.left, columns.middle, columns.right].map(
    (column) =>
      column.map((item) => ({
        id: item.id,
        type: item.type,
        properties: item.properties ?? {},
        data: item.data ?? undefined,
      })),
  );

  return {
    template,
    columns: nextColumnsObject,
    widgets: nextWidgets,
  };
}