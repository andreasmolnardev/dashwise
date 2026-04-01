"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePageConfig } from "@/hooks/usePageConfig";
import { updatePageConfigAction } from "@/app/actions/pageConfigs";
import { getUserGlanceablesAction, getUserWidgetsAction } from "@/app/actions/widgets";
import useAuth from "@/context/useAuth";
import { PageSelectTabs } from "@/components/settings/pages/PageSelectTabs";
import { TemplateOptions } from "@/components/settings/pages/TemplateOptions";
import { EditGlanceablesView } from "@/components/settings/pages/EditGlanceablesView";
import { DashboardWidgetPreview } from "@/components/settings/pages/DashboardWidgetPreview";
import {
  buildPageConfigPatch,
  enabledColumnsFromTemplate,
  findMainClock,
  flattenWidgetCatalog,
  inferTemplateFromColumns,
  normalizeColumns,
  readClockGlanceables,
  type ColumnName,
  type ColumnWidget,
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
  exampleProps: Record<string, any>;
};

export default function SettingsPagesPage() {
  const { config: homeConfig, refreshConfig: refreshHomeConfig } = usePageConfig({
    pageName: "home",
  });

  const pages = useMemo<string[]>(() => {
    const configuredPages = Array.isArray(homeConfig?.pages) ? homeConfig.pages : [];
    return configuredPages.length > 0 ? configuredPages : ["home"];
  }, [homeConfig?.pages]);

  const [selectedPage, setSelectedPage] = useState("home");
  const { config: selectedConfig, refreshConfig: refreshSelectedConfig } = usePageConfig({
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
  const [clockSelection, setClockSelection] = useState<Record<GlanceableSide, string>>({
    left: "date",
    right: "weather",
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
    void withAuth((auth) => getUserGlanceablesAction(auth))
      .then((data) => {
        const catalog = Array.isArray(data)
          ? data.map((entry: any) => ({
              type: String(entry?.type ?? "weather"),
              name: String(entry?.displayName ?? entry?.name ?? entry?.type ?? "Glanceable"),
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
    const nextClock = readClockGlanceables(normalizedColumns, fallbackGlanceables);
    setClockGlanceables(nextClock.map);
    setClockSelection(nextClock.selected);

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
        nextClock.selected,
        nextClock.map,
        nextClockStyle,
      ),
    );
    hasLoadedConfigRef.current = true;
  }, [selectedConfig]);

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
    await withAuth((auth) =>
      updatePageConfigAction(auth, normalized, {
        template: "main",
        columns: {
          left: { placeholder: { height: "$main-clock" } },
          middle: {
            "main-clock": { glanceables: { date: null, weather: null } },
            "search-bar": {},
            "link-view": {},
          },
          right: { placeholder: { height: "$main-clock" } },
        },
      }),
    );

    await refreshHomeConfig();
    setSelectedPage(normalized);
  };

  const pageConfigPatch = useMemo(
    () => buildPageConfigPatch(template, columns, clockSelection, clockGlanceables, clockStyle),
    [clockGlanceables, clockSelection, clockStyle, columns, template],
  );

  const pageConfigSignature = useMemo(() => JSON.stringify(pageConfigPatch), [pageConfigPatch]);

  const handleSave = useCallback(async () => {
    const signature = JSON.stringify(pageConfigPatch);

    await withAuth((auth) =>
      updatePageConfigAction(auth, selectedPage, {
        ...pageConfigPatch,
      }),
    );
    lastSavedSignatureRef.current = signature;
    await refreshSelectedConfig();
    return signature;
  }, [pageConfigPatch, refreshSelectedConfig, selectedPage, withAuth]);

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

      {hasMainClock ? (
        <EditGlanceablesView
          hasMainClock={hasMainClock}
          glanceablesCatalog={glanceablesCatalog}
          selectedClockPart={selectedClockPart}
          setSelectedClockPart={setSelectedClockPart}
          clockSelection={clockSelection}
          clockGlanceables={clockGlanceables}
          setClockGlanceables={setClockGlanceables}
          clockStyle={clockStyle}
          setClockStyle={setClockStyle}
          fonts={fonts}
        />
      ) : null}

      <DashboardWidgetPreview
        template={template}
        columns={columns}
        setColumns={setColumns}
        enabledColumns={enabledColumns}
        widgetCatalog={widgetCatalog}
        widgetCategories={widgetCategories}
        selectedWidgetCategory={selectedWidgetCategory}
        setSelectedWidgetCategory={setSelectedWidgetCategory}
      />
    </div>
  );
}
