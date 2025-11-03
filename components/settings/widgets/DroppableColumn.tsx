import { useDroppable } from "@dnd-kit/core";


/* Drop zone for widgets */
export function DroppableColumn({
  id,
  children,
  className,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`${className ?? ""} ${isOver ? "outline outline-2 outline-blue-400/40" : ""}`}>
      {children}
    </div>
  );
}
