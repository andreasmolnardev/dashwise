"use client";

import React, { useEffect, useState } from "react";
import useAuth from "@/context/useAuth";
import GlanceableComponent, { GlanceableProps } from "@/components/glanceables/Glanceable";
import { usePageConfig } from "@/hooks/usePageConfig";
import { updateConfigPathAction } from "@/app/actions/config";
import { getUserGlanceablesAction } from "@/app/actions/widgets";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.tsx";
import LocationSelectFormComponent from "./LocationSelectForm";

type Glanceable = {
    type: string;
    displayName?: string;
    description?: string;
    example?: string;
    exampleProps?: Record<string, any>;
    properties?: Record<string, string>;
};

export default function GlanceablePropertiesSettingsComponent({
    selected,
    currentTab,
    isCurrent
}: {
    selected: Glanceable;
    currentTab: "left" | "right";
    isCurrent: Boolean;
}) {
    const { config, refreshConfig } = usePageConfig();
    const { withAuth } = useAuth();
    const [glanceables_mapped, setGlanceablesMapped] = useState<Glanceable[]>([]);

    const [params, setParams] = useState<Record<string, any>>(() => {
        const def = isCurrent == true ? selected.properties : selected.exampleProps;
        return def ?? {};
    });

    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

    useEffect(() => {
        const def = isCurrent === true ? selected.properties : selected.exampleProps;
        setParams(def ?? {});
    }, [selected]);

    useEffect(() => {
        void withAuth((auth) => getUserGlanceablesAction(auth))
            .then((data) => {
                const mapped = Array.isArray(data) ? data.map((entry: any) => ({
                    type: String(entry?.type ?? "weather"),
                    displayName: entry?.displayName ?? entry?.name ?? entry?.type,
                    description: entry?.description,
                    exampleProps: entry?.exampleProps ?? {},
                    properties: entry?.properties ?? {},
                })) : [];
                setGlanceablesMapped(mapped);
            })
            .catch(() => setGlanceablesMapped([]));
    }, [withAuth]);

    async function handleSave() {
        setSaveError(null);
        setSaveSuccess(null);

        setSaving(true);
        try {
            // Build updated glanceables from local config (preferred) or fall back to glanceables.json
            const existing = config?.glanceables && Array.isArray(config.glanceables)
                ? [...config.glanceables]
                : glanceables_mapped.slice(0, 2).map(g => ({ type: g.type, displayName: g.displayName, description: g.description, properties: g.exampleProps ?? {} }));

            const updatedGlanceables = [...existing];
            const index = currentTab === 'left' ? 0 : 1;

            // Ensure array has at least two slots
            while (updatedGlanceables.length <= index) updatedGlanceables.push({ type: glanceables_mapped[0]?.type ?? 'unknown', properties: {} });

            // Overwrite the targeted slot with selected type + updated properties
            updatedGlanceables[index] = {
                ...(updatedGlanceables[index] ?? {}),
                type: selected.type,
                properties: params,
            };

            // 2) send PATCH to overwrite the glanceables path with our updated item
            await withAuth((auth) => updateConfigPathAction(auth, "glanceables", updatedGlanceables, "home"));
            setSaveSuccess('Saved glanceables successfully');
            await refreshConfig();
        } catch (err: any) {
            console.error('Error saving glanceables:', err);
            setSaveError(err?.message ?? 'Failed to save glanceables');
        } finally {
            setSaving(false);
        }
    }

    return (
        <section>
            <Preview type={selected.type} params={params} />
            <EditProperties
                type={selected.type}
                glanceables={glanceables_mapped}
                params={params}
                setParams={setParams}
            />
            <div className="mt-4 flex items-center gap-3">
                <Button onClick={handleSave} disabled={saving} variant="default">
                    {saving ? 'Saving...' : 'Save Glanceables'}
                </Button>
                {saveSuccess && <div className="text-sm text-green-600">{saveSuccess}</div>}
                {saveError && <div className="text-sm text-red-600">{saveError}</div>}
            </div>
        </section>
    );

}

function Preview({ type, params, className }: GlanceableProps & { params?: Record<string, any> }) {
    return (
        <div>
            <h3 className="text-lg">Preview</h3>
            <div className="flex items-center justify-center w-full py-2">
                <GlanceableComponent type={type} params={params} className="font-medium text-lg" />
            </div>
        </div>
    );
}

function EditProperties({
    type,
    glanceables,
    params,
    setParams,
}: {
    type: string;
    glanceables: Array<Glanceable>;
    params: Record<string, any>;
    setParams: (next: Record<string, any>) => void;
}) {
    const def = glanceables.find(g => g.type === type);
    const propsSchema = def?.properties;

    if (!propsSchema) {
        return (
            <div>
                <h3 className="text-lg">Edit Properties</h3>
                <p>No properties to edit</p>
            </div>
        );
    }

    return (
        <div>
            <h3 className="text-lg">Edit Properties</h3>
            <div className="space-y-3 mt-2">
                {Object.entries(propsSchema).map(([propName, schema]) => (
                    <div key={propName}>
                        <label className="block text-sm font-medium mb-1">{propName}</label>
                        <PropertyInput
                            name={propName}
                            schema={schema}
                            value={params?.[propName]}
                            onChange={(val) =>
                                setParams(prev => ({ ...prev, [propName]: val }))
                            }
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}


function PropertyInput({
    name,
    schema,
    value,
    onChange,
}: {
    name: string;
    schema: string;
    value: unknown;
    onChange: (val: unknown) => void;
}) {
    const isTz = schema.startsWith("as:tz");
    const isDateFormat = schema.startsWith("as:dateformat");
    const isLocation = schema.startsWith("as:location");
    const isEnum = !isTz && !isDateFormat && !isLocation && schema.includes("|");
    const isBool = schema.startsWith("as:bool");

    const [text, setText] = useState<string>(
        value === undefined || value === null ? "" : String(value)
    );

    useEffect(() => {
        setText(value === undefined || value === null ? "" : String(value));
    }, [value]);

    if (isTz) {
        const tzs =
            typeof Intl !== "undefined" && typeof (Intl as any).supportedValuesOf === "function"
                ? (Intl as any).supportedValuesOf("timeZone")
                : [];
        return (
            <Select value={(value as string) || ""} onValueChange={onChange}>
                <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent>
                    {tzs.map((tz) => (
                        <SelectItem key={tz} value={tz}>
                            {tz}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        );
    }

    if (isDateFormat) {
        return (
            <div>
                <Input
                    value={text}
                    onChange={(e) => {
                        setText(e.target.value);
                        onChange(e.target.value);
                    }}
                    placeholder="e.g. YYYY-MM-DD HH:mm"
                    className="border rounded p-1 w-full"
                />
                <div className="text-xs text-muted-foreground mt-1">
                    Use date format strings (e.g. <code>YYYY-MM-DD</code>, <code>HH:mm</code>)
                </div>
            </div>
        );
    }

    if (isLocation) {
        const locationValue = (value as any) ?? { displayName: "", coordinates: "" };
        return (
            <LocationSelectFormComponent
                value={locationValue}
                onChange={onChange}
            />
        );
    }

    if (isEnum) {
        const options = schema.split("|");
        const selectedValue = (value as string) ?? options[0];
        return (
            <Select value={selectedValue} onValueChange={onChange}>
                <SelectTrigger className="w-full">
                    <SelectValue placeholder={options[0].toUpperCase()} />
                </SelectTrigger>
                <SelectContent>
                    {options.map((opt) => (
                        <SelectItem key={opt} value={opt}>
                            {opt.toUpperCase()}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        )
    }

    if (isBool) {
        const checked = Boolean(value);
        return (
            <div className="flex items-center space-x-2">
                <Checkbox
                    id={name}
                    checked={checked}
                    onCheckedChange={(checked) => onChange(checked)}
                />
                <label htmlFor={name} className="text-sm font-medium">
                    {name}
                </label>
            </div>
        );
    }

    return (
        <input
            type="text"
            value={text}
            onChange={(e) => {
                setText(e.target.value);
                onChange(e.target.value);
            }}
            className="border rounded p-1 w-full frosted"
        />
    );
}
