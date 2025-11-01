"use client";

interface DashboardPreviewProps {
    leftWidgets: any[];
    middleWidgets: any[];
    rightWidgets: any[];
    onDropLeft: (e: React.DragEvent) => void;
    onDropMiddle: (e: React.DragEvent) => void;
    onDropRight: (e: React.DragEvent) => void;
    onWidgetEdit: (widget: any, index: number, zone: 'left' | 'middle' | 'right') => void;
    onWidgetRemove: (index: number, zone: 'left' | 'middle' | 'right') => void;
}

import WidgetDropZone from "./WidgetDropZone";

export default function DashboardPreview({
    leftWidgets,
    middleWidgets,
    rightWidgets,
    onDropLeft,
    onDropMiddle,
    onDropRight,
    onWidgetEdit,
    onWidgetRemove,
}: DashboardPreviewProps) {
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.currentTarget.classList.add('bg-blue-500/10');
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.currentTarget.classList.remove('bg-blue-500/10');
    };

    return (
        <div className="grid grid-rows-[1fr] aspect-video overflow-hidden bg-(--surface) rounded-lg frosted light">
            <main className="grid grid-cols-[25%_1fr_25%] p-2 gap-2">
                <WidgetDropZone
                    zone="left"
                    widgets={leftWidgets}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={onDropLeft}
                    onWidgetEdit={(widget, index) => onWidgetEdit(widget, index, 'left')}
                    onWidgetRemove={(index) => onWidgetRemove(index, 'left')}
                />

                <div className="space-y-2">
                    <section className="grid grid-cols-[1fr_auto_1fr] items-center justify-items-center gap-2">
                        <div className="frosted w-18 h-4 rounded-md"></div>
                        <div className="frosted w-24 h-12 rounded-md"></div>
                        <div className="frosted w-18 h-4 rounded-md"></div>
                    </section>

                    <div className="frosted h-6 rounded-lg flex items-center justify-center text-xs">Search</div>
                    <div className="frosted h-26 rounded-md flex items-center justify-center text-xs">Links</div>

                    <WidgetDropZone
                        zone="middle"
                        widgets={middleWidgets}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={onDropMiddle}
                        onWidgetEdit={(widget, index) => onWidgetEdit(widget, index, 'middle')}
                        onWidgetRemove={(index) => onWidgetRemove(index, 'middle')}
                        gridCols={2}
                        className="h-26"
                    />
                </div>

                <WidgetDropZone
                    zone="right"
                    widgets={rightWidgets}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={onDropRight}
                    onWidgetEdit={(widget, index) => onWidgetEdit(widget, index, 'right')}
                    onWidgetRemove={(index) => onWidgetRemove(index, 'right')}
                />
            </main>
        </div>
    );
}