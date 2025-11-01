"use client";

interface WidgetDropZoneProps {
  widgets: any[];
  zone: 'left' | 'middle' | 'right';
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onWidgetEdit: (widget: any, index: number) => void;
  onWidgetRemove: (index: number) => void;
  children?: React.ReactNode;
  className?: string;
  gridCols?: number;
}

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPencil, faXmark } from "@fortawesome/free-solid-svg-icons";
import { cn } from "@/lib/utils";

export default function WidgetDropZone({
  widgets,
  zone,
  onDragOver,
  onDragLeave,
  onDrop,
  onWidgetEdit,
  onWidgetRemove,
  children,
  className,
  gridCols = 1,
}: WidgetDropZoneProps) {
  return (
    <div 
      className={cn(
        "border-white/20 border-1 rounded-md h-full transition-colors",
        className
      )}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
      <div className={cn(
        "grid gap-2 p-2",
        gridCols === 2 ? "grid-cols-2" : "grid-cols-1"
      )}>
        {widgets.map((widget, i) => (
          <div 
            key={i} 
            draggable
            onDragStart={(e) => {
                e.dataTransfer.setData('moveWidget', JSON.stringify({
                widget,
                index: i,
                fromZone: zone
              }));
            }}
          >
            <div className="frosted rounded-lg h-[90px] relative group flex items-center justify-center">
              <span>{widget.name || widget.type}</span>
              <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                <button
                  onClick={() => onWidgetEdit(widget, i)}
                  className="p-1 rounded hover:bg-white/10"
                >
                  <FontAwesomeIcon icon={faPencil} className="size-4" />
                </button>
                <button
                  onClick={() => onWidgetRemove(i)}
                  className="p-1 rounded hover:bg-white/10"
                >
                  <FontAwesomeIcon icon={faXmark} className="size-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}