"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { WidgetInfo } from "@/app/(config-wrapper)/settings/widgets/page";
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
            <DialogContent className="frosted text-(--text-primary) max-h-[90vh] overflow-y-auto">
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
                                Object.entries(editedWidget.properties).map(([key]) => (
                                    <div key={key} className="space-y-2">
                                        <Label htmlFor={key}>{key}</Label>
                                        <Input
                                            id={key}
                                            value={editedWidget.properties?.[key] ?? ""}
                                            onChange={(e) =>
                                                setEditedWidget((prev) =>
                                                    prev
                                                        ? {
                                                            ...prev,
                                                            properties: { ...(prev.properties || {}), [key]: e.target.value },
                                                        }
                                                        : prev
                                                )
                                            }
                                        />
                                    </div>
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
