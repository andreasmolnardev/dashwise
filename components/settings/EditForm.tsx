import React, { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSave,
  faTimes,
  faEllipsisV,
  faEdit,
  faTrash,
  faArrowRightArrowLeft,
  faPlus,
} from "@fortawesome/free-solid-svg-icons";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverEvent,
  DragOverlay,
} from "@dnd-kit/core";

import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";

import { CSS } from "@dnd-kit/utilities";

/**
 * Generic EditFormComponent with requireConfirmation option
 *
 * Designed to be plugged into your app.
 */

type SingleActionType = "edit" | "delete" | "moveOrder" | "move";
type BulkActionType = "delete" | "move" | "createSubgroup";

type Props<T extends Record<string, any>> = {
  items: T[]; // input array
  groups?: string[]; // optional groups list; if omitted we'll compute groups from items
  groupBy: keyof T; // grouping property name (e.g. "linkGroup")
  subgroupBy?: keyof T; // optional subgroup name like "folder"
  title?: string;
  createNewGroup?: boolean;
  onCreateGroup?: (name: string) => Promise<void> | void;
  onGroupAction?: (action: "rename" | "delete", groupName: string, payload?: any) => Promise<void> | void;
  onUpdate?: (items: T[], groups?: string[]) => Promise<void> | void;
  switchBetweenModes?: boolean;
  defaultMode?: "edit" | "move";
  singleActions?: SingleActionType[];
  bulkActions?: BulkActionType[];
  moveItems?: "always" | "onMoveMode" | boolean;
  itemKey?: keyof T; // property used to uniquely identify an item (defaults to "id")
  enableSubgroup?: boolean;
  onEditItem?: (item: T, updated: Partial<T>) => Promise<void> | void;
  renderRow?: (item: T, isSelected: boolean, mode: "edit" | "move") => React.ReactNode;
  requireConfirmation?: boolean; // if true: stage changes locally and only call onUpdate/onCreateGroup/onGroupAction on Save
  initialGroup?: string; // optional initial group to open

  // new props for custom add/edit forms and icon style
  onAddItem?: (groupName: string) => Promise<T> | T;
  renderAddItem?: (groupName: string, onAdded: (item: T) => void, onCancel: () => void) => React.ReactNode;
  renderEditItem?: (item: T, onSaved: (updated: T) => void, onCancel: () => void) => React.ReactNode;
  iconRounded?: boolean; // default true; if false icons are NOT round
};


// =================================================================================
// Main Component
// =================================================================================

export default function EditFormComponent<T extends Record<string, any>>(props: Props<T>) {
  const {
    items,
    groups,
    groupBy,
    subgroupBy,
    title = "Edit items",
    createNewGroup = false,
    onCreateGroup,
    onGroupAction,
    onUpdate,
    switchBetweenModes = true,
    defaultMode = "edit",
    singleActions = ["edit", "delete", "moveOrder", "move"],
    bulkActions = ["delete"],
    moveItems = "onMoveMode",
    itemKey = "id",
    enableSubgroup = false,
    onEditItem,
    renderRow,
    requireConfirmation = false,
    onAddItem,
    renderAddItem,
    renderEditItem,
    iconRounded = true,
  } = props;
  const { initialGroup } = props as any;

  // committed = last saved/applied state (from parent or after Save)
  const [committedItems, setCommittedItems] = useState<T[]>(() => items ?? []);
  const [committedGroups, setCommittedGroups] = useState<string[]>(() => groups ?? []);

  // staged = UI edits go here; committed updates only happen when saved (if requireConfirmation)
  const [stagedItems, setStagedItems] =useState<T[]>(() => items ?? []);
  const [stagedGroups, setStagedGroups] = useState<string[]>(() => groups ?? []);

  // UI state
  const [currentGroup, setCurrentGroup] = useState<string | null>(() => (stagedGroups[0] ?? null));
  const [mode, setMode] = useState<"edit" | "move">(defaultMode);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // sensors for dnd-kit
  const pointerSensor = useSensor(PointerSensor);
  const sensors = useSensors(pointerSensor);

  // Keep committed in sync when parent props change (unless staging is on and user has unsaved changes).
  useEffect(() => {
    setCommittedItems(items ?? []);
    // only update staged as well if no staging or requireConfirmation false
    if (!requireConfirmation) setStagedItems(items ?? []);
  }, [items, requireConfirmation]);

  useEffect(() => {
    const computed = groups ?? [];
    setCommittedGroups(computed);
    if (!requireConfirmation) setStagedGroups(computed);
  }, [groups, requireConfirmation]);

  useEffect(() => {
    // If an initialGroup is provided and exists in stagedGroups, open that first.
    if (initialGroup && stagedGroups.includes(initialGroup)) {
      setCurrentGroup(initialGroup);
      return;
    }

    if (!currentGroup && stagedGroups.length) setCurrentGroup(stagedGroups[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagedGroups, initialGroup]);

  // helper getters to use whichever (staged) list is the "working copy"
  const workingItems = stagedItems;
  const workingGroups = stagedGroups;

  const getKeyFor = (item: T, fallbackIndex?: number) => {
    const v = item[itemKey as keyof T];
    if (v !== undefined && v !== null) return String(v);
    if ((item as any).url) return String((item as any).url);
    if ((item as any).name) return String((item as any).name);
    return `idx-${fallbackIndex ?? Math.random().toString(36).slice(2, 9)}`;
  };

  // grouping computation (uses working items and working groups)
  const groupedForCurrent = useMemo(() => {
    if (!currentGroup) return [];
    const groupItems = workingItems.filter((it) => String(it[groupBy] ?? "") === currentGroup);
    if (!enableSubgroup || !subgroupBy) {
      return [{ subgroup: null as string | null, items: groupItems }];
    }
    const map = new Map<string, T[]>();
    groupItems.forEach((it) => {
      const key = String(it[subgroupBy] ?? "");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    });
    return Array.from(map.entries()).map(([sg, its]) => ({ subgroup: sg || null, items: its }));
  }, [workingItems, currentGroup, groupBy, enableSubgroup, subgroupBy]);

  /* ---------- dirty detection for staged changes ---------- */
  const isDirty = useMemo(() => {
    if (!requireConfirmation) return false;
    try {
      // simple JSON compare (works well for this use case)
      const a = JSON.stringify(committedItems);
      const b = JSON.stringify(stagedItems);
      const gA = JSON.stringify(committedGroups);
      const gB = JSON.stringify(stagedGroups);
      return a !== b || gA !== gB;
    } catch {
      return true;
    }
  }, [requireConfirmation, committedItems, stagedItems, committedGroups, stagedGroups]);

  /* ---------- internal utility to apply local changes (staging or immediate) ---------- */
  const writeChange = async (nextItems: T[], nextGroups?: string[]) => {
    if (requireConfirmation) {
      // write only to staged
      setStagedItems(nextItems);
      if (nextGroups) setStagedGroups(nextGroups);
      return;
    } else {
      // immediate apply
      setCommittedItems(nextItems);
      if (nextGroups) setCommittedGroups(nextGroups);
      // call external onUpdate immediately (if provided)
      if (onUpdate) {
        try {
          await onUpdate(nextItems, nextGroups ?? committedGroups);
        } catch (err) {
          console.error("onUpdate error:", err);
          // optionally revert or surface error; here we leave committed state updated and let caller handle errors
        }
      }
    }
  };

  /* ---------- Group actions (create / rename / delete) ---------- */
  const handleCreateGroup = async () => {
    const name = window.prompt("New group name");
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    const nextGroups = [...workingGroups, trimmed];
    // update staging or immediate depending on requireConfirmation
    if (requireConfirmation) {
      setStagedGroups(nextGroups);
      setCurrentGroup(trimmed);
    } else {
      setCommittedGroups(nextGroups);
      setCurrentGroup(trimmed);
      if (onCreateGroup) {
        try {
          await onCreateGroup(trimmed);
        } catch (err) {
          console.error("onCreateGroup error:", err);
        }
      }
      if (onUpdate) {
        try {
          await onUpdate(committedItems, nextGroups);
        } catch (err) {
          console.error("onUpdate error after create group:", err);
        }
      }
    }
  };

  const handleRenameGroup = async (oldName: string) => {
    const newName = window.prompt("Rename group", oldName);
    if (!newName) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;

    // update items group field and groups list in working copy
    const nextItems = workingItems.map((it) => {
      if (String(it[groupBy] ?? "") === oldName) {
        return { ...it, [String(groupBy)]: trimmed } as T;
      }
      return it;
    });
    const nextGroups = workingGroups.map((g) => (g === oldName ? trimmed : g));

    // writeChange handles staging vs immediate behavior
    await writeChange(nextItems, nextGroups);

    if (!requireConfirmation) {
      if (onGroupAction) {
        try {
          await onGroupAction("rename", oldName, { newName: trimmed });
        } catch (err) {
          console.error("onGroupAction rename error:", err);
        }
      }
    }
  };

  const handleDeleteGroup = async (name: string) => {
    const ok = window.confirm(`Delete group "${name}"? This will unassign the group from its items.`);
    if (!ok) return;

    const nextGroups = workingGroups.filter((g) => g !== name);
    const nextItems = workingItems.map((it) => {
      if (String(it[groupBy] ?? "") === name) {
        const copy = { ...it } as any;
        copy[groupBy] = "";
        return copy as T;
      }
      return it;
    });

    await writeChange(nextItems, nextGroups);

    if (!requireConfirmation) {
      if (onGroupAction) {
        try {
          await onGroupAction("delete", name);
        } catch (err) {
          console.error("onGroupAction delete error:", err);
        }
      }
    }
  };

  /** Handlers for group dropdown actions */
  const handleCreateSubgroupForGroup = (groupName: string) => {
    if (!subgroupBy) return;
    const subName = window.prompt("Subgroup name");
    if (!subName) return;
    const next = workingItems.map((it) =>
      String(it[groupBy]) === groupName ? ({ ...it, [String(subgroupBy)]: subName } as T) : it
    );
    writeChange(next, workingGroups);
  };

  const handleMoveAllItemsToGroup = (groupName: string) => {
    const target = window.prompt("Move all items to which group?");
    if (!target) return;
    const next = workingItems.map((it) => (String(it[groupBy]) === groupName ? ({ ...it, [String(groupBy)]: target } as T) : it));
    const nextGroups = workingGroups.includes(target) ? workingGroups.slice() : [...workingGroups, target];
    writeChange(next, nextGroups);
  };

  /* ---------- item single actions ---------- */
  const handleDeleteItem = async (key: string) => {
    const next = workingItems.filter((it, idx) => getKeyFor(it, idx) !== key);
    await writeChange(next, workingGroups);
  };

  // If host provides renderEditItem, we'll present inline editor handled via editingKey.
  const handleEditItem = async (item: T) => {
    if (renderEditItem) {
      // open inline editor
      setEditingKey(getKeyFor(item));
      return;
    }

    if (!onEditItem) {
      if ((item as any).name !== undefined) {
        const newName = window.prompt("Edit name", String((item as any).name));
        if (newName == null) return;
        const updated = { ...item, name: newName } as T;
        const next = workingItems.map((it) => (getKeyFor(it) === getKeyFor(item) ? updated : it));
        await writeChange(next, workingGroups);
      } else {
        const json = window.prompt("Edit item as JSON", JSON.stringify(item, null, 2));
        if (!json) return;
        try {
          const parsed = JSON.parse(json) as T;
          const next = workingItems.map((it) => (getKeyFor(it) === getKeyFor(item) ? parsed : it));
          await writeChange(next, workingGroups);
        } catch (err) {
          alert("Invalid JSON");
        }
      }
    } else {
      // delegate editing UI to host; host may open a modal or something.
      await onEditItem(item, {});
    }
  };

  const onEditSaved = async (updated: T) => {
    const key = getKeyFor(updated);
    const next = workingItems.map((it) => (getKeyFor(it) === key ? updated : it));
    await writeChange(next, workingGroups);
    setEditingKey(null);
  };

  const onEditCancel = () => {
    setEditingKey(null);
  };

  const handleMoveItemToGroup = async (item: T, targetGroup: string) => {
    const next = workingItems.map((it) =>
      getKeyFor(it) === getKeyFor(item) ? ({ ...it, [String(groupBy)]: targetGroup } as T) : it
    );
    const nextGroups = workingGroups.includes(targetGroup) ? workingGroups.slice() : [...workingGroups, targetGroup];
    await writeChange(next, nextGroups);
  };

  /* ---------- bulk actions ---------- */
  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const copy = { ...prev };
      if (copy[key]) delete copy[key];
      else copy[key] = true;
      return copy;
    });
  };

  const clearSelected = () => setSelected({});

  const handleToggleSelectAllInGroup = () => {
    if (mode === "move" || !currentGroup) return;

    // Calculate this here as it's needed for the logic
    const allInCurrentGroupCount = workingItems.filter((it) => String(it[groupBy] ?? "") === currentGroup).length;
    const totalSelectedInGroup = workingItems.filter(
      (it) => String(it[groupBy] ?? "") === currentGroup && selected[getKeyFor(it)]
    ).length;
    const allSelectedInGroup = allInCurrentGroupCount > 0 && totalSelectedInGroup === allInCurrentGroupCount;

    if (!allSelectedInGroup) {
      const next: Record<string, boolean> = { ...selected };
      workingItems.forEach((it) => {
        if (String(it[groupBy] ?? "") === currentGroup) {
          next[getKeyFor(it)] = true;
        }
      });
      setSelected(next);
    } else {
      const next = { ...selected };
      workingItems.forEach((it) => {
        if (String(it[groupBy] ?? "") === currentGroup) {
          delete next[getKeyFor(it)];
        }
      });
      setSelected(next);
    }
  };

  const handleBulkDelete = async () => {
    const keys = Object.keys(selected);
    if (!keys.length) return;
    if (!confirm(`Delete ${keys.length} selected item(s)?`)) return;
    const next = workingItems.filter((it) => !keys.includes(getKeyFor(it)));
    await writeChange(next, workingGroups);
    clearSelected();
  };

  const handleBulkMove = async () => {
    const keys = Object.keys(selected);
    if (!keys.length) return;
    const target = window.prompt("Move selected items to which group? (enter group name)");
    if (!target) return;
    const next = workingItems.map((it) => (keys.includes(getKeyFor(it)) ? ({ ...it, [String(groupBy)]: target } as T) : it));
    const nextGroups = workingGroups.includes(target) ? workingGroups.slice() : [...workingGroups, target];
    await writeChange(next, nextGroups);
    clearSelected();
  };

  const handleBulkCreateSubgroup = () => {
    const sub = window.prompt("Create subgroup name for selected items");
    if (!sub || !subgroupBy) return;
    const keys = Object.keys(selected);
    const next = workingItems.map((it) => (keys.includes(getKeyFor(it)) ? ({ ...it, [String(subgroupBy)]: sub } as T) : it));
    writeChange(next, workingGroups);
    clearSelected();
  };

  /* ---------- add item support (onAddItem / renderAddItem) ---------- */
  const handleAddItem = async (groupName: string) => {
    // If there's a renderAddItem, open inline form
    if (renderAddItem) {
      setAddOpen(true);
      return;
    }

    if (onAddItem) {
      try {
        const newItem = await Promise.resolve(onAddItem(groupName));
        if (!newItem) return;
        const next = [...workingItems, newItem];
        await writeChange(next, workingGroups);
        return;
      } catch (err) {
        console.error("onAddItem error:", err);
        return;
      }
    }

    // fallback behaviour (existing simple prompt)
    const name = window.prompt("New item name");
    if (!name) return;
    const newItem: any = { [String(groupBy)]: groupName, name, id: `tmp-${Date.now()}` };
    const next = [...workingItems, newItem];
    await writeChange(next, workingGroups);
  };

  const onAdded = async (item: T) => {
    const next = [...workingItems, item];
    await writeChange(next, workingGroups);
    setAddOpen(false);
  };
  const onAddCancel = () => setAddOpen(false);

  /* ---------- drag & drop using dnd-kit (reorder within group) ---------- */
  const handleDragEnd = (event: DragEndEvent) => {
    if (mode !== "move" || !currentGroup) {
      return;
    }

    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    // Find the positions of the active and over items
    const allItems = workingItems.filter((it) => String(it[groupBy] ?? "") === currentGroup);
    const activeIndex = allItems.findIndex((it) => getKeyFor(it) === String(active.id));
    const overIndex = allItems.findIndex((it) => getKeyFor(it) === String(over.id));

    if (activeIndex === -1 || overIndex === -1) {
      return;
    }

    // Get global indices of items in the current group
    const groupGlobalIndices = workingItems
      .map((it, idx) => ({ it, idx }))
      .filter(({ it }) => String(it[groupBy] ?? "") === currentGroup)
      .map(({ idx }) => idx);

    const fromGlobalIndex = groupGlobalIndices[activeIndex];
    const toGlobalIndex = groupGlobalIndices[overIndex];

    // Use arrayMove to reorder
    const newItems = arrayMove(workingItems, fromGlobalIndex, toGlobalIndex);
    writeChange(newItems, workingGroups);
  };

  /* ---------- Save & Cancel (only relevant when requireConfirmation === true) ---------- */
  const handleSave = async () => {
    if (!requireConfirmation) return;
    try {
      if (onUpdate) {
        await onUpdate(stagedItems, stagedGroups);
      }
      // if onUpdate completes, commit staged into committed
      setCommittedItems(stagedItems.slice());
      setCommittedGroups(stagedGroups.slice());
      // clear selected and dirty flags
      setSelected({});
    } catch (err) {
      console.error("Save error:", err);
      window.alert("Failed to save changes. See console for details.");
    }
  };

  const handleCancel = () => {
    if (!requireConfirmation) return;
    // revert staged => committed
    setStagedItems(committedItems.slice());
    setStagedGroups(committedGroups.slice());
    setSelected({});
  };

  /* ---------- UI render ---------- */

  const totalSelected = Object.keys(selected).length;
  const allInCurrentGroupCount = workingItems.filter((it) => String(it[groupBy] ?? "") === currentGroup).length;
  const allSelectedInGroup =
    totalSelected > 0 &&
    allInCurrentGroupCount > 0 &&
    workingItems.filter((it) => String(it[groupBy] ?? "") === currentGroup && selected[getKeyFor(it)]).length ===
      allInCurrentGroupCount;

  return (
    <div className="w-full p-2">
      <ComponentHeader
        title={title}
      />

      <ModeAndTabsBar
        switchBetweenModes={switchBetweenModes}
        mode={mode}
        onSetMode={setMode}
        workingGroups={workingGroups}
        currentGroup={currentGroup}
        onSetCurrentGroup={setCurrentGroup}
        iconRounded={iconRounded}
        onRenameGroup={handleRenameGroup}
        onDeleteGroup={handleDeleteGroup}
        onCreateGroup={handleCreateGroup}
        onCreateSubgroupForGroup={handleCreateSubgroupForGroup}
        onMoveAllItemsToGroup={handleMoveAllItemsToGroup}
        createNewGroup={createNewGroup}
        requireConfirmation={requireConfirmation}
        isDirty={isDirty}
        onSave={handleSave}
        onCancel={handleCancel}
      />

      {currentGroup ? (
        <div>
          <CurrentGroupHeader
            mode={mode}
            totalSelected={totalSelected}
            allSelectedInGroup={allSelectedInGroup}
            onToggleSelectAll={handleToggleSelectAllInGroup}
            addOpen={addOpen}
            onAddItem={() => handleAddItem(currentGroup)}
            renderAddItem={renderAddItem}
            currentGroup={currentGroup}
            onAdded={onAdded}
            onAddCancel={onAddCancel}
          />

          <ItemList
            groupedForCurrent={groupedForCurrent}
            enableSubgroup={enableSubgroup}
            getKeyFor={getKeyFor}
            selected={selected}
            mode={mode}
            moveItems={moveItems}
            dropIndex={null}
            // ItemRow props
            editingKey={editingKey}
            renderEditItem={renderEditItem}
            onEditSaved={onEditSaved}
            onEditCancel={onEditCancel}
            renderRow={renderRow}
            onToggleSelect={toggleSelect}
            singleActions={singleActions}
            onEditItem={handleEditItem}
            onMoveItemToGroup={handleMoveItemToGroup}
            onDeleteItem={handleDeleteItem}
            onDragEnd={handleDragEnd}
          />

          {totalSelected > 0 && (
            <BulkActionsFooter
              totalSelected={totalSelected}
              bulkActions={bulkActions}
              enableSubgroup={enableSubgroup}
              onBulkDelete={handleBulkDelete}
              onBulkMove={handleBulkMove}
              onBulkCreateSubgroup={handleBulkCreateSubgroup}
            />
          )}
        </div>
      ) : (
        <div className="text-sm text-white/60">No group selected</div>
      )}
    </div>
  );
}

// =================================================================================
// Sub-components for Rendering
// =================================================================================

/**
 * Renders the top header with Title and Save/Cancel buttons
 */
const ComponentHeader: React.FC<{
  title: string;
}> = ({ title }) => {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-xl font-semibold">{title}</h2>
    </div>
  );
};

/**
 * Renders a single Group Tab with its Dropdown Menu
 */
const GroupTab: React.FC<{
  groupName: string;
  isActive: boolean;
  iconRounded: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCreateGroup: () => void;
}> = ({
  groupName,
  isActive,
  iconRounded,
  onSelect,
  onRename,
  onDelete,
  onCreateGroup,
}) => {
  return (
    <div key={groupName} className="relative inline-flex items-center">
      {/* Tab button */}
      <button
        className={`pl-1 pr-1 py-1 ${isActive ? "bg-white/20" : "bg-transparent"} text-sm rounded-l-full flex items-center `}
        onClick={onSelect}
        title={groupName}
      >
        {groupName}
      </button>

      {/* Dropdown menu on ellipsis icon */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={`pr-2 py-1 ${isActive ? "bg-white/20" : "bg-transparent"} text-sm rounded-r-full`}
            title={`Actions for ${groupName}`}
          >
            <FontAwesomeIcon icon={faEllipsisV} className="text-xs" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent className="w-56" align="start">
          <DropdownMenuLabel>Group</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={onRename}>
              <FontAwesomeIcon icon={faEdit} className="mr-2" /> Rename
            </DropdownMenuItem>

            <DropdownMenuItem onSelect={onDelete}>
              <FontAwesomeIcon icon={faTrash} className="mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={onCreateGroup}>
              <FontAwesomeIcon icon={faPlus} className="mr-2" /> New group
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

/**
 * Renders the Mode switch and the bar of Group Tabs
 */
const ModeAndTabsBar: React.FC<{
  switchBetweenModes: boolean;
  mode: "edit" | "move";
  onSetMode: (mode: "edit" | "move") => void;
  workingGroups: string[];
  currentGroup: string | null;
  onSetCurrentGroup: (group: string) => void;
  iconRounded: boolean;
  onRenameGroup: (name: string) => void;
  onDeleteGroup: (name: string) => void;
  onCreateGroup: () => void;
  onCreateSubgroupForGroup: (name: string) => void;
  onMoveAllItemsToGroup: (name: string) => void;
  createNewGroup: boolean;
  requireConfirmation: boolean;
  isDirty: boolean;
  onSave: () => void;
  onCancel: () => void;
}> = (props) => {
  const {
    switchBetweenModes,
    mode,
    onSetMode,
    workingGroups,
    currentGroup,
    onSetCurrentGroup,
    iconRounded,
    onRenameGroup,
    onDeleteGroup,
    onCreateGroup,
    onCreateSubgroupForGroup,
    onMoveAllItemsToGroup,
    createNewGroup,
    requireConfirmation,
    isDirty,
    onSave,
    onCancel,
  } = props;

  return (
    <div className="w-full flex items-center justify-between gap-3 my-4">
      {/* Left: Mode selector */}
      {switchBetweenModes && (
        <Select value={mode} onValueChange={(val) => onSetMode(val as "edit" | "move")}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="frosted text-(--text-primary)">
            <SelectItem value="edit">Edit</SelectItem>
            <SelectItem value="move">Move</SelectItem>
          </SelectContent>
        </Select>
      )}

      {/* Center: Tabs */}
      <div className="flex-1 flex items-center justify-center">
        <div className="inline-flex gap-2 items-center rounded-full bg-white/5 p-1">
          {workingGroups.map((g) => (
            <GroupTab
              key={g}
              groupName={g}
              isActive={currentGroup === g}
              iconRounded={iconRounded}
              onSelect={() => onSetCurrentGroup(g)}
              onRename={() => onRenameGroup(g)}
              onDelete={() => onDeleteGroup(g)}
              onCreateGroup={onCreateGroup}
            />
          ))}

          {createNewGroup && (
            <button className="px-3 py-1 rounded-full bg-white/10 text-sm" onClick={onCreateGroup} title="Create group">
              <FontAwesomeIcon icon={faPlus} />
            </button>
          )}
        </div>
      </div>

      {/* Right: Save/Cancel buttons (hidden unless isDirty) */}
      {requireConfirmation && isDirty && (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            title="Cancel changes"
          >
            <FontAwesomeIcon icon={faTimes} className="mr-2" />
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            title="Save changes"
          >
            <FontAwesomeIcon icon={faSave} className="mr-2" />
            Save
          </Button>
        </div>
      )}
    </div>
  );
};

/**
 * Renders the header for the current group (Select All, Add item)
 */
const CurrentGroupHeader: React.FC<{
  mode: "edit" | "move";
  totalSelected: number;
  allSelectedInGroup: boolean;
  onToggleSelectAll: () => void;
  addOpen: boolean;
  onAddItem: () => void;
  renderAddItem?: (groupName: string, onAdded: (item: any) => void, onCancel: () => void) => React.ReactNode;
  currentGroup: string;
  onAdded: (item: any) => void;
  onAddCancel: () => void;
}> = (props) => {
  const {
    mode,
    totalSelected,
    allSelectedInGroup,
    onToggleSelectAll,
    addOpen,
    onAddItem,
    renderAddItem,
    currentGroup,
    onAdded,
    onAddCancel,
  } = props;

  // Hide select and add controls in move mode
  if (mode === "move") {
    return <div className="mb-2" />;
  }

  return (
    <div className="flex items-center justify-between mb-2 px-3">
      <div className="flex items-center gap-3">
        <label className="inline-flex items-center gap-2">
          <Checkbox
            checked={allSelectedInGroup && totalSelected > 0}
            onCheckedChange={onToggleSelectAll}
            disabled={false}
          />
          <span className="text-sm">Select ({totalSelected})</span>
        </label>
      </div>

      <div className="flex gap-2 items-center">
        {totalSelected > 0 && <div className="text-sm text-muted">{`${totalSelected} selected`}</div>}

        {!addOpen && (
          <Button size="sm" variant="outline" onClick={onAddItem}>
            <FontAwesomeIcon icon={faPlus} className="mr-2" /> Add
          </Button>
        )}

        {addOpen && renderAddItem && (
          <div className="w-full">
            {renderAddItem(currentGroup, onAdded, onAddCancel)}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Renders a single Item Row
 */
const ItemRow: React.FC<{
  item: any;
  itemKey: string;
  localIndex: number;
  isSelected: boolean;
  mode: "edit" | "move";
  showDragHandle: boolean;
  editingKey: string | null;
  renderEditItem?: (item: any, onSaved: (updated: any) => void, onCancel: () => void) => React.ReactNode;
  onEditSaved: (updated: any) => void;
  onEditCancel: () => void;
  renderRow?: (item: any, isSelected: boolean, mode: "edit" | "move") => React.ReactNode;
  onToggleSelect: (key: string) => void;
  singleActions: SingleActionType[];
  onEditItem: (item: any) => void;
  onMoveItemToGroup: (item: any, targetGroup: string) => void;
  onDeleteItem: (key: string) => void;
}> = (props) => {
  const {
    item,
    itemKey,
    localIndex,
    isSelected,
    mode,
    showDragHandle,
    editingKey,
    renderEditItem,
    onEditSaved,
    onEditCancel,
    renderRow,
    onToggleSelect,
    singleActions,
    onEditItem,
    onMoveItemToGroup,
    onDeleteItem,
  } = props;

  // Use dnd-kit's useSortable hook for this item
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: itemKey });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // When in move mode, attach the sortable/drag listeners to the whole row so users can drag by
  // grabbing the row text area (instead of only a small handle), avoiding accidental text selection.
  const dragAttributes = mode === "move" && showDragHandle ? { ...attributes, ...listeners } : {};

  return (
    <li
      ref={setNodeRef}
      {...dragAttributes}
      style={style}
      className={`flex items-center gap-3 p-2 rounded-md hover:bg-white/5 ${isSelected ? "bg-white/5" : ""} ${isDragging ? "opacity-50" : ""}`}
    >
      <div className="w-6 flex items-center justify-center">
        {mode === "edit" ? (
          <Checkbox checked={isSelected} onCheckedChange={() => onToggleSelect(itemKey)} />
        ) : showDragHandle ? (
          <span style={{ cursor: "grab" }} title="Drag to reorder">⋮⋮</span>
        ) : null}
      </div>

      <div className="flex-1">
        {/* If we're editing this row inline via renderEditItem, show that */}
        {editingKey === itemKey && renderEditItem ? (
          <div className="w-full">
            {renderEditItem(item, onEditSaved, onEditCancel)}
          </div>
        ) : renderRow ? (
          renderRow(item, isSelected, mode)
        ) : (
          <>
            <div className="font-medium">{item.name ?? itemKey}</div>
            <div className="text-xs text-white/60 truncate">{item.url ?? ""}</div>
          </>
        )}
      </div>

      {!isSelected && mode !== "move" && (
        <div className="flex items-center gap-2">
          {singleActions.includes("edit") && (
            <button className="px-2 py-1 text-sm hover:text-[var(--primary)]" onClick={() => onEditItem(item)}>
              <FontAwesomeIcon icon={faEdit} />
            </button>
          )}
          {singleActions.includes("move") && (
            <button
              className="px-2 py-1 text-sm hover:text-[var(--primary)]"
              onClick={() => {
                const target = window.prompt("Move to group (enter group name)");
                if (!target) return;
                onMoveItemToGroup(item, target);
              }}
            >
              <FontAwesomeIcon icon={faArrowRightArrowLeft} />
            </button>
          )}
          {singleActions.includes("delete") && (
            <button className="px-2 py-1 text-sm text-red-400 hover:text-red-300" onClick={() => onDeleteItem(itemKey)}>
              <FontAwesomeIcon icon={faTrash} />
            </button>
          )}
        </div>
      )}
    </li>
  );
};

/**
 * Renders the List of Items, including subgroup headers
 */
const ItemList: React.FC<{
  groupedForCurrent: { subgroup: string | null; items: any[] }[];
  enableSubgroup: boolean;
  getKeyFor: (item: any, fallbackIndex?: number) => string;
  selected: Record<string, boolean>;
  mode: "edit" | "move";
  moveItems: "always" | "onMoveMode" | boolean;
  dropIndex: number | null;
  // All props needed by ItemRow
  editingKey: string | null;
  renderEditItem?: (item: any, onSaved: (updated: any) => void, onCancel: () => void) => React.ReactNode;
  onEditSaved: (updated: any) => void;
  onEditCancel: () => void;
  renderRow?: (item: any, isSelected: boolean, mode: "edit" | "move") => React.ReactNode;
  onToggleSelect: (key: string) => void;
  singleActions: SingleActionType[];
  onEditItem: (item: any) => void;
  onMoveItemToGroup: (item: any, targetGroup: string) => void;
  onDeleteItem: (key: string) => void;
  onDragEnd: (event: DragEndEvent) => void;
}> = (props) => {
  const {
    groupedForCurrent,
    enableSubgroup,
    getKeyFor,
    selected,
    mode,
    moveItems,
    dropIndex,
    onDragEnd,
    ...itemRowProps
  } = props;

  let runningLocalIndex = 0;

  // Build all sortable IDs for the current view
  const sortableIds = groupedForCurrent.flatMap((bucket) =>
    bucket.items.map((it, idx) => getKeyFor(it, idx))
  );

  return (
    <DndContext
      sensors={[useSensor(PointerSensor)]}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy} disabled={mode !== "move"}>
        <ul className="space-y-2">
          {groupedForCurrent.map((bucket, bucketIdx) => (
            <li key={`bucket-${bucket.subgroup ?? "root"}-${bucketIdx}`} className="mb-2">
              {enableSubgroup && bucket.subgroup !== null && (
                <div className="px-2 py-1 text-xs text-white/60">{bucket.subgroup}</div>
              )}
              <ul className="space-y-1">
                {bucket.items.map((it, idxInBucket) => {
                  const key = getKeyFor(it, idxInBucket);
                  const isSelected = !!selected[key];
                  const localIndex = runningLocalIndex;
                  runningLocalIndex += 1;
                  const showDragHandle = moveItems === "always" || (moveItems === "onMoveMode" && mode === "move");

                  return (
                    <ItemRow
                      key={key}
                      item={it}
                      itemKey={key}
                      localIndex={localIndex}
                      isSelected={isSelected}
                      mode={mode}
                      showDragHandle={showDragHandle}
                      {...itemRowProps}
                    />
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </SortableContext>
      {mode === "move" && dropIndex !== null && (
        <div className="mt-2 text-sm text-white/60">Drop insertion index: {dropIndex}</div>
      )}
    </DndContext>
  );
};

/**
 * Renders the footer with Bulk Action buttons
 */
const BulkActionsFooter: React.FC<{
  totalSelected: number;
  bulkActions: BulkActionType[];
  enableSubgroup: boolean;
  onBulkDelete: () => void;
  onBulkMove: () => void;
  onBulkCreateSubgroup: () => void;
}> = ({ totalSelected, bulkActions, enableSubgroup, onBulkDelete, onBulkMove, onBulkCreateSubgroup }) => {
  return (
    <div className="mt-4 border-t pt-2 flex items-center justify-between">
      <div className="text-sm">{totalSelected > 0 ? `${totalSelected} selected` : "No items selected"}</div>
      {totalSelected > 0 && (
        <div className="flex gap-2">
          {bulkActions.includes("delete") && (
            <button
              className="px-3 py-1 rounded bg-red-600 text-sm"
              onClick={onBulkDelete}
            >
              Delete
            </button>
          )}
          {bulkActions.includes("move") && (
            <button
              className="px-3 py-1 rounded bg-white/10 text-sm"
              onClick={onBulkMove}
            >
              <FontAwesomeIcon icon={faArrowRightArrowLeft} className="mr-2" />
              Move
            </button>
          )}
          {bulkActions.includes("createSubgroup") && enableSubgroup && (
            <button
              className="px-3 py-1 rounded bg-white/10 text-sm"
              onClick={onBulkCreateSubgroup}
            >
              Create subgroup
            </button>
          )}
        </div>
      )}
    </div>
  );
};
