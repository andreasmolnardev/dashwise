import { WidgetInfo } from "@/app/(config-wrapper)/settings/widgets/page";
import WidgetComponent from "@/components/widgets/Widget";
import { useDraggable } from "@dnd-kit/core";
import { useMemo } from "react";


/**
 * Draggable List item
 */
export function LibraryDraggable({ info, index }: { info: WidgetInfo; index: number }) {
  const id = useMemo(() => `new-${info.slug}-${index}`, [info.slug, index]);
  const { attributes, listeners, setNodeRef } = useDraggable({ id, data: { slug: info.slug } });

  return (
    <li
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-new-slug={info.slug}
      className="flex flex-col items-center gap-2"
      style={{ listStyle: "none", touchAction: "none", cursor: "grab" }}
    >
      <WidgetComponent type={info.slug} className="h-[90px] w-full" params={info.exampleProps || {}} />
      <span className="text-sm font-medium">{info.name}</span>
    </li>
  );
}
