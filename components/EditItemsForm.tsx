"use client";

/**
 * ============================================================================
 * EditItemsForm - Composable List Management Component
 * ============================================================================
 *
 * A type-safe, composable component system for building flexible list
 * management interfaces with grouping, filtering, bulk operations, and
 * optional drag-and-drop support.
 *
 * ## Architecture
 *
 * ```
 * EditItemsForm (Context Provider + State Management)
 * │
 * ├── ListHeader (Controls Area)
 * │   ├── Modes (Select Dropdown - Edit/Move)
 * │   └── Tabs (Group Filtering with Dropdown Menu)
 * │       ├── Tab (Individual group tab with rename/delete actions)
 * │       └── CreateGroupAction (Plus icon to add new group)
 * │
 * ├── ListContent (Items Display Container)
 * │   └── ListItemPrototype (Item Row - Repeats for each item)
 * │       ├── Mode Icon (Left: Move/Select icon based on mode)
 * │       ├── Custom Item Content (Passed as children)
 * │       └── IndividualActions (Right: Edit/Delete/Move buttons)
 * │
 * └── BulkActionsFooter (Bottom sticky bar when items selected)
 *     └── BulkItemsSelectedActions (Delete/Move/Create subgroup buttons)
 * ```
 *
 * ## Data Flow
 *
 * 1. Parent provides items array and groupBy field name
 * 2. EditItemsForm computes groups and creates context
 * 3. Child components use useEditItemsForm() hook to access state
 * 4. User interactions update context (mode, selected, currentGroup)
 * 5. Components re-render based on context changes
 * 6. Parent provided onUpdate callback receives changed items
 *
 * ## Key Features
 *
 * - **Type-safe**: Generic type support for any item structure (T extends Record<string, any>)
 * - **Composable**: Build UIs by composing small, focused components
 * - **No prop drilling**: All child components access context via useEditItemsForm()
 * - **Two modes**: "edit" mode for selection/actions, "move" mode for drag-and-drop
 * - **Grouping**: Filter items by group, optional subgroup support
 * - **Bulk operations**: Select multiple items, perform bulk actions (delete, move, etc)
 * - **Flexible**: Render custom item content via ListItemPrototype children
 *
 * ## Usage Example
 *
 * ```tsx
 * import {
 *   EditItemsForm,
 *   ListHeader,
 *   Modes,
 *   Tabs,
 *   Tab,
 *   ListContent,
 *   ListItemPrototype,
 *   IndividualActions,
 *   Action,
 *   BulkActionsFooter,
 *   BulkItemsSelectedActions,
 *   useEditItemsForm,
 * } from "@/components/EditItemsForm";
 *
 * export default function ManageFeeds() {
 *   const [feeds, setFeeds] = useState<NewsFeed[]>([]);
 *
 *   return (
 *     <EditItemsForm<NewsFeed>
 *       items={feeds}
 *       groupBy="category"
 *       itemKey="feedUrl"
 *       onUpdate={async (items) => {
 *         await saveFeedsToServer(items);
 *       }}
 *     >
 *       <ListHeader>
 *         <Modes editLabel="Edit" moveLabel="Move" />
 *         <Tabs>
 *           {categories.map(cat => (
 *             <Tab key={cat} name={cat} onRename={handleRename} />
 *           ))}
 *         </Tabs>
 *       </ListHeader>
 *
 *       <ListContent>
 *         <FeedsListContent feeds={feeds} />
 *       </ListContent>
 *
 *       <BulkActionsFooter>
 *         <BulkItemsSelectedActions />
 *       </BulkActionsFooter>
 *     </EditItemsForm>
 *   );
 * }
 *
 * // Helper component inside ManageFeeds that uses the hook
 * function FeedsListContent({ feeds }: { feeds: NewsFeed[] }) {
 *   const { currentGroup, groupBy, mode } = useEditItemsForm<NewsFeed>();
 *
 *   const filtered = feeds.filter(
 *     f => (f[groupBy] ?? "Uncategorized") === currentGroup
 *   );
 *
 *   return (
 *     <>
 *       {filtered.map(feed => (
 *         <ListItemPrototype key={feed.feedUrl} item={feed}>
 *           <div className="flex-1">
 *             <div>{feed.name}</div>
 *             <div>{feed.feedUrl}</div>
 *           </div>
 *           {mode === "edit" && (
 *             <IndividualActions>
 *               <Action type="edit" onClick={() => edit(feed)} />
 *               <Action type="delete" onClick={() => delete(feed)} />
 *             </IndividualActions>
 *           )}
 *         </ListItemPrototype>
 *       ))}
 *     </>
 *   );
 * }
 * ```
 *
 * ============================================================================
 */

import React, { useState, useMemo, useEffect, useCallback, createContext, useContext } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faEdit,
  faArrowRight,
  faTrash,
  faCaretDown,
  faArrowsUpDown,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type SingleActionType = "edit" | "delete" | "moveOrder" | "move";
export type BulkActionType = "delete" | "move" | "createSubgroup";
export type EditMode = "edit" | "move";

export interface EditItemsFormContextType<T extends Record<string, any>> {
  // Data
  items: T[];
  groups: string[];
  currentGroup: string | null;
  mode: EditMode;
  selected: Record<string, boolean>;
  editingKey: string | null;
  expandedSubgroups: Record<string, boolean>;
  draggedItemKey: string | null;
  draggedOverItemKey: string | null;
  insertPosition: "before" | "after" | null;

  // Config
  groupBy: keyof T;
  subgroupBy?: keyof T;
  itemKey: keyof T;
  enableSubgroup: boolean;
  moveItems: "always" | "onMoveMode" | boolean;
  singleActions: SingleActionType[];
  bulkActions: BulkActionType[];
  iconRounded: boolean;
  enableMoveMode: boolean;

  // Actions
  setMode: (mode: EditMode) => void;
  setCurrentGroup: (group: string | null) => void;
  toggleSelect: (key: string) => void;
  toggleSelectAll: () => void;
  clearSelected: () => void;
  setEditingKey: (key: string | null) => void;
  toggleExpandSubgroup: (subgroup: string) => void;

  // Item operations
  updateItems: (items: T[]) => void;
  updateGroups: (groups: string[]) => void;

  // Drag handlers
  handleDragStart: (key: string, e: React.DragEvent<HTMLDivElement>) => void;
  handleDragOver: (key: string, e: React.DragEvent<HTMLDivElement>) => void;
  handleDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  handleDrop: (key: string, e: React.DragEvent<HTMLDivElement>) => void;

  // Callbacks
  onEditItem?: (item: T) => void;
  onDeleteItem?: (key: string) => void;
  onMoveItemToGroup?: (item: T) => void;
  onBulkDelete?: () => void;
  onBulkMove?: () => void;
  onBulkCreateSubgroup?: () => void;
}

export interface EditItemsFormProps<T extends Record<string, any>> {
  items: T[];
  groups?: string[];
  groupBy: keyof T;
  subgroupBy?: keyof T;
  itemKey?: keyof T;
  title?: string;
  createNewGroup?: boolean;
  enableSubgroup?: boolean;
  enableMoveMode?: boolean;
  switchBetweenModes?: boolean;
  defaultMode?: EditMode;
  singleActions?: SingleActionType[];
  bulkActions?: BulkActionType[];
  moveItems?: "always" | "onMoveMode" | boolean;
  iconRounded?: boolean;
  requireConfirmation?: boolean;
  initialGroup?: string;

  // Callbacks
  onUpdate?: (items: T[], groups?: string[]) => Promise<void> | void;
  onCreateGroup?: (name: string) => Promise<void> | void;
  onGroupAction?: (action: "rename" | "delete", groupName: string, payload?: any) => Promise<void> | void;
  onEditItem?: (item: T, updated?: Partial<T>) => Promise<void> | void;
  onAddItem?: (groupName: string) => Promise<T> | T;

  // Render props
  renderRow?: (item: T, isSelected: boolean, mode: EditMode) => React.ReactNode;
  renderAddItem?: (groupName: string, onAdded: (item: T) => void, onCancel: () => void) => React.ReactNode;
  renderEditItem?: (item: T, onSaved: (updated: T) => void, onCancel: () => void) => React.ReactNode;

  children?: React.ReactNode;
}

// ============================================================================
// CONTEXT & HOOK
// ============================================================================

const EditItemsFormContext = createContext<EditItemsFormContextType<any> | null>(null);

/**
 * Hook to access EditItemsForm context from child components
 * Must be used within an EditItemsForm provider
 */
export const useEditItemsForm = <T extends Record<string, any>>(): EditItemsFormContextType<T> => {
  const context = useContext(EditItemsFormContext);
  if (!context) {
    throw new Error("useEditItemsForm must be used within EditItemsForm component");
  }
  return context as EditItemsFormContextType<T>;
};

// ============================================================================
// MAIN CONTAINER COMPONENT
// ============================================================================

/**
 * EditItemsForm - Main container and context provider
 * Manages state: selected items, mode, current group, etc.
 */
export function EditItemsForm<T extends Record<string, any>>({
  items,
  groups,
  groupBy,
  subgroupBy,
  itemKey = "id" as any,
  title = "Edit items",
  createNewGroup = false,
  enableSubgroup = false,
  enableMoveMode = true,
  switchBetweenModes = true,
  defaultMode = "edit",
  singleActions = ["edit", "delete", "moveOrder", "move"],
  bulkActions = ["delete"],
  moveItems = "onMoveMode",
  iconRounded = true,
  requireConfirmation = false,
  initialGroup,
  onUpdate,
  onCreateGroup,
  onGroupAction,
  onEditItem,
  onAddItem,
  renderRow,
  renderAddItem,
  renderEditItem,
  children,
}: EditItemsFormProps<T>) {
  // Compute groups if not provided
  const computedGroups = useMemo(() => {
    if (groups) return groups;
    const groupSet = new Set<string>();
    items.forEach((item) => {
      const groupVal = String(item[groupBy] ?? "");
      if (groupVal) groupSet.add(groupVal);
    });
    return Array.from(groupSet);
  }, [items, groups, groupBy]);

  // State
  const [currentGroup, setCurrentGroup] = useState<string | null>(
    () => initialGroup && computedGroups.includes(initialGroup) ? initialGroup : computedGroups[0] ?? null
  );
  const [mode, setMode] = useState<EditMode>(defaultMode);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [expandedSubgroups, setExpandedSubgroups] = useState<Record<string, boolean>>({});
  const [workingItems, setWorkingItems] = useState<T[]>(items);
  const [workingGroups, setWorkingGroups] = useState<string[]>(computedGroups);
  const [draggedItemKey, setDraggedItemKey] = useState<string | null>(null);
  const [draggedOverItemKey, setDraggedOverItemKey] = useState<string | null>(null);
  const [insertPosition, setInsertPosition] = useState<"before" | "after" | null>(null);

  // Sync with parent props
  useEffect(() => {
    setWorkingItems(items);
  }, [items]);

  useEffect(() => {
    setWorkingGroups(computedGroups);
  }, [computedGroups]);

  // Update currentGroup if it's removed
  useEffect(() => {
    if (currentGroup && !workingGroups.includes(currentGroup) && workingGroups.length > 0) {
      setCurrentGroup(workingGroups[0]);
    }
  }, [workingGroups, currentGroup]);

  const getKeyFor = useCallback((item: T, fallbackIndex?: number) => {
    const v = item[itemKey as keyof T];
    if (v !== undefined && v !== null) return String(v);
    if ((item as any).url) return (item as any).url;
    if ((item as any).name) return (item as any).name;
    return `idx-${fallbackIndex ?? Math.random().toString(36).slice(2, 9)}`;
  }, [itemKey]);

  const toggleSelect = useCallback((key: string) => {
    setSelected((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (!currentGroup) return;
    const itemsInGroup = workingItems.filter((it) => String(it[groupBy] ?? "") === currentGroup);
    const allSelected = itemsInGroup.every((it) => selected[getKeyFor(it)]);

    if (allSelected) {
      const newSelected = { ...selected };
      itemsInGroup.forEach((it) => {
        delete newSelected[getKeyFor(it)];
      });
      setSelected(newSelected);
    } else {
      const newSelected = { ...selected };
      itemsInGroup.forEach((it) => {
        newSelected[getKeyFor(it)] = true;
      });
      setSelected(newSelected);
    }
  }, [currentGroup, workingItems, groupBy, selected, getKeyFor]);

  const clearSelected = useCallback(() => {
    setSelected({});
  }, []);

  const toggleExpandSubgroup = useCallback((subgroup: string) => {
    setExpandedSubgroups((prev) => ({
      ...prev,
      [subgroup]: !prev[subgroup],
    }));
  }, []);

  const handleDragStart = useCallback((key: string, e: React.DragEvent<HTMLDivElement>) => {
    setDraggedItemKey(key);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((key: string, e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    if (!draggedItemKey || draggedItemKey === key) {
      setDraggedOverItemKey(null);
      setInsertPosition(null);
      return;
    }

    setDraggedOverItemKey(key);

    // Determine if should insert before or after based on mouse position
    const rect = e.currentTarget.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    const position = e.clientY < midpoint ? "before" : "after";
    setInsertPosition(position);
  }, [draggedItemKey]);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDraggedOverItemKey(null);
    setInsertPosition(null);
  }, []);

  const handleDrop = useCallback(
    (key: string, e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      if (!draggedItemKey || draggedItemKey === key) {
        setDraggedItemKey(null);
        setDraggedOverItemKey(null);
        setInsertPosition(null);
        return;
      }

      // Find indices of dragged and target items (only in current group)
      const itemsInGroup = workingItems.filter((it) => String(it[groupBy] ?? "") === currentGroup);
      const draggedIndex = itemsInGroup.findIndex((it) => getKeyFor(it) === draggedItemKey);
      const targetIndex = itemsInGroup.findIndex((it) => getKeyFor(it) === key);

      if (draggedIndex === -1 || targetIndex === -1) {
        setDraggedItemKey(null);
        setDraggedOverItemKey(null);
        setInsertPosition(null);
        return;
      }

      // Calculate new position
      let newIndex = targetIndex;
      if (insertPosition === "after") {
        newIndex = targetIndex + 1;
      }

      // Adjust if dragging backwards
      if (draggedIndex < targetIndex && insertPosition === "after") {
        newIndex = targetIndex + 1;
      } else if (draggedIndex > targetIndex && insertPosition === "before") {
        newIndex = targetIndex;
      } else if (draggedIndex < targetIndex) {
        newIndex = targetIndex;
      }

      // Create new items array with reordered items
      const newItems = [...workingItems];
      const draggedItem = itemsInGroup[draggedIndex];
      const otherItems = itemsInGroup.filter((_, i) => i !== draggedIndex);
      const reorderedGroup = [...otherItems.slice(0, newIndex), draggedItem, ...otherItems.slice(newIndex)];

      // Update items: replace the group's items with reordered ones
      const groupItemIndices = newItems
        .map((it, i) => (String(it[groupBy] ?? "") === currentGroup ? i : -1))
        .filter((i) => i !== -1);

      groupItemIndices.forEach((globalIndex, localIndex) => {
        newItems[globalIndex] = reorderedGroup[localIndex];
      });

      setWorkingItems(newItems);

      // Call onUpdate with new items
      if (onUpdate) {
        onUpdate(newItems, workingGroups);
      }

      // Reset drag state
      setDraggedItemKey(null);
      setDraggedOverItemKey(null);
      setInsertPosition(null);
    },
    [draggedItemKey, workingItems, workingGroups, currentGroup, groupBy, getKeyFor, onUpdate]
  );

  const context: EditItemsFormContextType<T> = {
    // Data
    items: workingItems,
    groups: workingGroups,
    currentGroup,
    mode,
    selected,
    editingKey,
    expandedSubgroups,
    draggedItemKey,
    draggedOverItemKey,
    insertPosition,

    // Config
    groupBy,
    subgroupBy,
    itemKey,
    enableSubgroup,
    moveItems,
    singleActions,
    bulkActions,
    iconRounded,
    enableMoveMode,

    // Actions
    setMode,
    setCurrentGroup,
    toggleSelect,
    toggleSelectAll,
    clearSelected,
    setEditingKey,
    toggleExpandSubgroup,

    // Item operations
    updateItems: setWorkingItems,
    updateGroups: setWorkingGroups,

    // Drag handlers
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,

    // Callbacks
    onEditItem,
    onDeleteItem: undefined,
    onMoveItemToGroup: undefined,
    onBulkDelete: undefined,
    onBulkMove: undefined,
    onBulkCreateSubgroup: undefined,
  };

  return (
    <EditItemsFormContext.Provider value={context}>
      <div className="edit-items-form space-y-4 relative">
        {children}
      </div>
    </EditItemsFormContext.Provider>
  );
}

// ============================================================================
// LIST HEADER COMPONENTS
// ============================================================================

/** Container for header controls (mode select, tabs, etc.) */
export function ListHeader({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-4 flex-wrap justify-between">{children}</div>;
}

/** Mode toggle dropdown (Edit / Move) */
export function Modes({ editLabel = "Edit", moveLabel = "Move" }: { editLabel?: string; moveLabel?: string }) {
  const { mode, setMode, enableMoveMode } = useEditItemsForm();

  if (!enableMoveMode) return null;

  return (
    <Select value={mode} onValueChange={(value) => setMode(value as "edit" | "move")}>
      <SelectTrigger className="w-20">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="edit">{editLabel}</SelectItem>
        <SelectItem value="move">{moveLabel}</SelectItem>
      </SelectContent>
    </Select>
  );
}

/** Container for group tabs */
export function Tabs({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 p-1 overflow-x-auto frosted rounded-full text-white/20 items-center justify-center">
      {children}
    </div>
  );
}

/**
 * Individual group tab
 * Main button changes current group; caret opens dropdown for rename/delete
 */
export function Tab({
  name,
  onRename,
  onDelete,
}: {
  name: string;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  const { currentGroup, setCurrentGroup } = useEditItemsForm();
  const isActive = currentGroup === name;

  return (
    <div className="flex items-center">
      {/* Main tab button - clicking changes group */}
      <button
        onClick={() => setCurrentGroup(name)}
        className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition font-medium ${
          isActive
            ? "bg-white/20 text-(--text-primary)"
            : "text-white/70 hover:text-white/80"
        }`}
      >
        {name}
      </button>

      {/* Dropdown trigger for actions - only if actions available */}
      {(onRename || onDelete) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="px-1 opacity-70 hover:opacity-100 transition">
              <FontAwesomeIcon icon={faCaretDown} className="text-xs" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {onRename && <DropdownMenuItem onClick={onRename}>Rename</DropdownMenuItem>}
            {onDelete && (
              <DropdownMenuItem onClick={onDelete} className="text-red-400">
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/** Button to create a new group */
export function CreateGroupAction({ onCreateGroup }: { onCreateGroup: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onCreateGroup}
      className="text-(--text-primary) hover:bg-(--surface-2)"
    >
      <FontAwesomeIcon icon={faPlus} className="text-sm" />
    </Button>
  );
}

/** Optional container for additional actions */
export function Actions({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {children}
    </div>
  );
}

// ============================================================================
// CONTENT COMPONENTS
// ============================================================================

/** Container for list items */
export function ListContent({ children }: { children: React.ReactNode }) {
  const hasChildren = React.Children.count(children) > 0;

  if (!hasChildren) {
    return (
      <div className="h-20 flex items-center justify-center flex-col font-medium">
        <p className="text-lg">Nothing here</p>
        <p>Add an item to get started</p>
      </div>
    );
  }

  return <div className="space-y-3">{children}</div>;
}

/**
 * Single item row with built-in mode icon (move/select) and content wrapper
 * 
 * In "edit" mode: Shows checkbox on left for selection
 * In "move" mode: Shows drag-and-drop icon on left, makes row draggable
 * 
 * Children are rendered in the center with flex-1 space
 * IndividualActions should be passed as last child
 */
export function ListItemPrototype({
  item,
  children,
  onDragStart,
  onDragEnd,
}: {
  item: any;
  children: React.ReactNode;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
}) {
  const { mode, selected, toggleSelect, handleDragStart: contextDragStart, handleDragOver, handleDragLeave, handleDrop, draggedItemKey, draggedOverItemKey, insertPosition } = useEditItemsForm();
  const itemKey = item.id || JSON.stringify(item);
  const isSelected = selected[itemKey];
  const isDragged = draggedItemKey === itemKey;
  const isDraggedOver = draggedOverItemKey === itemKey;

  const handleLocalDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    contextDragStart(itemKey, e);
    onDragStart?.(e);
  };

  const handleLocalDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
    onDragEnd?.(e);
  };

  return (
    <>
      {/* Insertion line above */}
      {isDraggedOver && insertPosition === "before" && (
        <div className="h-0.5 bg-blue-500 rounded mb-2" />
      )}
      <div
        draggable={mode === "move"}
        onDragStart={handleLocalDragStart}
        onDragEnd={handleLocalDragEnd}
        onDragOver={(e) => handleDragOver(itemKey, e)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(itemKey, e)}
        className={`flex items-center gap-3 p-3 rounded-md border border-transparent hover:bg-(--surface-2) transition group cursor-default relative ${
          isDragged ? "opacity-50" : ""
        } ${isDraggedOver ? "bg-(--surface-1)" : ""}`}
      >
        {/* Move or Select Icon - Left side */}
        {mode === "move" && (
          <div className="flex-shrink-0 cursor-grab active:cursor-grabbing opacity-50 group-hover:opacity-100 transition">
            <FontAwesomeIcon icon={faArrowsUpDown} className="text-white/40" />
          </div>
        )}

        {mode === "edit" && (
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => toggleSelect(itemKey)}
            className="flex-shrink-0"
          />
        )}

        {/* Content wrapper */}
        <div className="flex-1 min-w-0 flex items-center gap-3">
          {children}
        </div>
      </div>
      {/* Insertion line below */}
      {isDraggedOver && insertPosition === "after" && (
        <div className="h-0.5 bg-blue-500 rounded mt-2" />
      )}
    </>
  );
}

/** Container for action buttons on the right of list items (only shown in edit mode) */
export function IndividualActions({ children }: { children: React.ReactNode }) {
  const { mode } = useEditItemsForm();

  if (mode !== "edit") return null;

  return <div className="flex-shrink-0 flex gap-1 ml-auto">{children}</div>;
}

/**
 * Single action button for use inside IndividualActions
 * 
 * @param type - "edit", "delete", "move", etc. - determines icon
 * @param label - Tooltip text
 * @param onClick - Handler when button clicked
 * @param icon - Optional custom icon (overrides default for type)
 */
export function Action({
  type,
  label,
  onClick,
  icon
}: {
  type: "edit" | "move" | "delete" | "create" | "clean" | "add";
  label?: string;
  onClick: () => void;
  icon?: IconDefinition;
}) {
  const iconMap: Record<string, IconDefinition> = {
    edit: faEdit,
    move: faArrowRight,
    delete: faTrash,
    create: faPlus,
  };

  const selectedIcon = icon || iconMap[type];

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="text-(--text-primary) hover:bg-(--surface-2) px-2 h-8 transition-colors"
      title={label}
    >
      {selectedIcon && <FontAwesomeIcon icon={selectedIcon} className="text-sm" />}
    </Button>
  );
}

// ============================================================================
// BULK ACTIONS COMPONENTS
// ============================================================================

/** Sticky footer bar that appears when items are selected */
export function BulkActionsFooter({ children }: { children: React.ReactNode }) {
  const { selected } = useEditItemsForm();
  const selectedCount = Object.values(selected).filter(Boolean).length;

  if (selectedCount === 0) return null;

  return (
    <div className="sticky bottom-0 left-0 right-0 frosted backdrop-blur-lg bg-(--surface-1) border-t border-(--border-color) p-2 flex items-center justify-between gap-4 rounded-full mx-25">
      <div className="text-sm">
        <span className="font-semibold">{selectedCount}</span>
        <span className="text-white/70 ml-2">items selected</span>
      </div>

      <div className="flex gap-2">{children}</div>
    </div>
  );
}

/**
 * Preset bulk action buttons (delete, move, create subgroup)
 * Place inside BulkActionsFooter
 */
export function BulkItemsSelectedActions({
  onDelete,
  onMove,
  onCreateSubgroup,
}: {
  onDelete?: () => void;
  onMove?: () => void;
  onCreateSubgroup?: () => void;
}) {
  const { enableSubgroup } = useEditItemsForm();

  return (
    <>
      {onDelete && <Action type="delete" label="Delete" onClick={onDelete} />}
      {onMove && <Action type="move" label="Move" onClick={onMove} />}
      {onCreateSubgroup && enableSubgroup && (
        <Action type="create" label="Create Folder" onClick={onCreateSubgroup} />
      )}
    </>
  );
}

/** Dropdown for tab actions (rarely used directly - Tab component handles this) */
export function TabDropdown({
  groupName,
  onRename,
  onDelete,
}: {
  groupName: string;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="group relative">
      <button className="text-sm opacity-0 group-hover:opacity-100">⋮</button>
      <div className="absolute right-0 top-full bg-white dark:bg-(--surface-2) rounded shadow-lg hidden group-hover:block z-50">
        {onRename && (
          <button onClick={onRename} className="block w-full text-left px-4 py-2 text-sm hover:bg-(--surface-3)">
            Rename
          </button>
        )}
        {onDelete && (
          <button
            onClick={onDelete}
            className="block w-full text-left px-4 py-2 text-sm hover:bg-(--surface-3) text-red-500"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
