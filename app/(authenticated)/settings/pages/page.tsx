"use client";

import { useEffect, useMemo, useState } from "react";
import { usePageConfig } from "@/hooks/usePageConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { updatePageConfigAction } from "@/app/actions/pageConfigs";
import useAuth from "@/context/useAuth";
import rawGlanceablesData from "@/public/glanceables.json";
import rawWidgetsData from "@/public/widgets.json";

type GlanceableDefinition = {
	displayName?: string;
};

type WidgetDefinition = {
	slug: string;
	name?: string;
};

type WidgetObject = {
	id: string;
	type: string;
	properties: Record<string, any>;
};

function createWidgetId() {
	return Math.random().toString(36).slice(2, 12);
}

function flattenWidgetCatalog(widgetsData: Record<string, WidgetDefinition[]>) {
	return Object.entries(widgetsData).flatMap(([category, widgets]) =>
		widgets.map((widget) => ({
			category,
			slug: widget.slug,
			name: widget.name ?? widget.slug,
		}))
	);
}

export default function SettingsPagesPage() {
	const { config: homeConfig, refreshConfig: refreshHomeConfig } = usePageConfig({ pageName: "home" });
	const pages = useMemo<string[]>(() => {
		const configuredPages = Array.isArray(homeConfig?.pages) ? homeConfig.pages : [];
		return configuredPages.length > 0 ? configuredPages : ["home"];
	}, [homeConfig?.pages]);

	const [selectedPage, setSelectedPage] = useState("home");
	const { config: selectedConfig, refreshConfig: refreshSelectedConfig } = usePageConfig({ pageName: selectedPage });
	const { withAuth } = useAuth();

	const [newPageName, setNewPageName] = useState("");
	const [selectedGlanceables, setSelectedGlanceables] = useState<string[]>([]);
	const [selectedWidgetTypes, setSelectedWidgetTypes] = useState<string[]>([]);
	const [isSaving, setIsSaving] = useState(false);

	const glanceablesCatalog = useMemo(() => {
		const defs = rawGlanceablesData as Record<string, GlanceableDefinition>;
		return Object.entries(defs).map(([type, def]) => ({
			type,
			name: def.displayName ?? type,
		}));
	}, []);

	const widgetCatalog = useMemo(() => {
		return flattenWidgetCatalog(rawWidgetsData as Record<string, WidgetDefinition[]>);
	}, []);

	useEffect(() => {
		const currentGlanceables = Array.isArray(selectedConfig?.glanceables) ? selectedConfig.glanceables : [];
		setSelectedGlanceables(
			currentGlanceables
				.map((item: any) => item?.type)
				.filter((item: unknown): item is string => typeof item === "string")
		);

		const currentWidgets = Array.isArray(selectedConfig?.widgets)
			? selectedConfig.widgets.flatMap((column: any) => (Array.isArray(column) ? column : []))
			: [];
		setSelectedWidgetTypes(
			currentWidgets
				.map((item: any) => item?.type)
				.filter((item: unknown): item is string => typeof item === "string")
		);
	}, [selectedConfig?.glanceables, selectedConfig?.widgets]);

	const toggleGlanceable = (type: string, checked: boolean) => {
		setSelectedGlanceables((prev) => {
			if (checked) return Array.from(new Set([...prev, type]));
			return prev.filter((item) => item !== type);
		});
	};

	const toggleWidget = (type: string, checked: boolean) => {
		setSelectedWidgetTypes((prev) => {
			if (checked) return Array.from(new Set([...prev, type]));
			return prev.filter((item) => item !== type);
		});
	};

	const handleCreatePage = async () => {
		const normalized = newPageName.trim().toLowerCase();
		if (!normalized) return;
		if (pages.includes(normalized)) {
			setSelectedPage(normalized);
			setNewPageName("");
			return;
		}

		const nextPages = Array.from(new Set([...(pages ?? []), normalized]));
		await withAuth((auth) => updatePageConfigAction(auth, "home", { pages: nextPages }));
		await refreshHomeConfig();
		setSelectedPage(normalized);
		setNewPageName("");
	};

	const handleSave = async () => {
		setIsSaving(true);
		try {
			const currentGlanceables = Array.isArray(selectedConfig?.glanceables) ? selectedConfig.glanceables : [];
			const nextGlanceables = selectedGlanceables.map((type) => {
				const existing = currentGlanceables.find((entry: any) => entry?.type === type);
				return existing ?? { type };
			});

			const nextWidgetsColumns: WidgetObject[][] = [[], [], []];
			selectedWidgetTypes.forEach((type, index) => {
				nextWidgetsColumns[index % 3].push({
					id: createWidgetId(),
					type,
					properties: {},
				});
			});

			await withAuth((auth) =>
				updatePageConfigAction(auth, selectedPage, {
					glanceables: nextGlanceables,
					widgets: nextWidgetsColumns,
				})
			);
			await refreshSelectedConfig();
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<h1 className="text-2xl font-semibold">Pages</h1>
				<p className="text-sm text-muted-foreground">Choose a page, then select its glanceables and widgets.</p>
			</div>

			<div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
				<div className="space-y-2">
					<Label htmlFor="new-page">New page name</Label>
					<Input
						id="new-page"
						value={newPageName}
						onChange={(event) => setNewPageName(event.target.value)}
						placeholder="lab"
					/>
				</div>
				<Button type="button" onClick={handleCreatePage}>Add page</Button>
			</div>

			<div className="space-y-2">
				<Label>Page to edit</Label>
				<div className="flex flex-wrap gap-2">
					{pages.map((page) => (
						<Button
							key={page}
							type="button"
							variant={selectedPage === page ? "default" : "outline"}
							onClick={() => setSelectedPage(page)}
						>
							{page}
						</Button>
					))}
				</div>
			</div>

			<div className="space-y-3">
				<h2 className="text-lg font-medium">Glanceables</h2>
				<div className="grid gap-2 sm:grid-cols-2">
					{glanceablesCatalog.map((item) => (
						<Label key={item.type} className="flex items-center gap-2 rounded-md border p-3">
							<Checkbox
								checked={selectedGlanceables.includes(item.type)}
								onCheckedChange={(checked) => toggleGlanceable(item.type, checked === true)}
							/>
							<span>{item.name}</span>
						</Label>
					))}
				</div>
			</div>

			<div className="space-y-3">
				<h2 className="text-lg font-medium">Widgets</h2>
				<div className="grid gap-2 sm:grid-cols-2">
					{widgetCatalog.map((item) => (
						<Label key={`${item.category}:${item.slug}`} className="flex items-center gap-2 rounded-md border p-3">
							<Checkbox
								checked={selectedWidgetTypes.includes(item.slug)}
								onCheckedChange={(checked) => toggleWidget(item.slug, checked === true)}
							/>
							<span>{item.name}</span>
						</Label>
					))}
				</div>
			</div>

			<Button type="button" onClick={handleSave} disabled={isSaving}>
				{isSaving ? "Saving..." : `Save ${selectedPage}`}
			</Button>
		</div>
	);
}
