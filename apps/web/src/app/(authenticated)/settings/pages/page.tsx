
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePageConfig } from "@/hooks/usePageConfig";
import { updatePageConfigAction } from '@/lib/apiClient';
import { getConsumerDataAction } from '@/lib/apiClient';
import { getUserGlanceableAction, getUserWidgetsAction } from '@/lib/apiClient';
import useAuth from "@/context/useAuth";
import { PageSelectTabs } from "@/components/settings/pages/PageSelectTabs";
import { TemplateOptions } from "@/components/settings/pages/TemplateOptions";
import { DashboardWidgetPreview } from "@/components/settings/pages/DashboardWidgetPreview";
import {
  buildPageConfigPatch,
  enabledColumnsFromTemplate,
  findMainClock,
  flattenWidgetCatalog,
  getDefaultGlanceableSelection,
  inferTemplateFromColumns,
  normalizeColumns,
  readClockGlanceables,
   type ColumnName,
   type ColumnWidget,
   type ClockGlanceableSelection,
  type GlanceableSide,
  type TemplateId,
  type WidgetDefinition,
} from "@/components/settings/pages/utils";

const DEFAULT_CLOCK_STYLE: Record<string, any> = {
  color: "#ffffff",
  defaultFont: "Bitcount Grid Single",
  fontWeight: 400,
  frosted: false,
  letterSpacing: 2,
  opacity: 1,
  outlineColor: "#3b3232",
  outlineEnabled: false,
  outlineWidth: 2,
  roundness: 0,
};

type GlanceableCatalogItem = {
  type: string;
  name: string;
  integrationId?: string;
  integrationName?: string;
  integrationDisplayName?: string;
  appName?: string;
  exampleProps: Record<string, any>;
};

function getGlanceableGroupName(entry: Partial<GlanceableCatalogItem> & Record<string, any>) {
  const rawLabel = entry.integrationDisplayName ?? entry.integrationName ?? entry.appName ?? entry.app;
  if (typeof rawLabel === "string" && rawLabel.trim()) {
    return rawLabel.trim();
  }

  return String(entry.type === "weather" ? "Weather" : "Builtin");
}

export default function SettingsPagesPage() {
  const { pageConfig: homeConfig, refreshConfig: refreshHomeConfig } = usePageConfig({
    pageName: "home",
  });

  const pages = useMemo<string[]>(() => {
    const configuredPages = Array.isArray(homeConfig?.pages) ? homeConfig.pages : [];
    return configuredPages.length > 0 ? configuredPages : ["home"];
  }, [homeConfig?.pages]);

  const [selectedPage, setSelectedPage] = useState("home");
  const { pageConfig: selectedConfig } = usePageConfig({
    pageName: selectedPage,
  });
  const { withAuth } = useAuth();

  const [template, setTemplate] = useState<TemplateId>("main");
  const [columns, setColumns] = useState<Record<ColumnName, ColumnWidget[]>>({
    left: [],
    middle: [],
    right: [],
  });
  const [allWidgets, setAllWidgets] = useState<Record<string, WidgetDefinition[]>>({});
  const [selectedWidgetCategory, setSelectedWidgetCategory] = useState<string>("clock");
  const [selectedClockPart, setSelectedClockPart] = useState<GlanceableSide | "clock">("left");
  const [clockGlanceables, setClockGlanceables] = useState<Record<string, any>>({});
  const [clockSelection, setClockSelection] = useState<ClockGlanceableSelection>({
    left: [],
    right: [],
  });
  const [clockStyle, setClockStyle] = useState<Record<string, any>>(DEFAULT_CLOCK_STYLE);
  const [fonts, setFonts] = useState<Array<{ name: string; path: string }>>([]);
  const [glanceablesCatalog, setGlanceablesCatalog] = useState<GlanceableCatalogItem[]>([]);

  const hasLoadedConfigRef = useRef(false);
  const lastSavedSignatureRef = useRef("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const widgetCatalog = useMemo(() => flattenWidgetCatalog(allWidgets), [allWidgets]);
  const widgetCategories = useMemo(() => Object.keys(allWidgets), [allWidgets]);
  const enabledColumns = useMemo(() => enabledColumnsFromTemplate(template), [template]);
  const hasMainClock = useMemo(() => !!findMainClock(columns), [columns]);

  useEffect(() => {
    fetch("/fonts/index.json")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setFonts([{ name: "Default", path: "" }, ...data]);
        }
      })
      .catch(() => setFonts([{ name: "Default", path: "" }]));
  }, []);

  useEffect(() => {
    void withAuth((auth) => getUserWidgetsAction(auth))
      .then((data) => {
        const casted = (data ?? {}) as Record<string, WidgetDefinition[]>;
        setAllWidgets(casted);
        const categories = Object.keys(casted);
        if (categories.length > 0) {
          setSelectedWidgetCategory((prev) => (categories.includes(prev) ? prev : categories[0]));
        }
      })
      .catch(() => setAllWidgets({}));
  }, [withAuth]);

  useEffect(() => {
      void withAuth((auth) => getUserGlanceableAction(auth))
      .then((data) => {
        const catalog = Array.isArray(data)
          ? data.map((entry: any) => ({
              type: String(entry?.type ?? "weather"),
              name: String(entry?.displayName ?? entry?.name ?? entry?.type ?? "Glanceable"),
              appName: getGlanceableGroupName(entry),
              integrationName: typeof entry?.integrationName === "string" ? entry.integrationName : undefined,
              integrationDisplayName: typeof entry?.integrationDisplayName === "string" ? entry.integrationDisplayName : undefined,
              integrationId:
                typeof entry?.integrationId === "string" ? entry.integrationId : undefined,
              exampleProps: (entry?.exampleProps && typeof entry.exampleProps === "object")
                ? entry.exampleProps
                : {},
            }))
          : [];
        setGlanceablesCatalog(catalog);
      })
      .catch(() => setGlanceablesCatalog([]));
  }, [withAuth]);

  useEffect(() => {
    const normalizedColumns = normalizeColumns(selectedConfig);
    const inferredTemplate =
      selectedConfig?.template === "main" ||
      selectedConfig?.template === "left-middle" ||
      selectedConfig?.template === "right-middle"
        ? (selectedConfig.template as TemplateId)
        : inferTemplateFromColumns(selectedConfig?.columns);

    setColumns(normalizedColumns);
    setTemplate(inferredTemplate === "right-middle" ? "main" : inferredTemplate);

    const fallbackGlanceables = Array.isArray(selectedConfig?.glanceables) ? selectedConfig.glanceables : [];
    const nextClock = readClockGlanceables(normalizedColumns, fallbackGlanceables, glanceablesCatalog);
    setClockGlanceables(nextClock.map);
    const defaultSelection = getDefaultGlanceableSelection(glanceablesCatalog);
    const resolvedSelection =
      nextClock.selected.left.length || nextClock.selected.right.length
        ? nextClock.selected
        : defaultSelection;
    setClockSelection(resolvedSelection);

    const mainClock = findMainClock(normalizedColumns);
    const configClockStyle = mainClock?.properties?.["clock-style"];
    const appearanceClock = selectedConfig?.appearance?.clock;
    const nextClockStyle = {
      ...DEFAULT_CLOCK_STYLE,
      ...(appearanceClock && typeof appearanceClock === "object" ? appearanceClock : {}),
      ...(configClockStyle && typeof configClockStyle === "object" ? configClockStyle : {}),
    };
    setClockStyle(nextClockStyle);

    lastSavedSignatureRef.current = JSON.stringify(
      buildPageConfigPatch(
        inferredTemplate === "right-middle" ? "main" : inferredTemplate,
        normalizedColumns,
        resolvedSelection,
        nextClock.map,
        nextClockStyle,
        glanceablesCatalog,
      ),
    );
    hasLoadedConfigRef.current = resolvedSelection.left.length > 0 || resolvedSelection.right.length > 0;
  }, [glanceablesCatalog, selectedConfig]);

  useEffect(() => {
    hasLoadedConfigRef.current = false;
    lastSavedSignatureRef.current = "";

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, [selectedPage]);

  const handleCreatePage = async (pageName: string) => {
    const normalized = pageName.trim().toLowerCase();
    if (!normalized) return;
    if (pages.includes(normalized)) {
      setSelectedPage(normalized);
      return;
    }

    const nextPages = Array.from(new Set([...(pages ?? []), normalized]));
    await withAuth((auth) => updatePageConfigAction(auth, "home", { pages: nextPages }));
    const defaultSelection = getDefaultGlanceableSelection(glanceablesCatalog);
    await withAuth((auth) =>
      updatePageConfigAction(auth, normalized, {
        template: "main",
        columns: {
          left: { placeholder: { index: 0, height: "$main-clock" } },
          middle: {
            "main-clock": {
              index: 0,
              glanceables: {
                slots: Object.fromEntries((["left", "right"] as GlanceableSide[]).map((side) => [
                  side,
                  defaultSelection[side].map((selection) => ({ type: selection.type, params: {} })),
                ])),
              },
            },
            "search-bar": { index: 1 },
            "link-view": { index: 2 },
          },
          right: { placeholder: { index: 0, height: "$main-clock" } },
        },
      }),
    );

    await refreshHomeConfig();
    setSelectedPage(normalized);
  };

  const pageConfigPatch = useMemo(
    () => buildPageConfigPatch(template, columns, clockSelection, clockGlanceables, clockStyle, glanceablesCatalog),
    [clockGlanceables, clockSelection, clockStyle, columns, template, glanceablesCatalog],
  );

  const pageConfigSignature = useMemo(() => JSON.stringify(pageConfigPatch), [pageConfigPatch]);

  const persistPageConfigPatch = useCallback(
    async (patch: ReturnType<typeof buildPageConfigPatch>) => {
      const signature = JSON.stringify(patch);

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      console.log("[SettingsPagesPage] Persisting page config patch", {
        page: selectedPage,
        patch,
      });

      await withAuth((auth) =>
        updatePageConfigAction(auth, selectedPage, {
          ...patch,
        }),
      );

      lastSavedSignatureRef.current = signature;

      return signature;
    },
    [selectedPage, withAuth],
  );

  const handleSave = useCallback(async () => {
    return persistPageConfigPatch(pageConfigPatch);
  }, [pageConfigPatch, persistPageConfigPatch]);

  const handlePersistReorderedColumns = useCallback(
    (nextColumns: Record<ColumnName, ColumnWidget[]>) => {
      return persistPageConfigPatch(
        buildPageConfigPatch(
          template,
          nextColumns,
          clockSelection,
          clockGlanceables,
          clockStyle,
          glanceablesCatalog,
        ),
      ).then(() => undefined);
    },
    [clockGlanceables, clockSelection, clockStyle, template, glanceablesCatalog, persistPageConfigPatch],
  );

  const loadWidgetPreviewData = useCallback(
    async (widgetKey: string, input?: Record<string, any>) => {
      const payload = await withAuth((auth) =>
        getConsumerDataAction(auth, widgetKey, input ?? {}, {
          type: "widget",
          isPreview: true,
        }),
      ) as any;

      return payload ?? null;
    },
    [withAuth],
  );

  useEffect(() => {
    if (!hasLoadedConfigRef.current) {
      return;
    }

    if (pageConfigSignature === lastSavedSignatureRef.current) {
      return;
    }

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void handleSave();
    }, 350);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [handleSave, pageConfigSignature]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Pages</h1>
      </div>

      <PageSelectTabs
        pages={pages}
        selectedPage={selectedPage}
        onSelectPage={setSelectedPage}
        onCreatePage={handleCreatePage}
      />

      <h2 className="text-lg font-semibold">Template</h2>
      <TemplateOptions template={template} onTemplateChange={setTemplate} />

      <DashboardWidgetPreview
        template={template}
        columns={columns}
        setColumns={setColumns}
        onPersistColumns={handlePersistReorderedColumns}
        loadWidgetPreviewData={loadWidgetPreviewData}
        enabledColumns={enabledColumns}
        widgetCatalog={widgetCatalog}
        widgetCategories={widgetCategories}
        selectedWidgetCategory={selectedWidgetCategory}
        setSelectedWidgetCategory={setSelectedWidgetCategory}
        hasMainClock={hasMainClock}
        glanceablesCatalog={glanceablesCatalog}
        selectedClockPart={selectedClockPart}
        setSelectedClockPart={setSelectedClockPart}
        clockSelection={clockSelection}
        setClockSelection={setClockSelection}
        clockGlanceables={clockGlanceables}
        setClockGlanceables={setClockGlanceables}
        clockStyle={clockStyle}
        setClockStyle={setClockStyle}
        fonts={fonts}
      />
    </div>
  );
}
