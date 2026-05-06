"use client";

import { useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus } from "lucide-react";
import { renderWidget } from "../widgets/Widget";

const WIDGET_OPTIONS = [
  "main-clock",
  "search-bar",
  "calendar-week",
  "link-view",
  "monitoring",
];

type Frame = {
  id: string;
  type: string;
  params?: Record<string, any>;
};

function SortableFrame({ frame, onRemove }: { frame: Frame; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: frame.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative flex flex-col items-center justify-center w-64 h-48 border frosted rounded-xl shrink-0 overflow-hidden bg-black/20"
    >
      <div
        className="absolute left-2 top-2 z-10 w-8 h-8 flex items-center justify-center cursor-grab active:cursor-grabbing bg-black/50 rounded-md text-white/80"
        {...attributes}
        {...listeners}
      >
        |||
      </div>

      <button
        onClick={onRemove}
        className="absolute right-2 top-2 z-10 w-8 h-8 flex items-center justify-center bg-red-500/80 hover:bg-red-500 rounded-md text-white"
        title="Remove Frame"
      >
        X
      </button>

      <div className="pointer-events-none w-full h-full flex items-center justify-center px-2">
        {renderWidget({ type: frame.type, params: frame.params || {}, className: "w-full h-full" })}
      </div>

      <div className="absolute bottom-2 left-2 right-2 text-center text-xs bg-black/60 rounded px-2 py-1 truncate">
        {frame.type}
      </div>
    </div>
  );
}

export default function SmartFramesManager({
  frames,
  onChange,
}: {
  frames: Frame[];
  onChange: (newFrames: Frame[]) => void;
}) {

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = frames.findIndex((frame) => frame.id === active.id);
      const newIndex = frames.findIndex((frame) => frame.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        onChange(arrayMove(frames, oldIndex, newIndex));
      }
    }
  };

  const handleAddFrame = (type: string) => {
    const nextFrame: Frame = {
      id: `frame-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type: type,
      params: {},
    };
    onChange([...frames, nextFrame]);
  };

  const handleRemoveFrame = (id: string) => {
    onChange(frames.filter((frame) => frame.id !== id));
  };

  return (
    <div className="space-y-4">
      <div className="bg-black/10 rounded-xl p-4 border border-white/10 overflow-x-auto hide-scrollbar">
        <style dangerouslySetInnerHTML={{ __html: ".hide-scrollbar::-webkit-scrollbar { display: none; }" }} />
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={frames.map((frame) => frame.id)} strategy={horizontalListSortingStrategy}>
            <div className="flex gap-4 min-w-max">
              {frames.map((frame) => (
                <SortableFrame key={frame.id} frame={frame} onRemove={() => handleRemoveFrame(frame.id)} />
              ))}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex flex-col items-center justify-center w-64 h-48 border border-dashed border-white/20 frosted rounded-xl shrink-0 hover:bg-white/5 transition-colors group cursor-pointer">
                    <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-white/10 transition-colors mb-2">
                      <Plus className="w-6 h-6 text-white/40 group-hover:text-white/80 transition-colors" />
                    </div>
                    <span className="text-sm font-medium text-white/40 group-hover:text-white/80 transition-colors">Add Smart Frame</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" className="w-48">
                  {WIDGET_OPTIONS.map((widget) => (
                    <DropdownMenuItem 
                      key={widget} 
                      onClick={() => handleAddFrame(widget)}
                      className="capitalize"
                    >
                      {widget.replace(/-/g, ' ')}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}
