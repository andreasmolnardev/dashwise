import { Widget } from "@/app/(config-wrapper)/settings/widgets/page";
import WidgetComponent from "@/components/widgets/Widget";
import { CSS } from "@dnd-kit/utilities";
import {
  useSortable,
} from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";

/**
 * Sortable Widget component; meaning a wrapper for the widget to be dagged
 */
export function SortableWidget({
  widget,
  activeId,
  onEdit,
  onRemove,
}: {
  widget: Widget;
  activeId?: string | null;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: widget.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: activeId === widget.id ? 0 : 1,
    pointerEvents: activeId === widget.id ? "none" : undefined,
  } as any;

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="relative">
      <WidgetComponent type={widget.type} params={widget.properties || {}} className="h-[90px] w-full" />
      {onEdit && (
        <Button variant="outline" className="absolute top-2 right-2 p-1 rounded-full hover:bg-white/10" onClick={onEdit}>
          Edit
        </Button>
      )}
      {onRemove && ( 
        <Button variant="outline" className="absolute top-2 right-12 p-1 hover:bg-white/10 rounded-full" onClick={onRemove}>
          Remove
        </Button>
      )}
    </div>
  );
}