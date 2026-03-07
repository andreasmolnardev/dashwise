"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useEffect, useState } from "react";
import { WidgetInfo } from "@/app/(authenticated)/settings/widgets/page";
import LocationSelectFormComponent from "../LocationSelectForm";

interface WidgetEditDialogProps {
    open: boolean;
    widget: WidgetInfo | null;
    onClose: () => void;
    onSave: (updatedWidget: WidgetInfo) => void;
}

export default function WidgetEditDialog({ open, widget, onClose, onSave }: WidgetEditDialogProps) {
    const [editedWidget, setEditedWidget] = useState<WidgetInfo | null>(widget);

    useEffect(() => {
        setEditedWidget(widget);
    }, [widget]);

    if (!editedWidget) return null;

    console.log(editedWidget)

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="frosted text-foreground max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Edit Widget</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {editedWidget.slug?.includes("weather") ? (
                        <LocationSelectFormComponent
                            value={{
                                displayName: editedWidget.properties?.locationDisplayname ?? "",
                                coordinates: editedWidget.properties?.locationCoordinates ?? "",
                            }}
                            onChange={(val) =>
                                setEditedWidget((prev) =>
                                    prev
                                        ? {
                                            ...prev,
                                            properties: {
                                                ...(prev.properties || {}),
                                                locationDisplayname: val.displayName,
                                                locationCoordinates: val.coordinates,
                                            },
                                        }
                                        : prev
                                )
                            }
                        />
                    ) : (
                        <>
                            {editedWidget.properties &&
                                Object.entries(editedWidget.properties).map(([key, value]) => (
                                    <PropertyEditInput
                                        key={key}
                                        propKey={key}
                                        value={value}
                                        placeholder={editedWidget.exampleProps?.[key]}
                                        onChange={(newVal) =>
                                            setEditedWidget((prev) =>
                                                prev
                                                    ? {
                                                        ...prev,
                                                        properties: {
                                                            ...(prev.properties || {}),
                                                            [key]: newVal,
                                                        },
                                                    }
                                                    : prev
                                            )
                                        }
                                    />
                                ))}
                        </>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button onClick={() => editedWidget && onSave(editedWidget)}>Save</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

interface PropertyEditInputProps {
    propKey: string;
    value: any;
    placeholder?: string;
    onChange: (newVal: any) => void;
}

function PropertyEditInput({ propKey, value, placeholder, onChange }: PropertyEditInputProps) {
    const propertyType =
        typeof value === "string" && value.startsWith("as:") ? value.replace("as:", "") : typeof value;
console.log(propKey, propertyType)
    const inputPlaceholder = propertyType === "string" ? placeholder ?? undefined : undefined;


    return (
        <div className="space-y-2">
            <Label htmlFor={propKey}>{propKey}</Label>

            {propertyType.includes("bool") ? (
                <Switch
                    id={propKey}
                    checked={Boolean(value)}
                    onCheckedChange={(checked) => onChange(Boolean(checked))}
                />
            ) : (
                <Input
                    id={propKey}
                    placeholder={inputPlaceholder}
                    onChange={(e) => onChange(e.target.value)}
                />
            )}
        </div>
    );
}