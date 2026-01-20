"use client";

import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronRight, faChevronDown, faFolder, faPlus } from "@fortawesome/free-solid-svg-icons";

type MoveToGroupDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: string[];
  onSelect: (group: string) => void;
  title?: string;
};

export default function MoveToGroupDialog({
  open,
  onOpenChange,
  groups,
  onSelect,
  title = "Move to group",
}: MoveToGroupDialogProps) {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [newGroupName, setNewGroupName] = useState("");

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [group]: !prev[group],
    }));
  };

  const handleSelectGroup = (group: string) => {
    onSelect(group);
    onOpenChange(false);
    setNewGroupName("");
  };

  const handleCreateNewGroup = () => {
    if (newGroupName.trim()) {
      onSelect(newGroupName.trim());
      onOpenChange(false);
      setNewGroupName("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="frosted text-(--text-primary) max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 max-h-96 overflow-y-auto">
          {/* List of existing groups */}
          {groups.length > 0 ? (
            <div className="space-y-1">
              {groups.map((group) => (
                <div key={group}>
                  <button
                    onClick={() => handleSelectGroup(group)}
                    className="w-full text-left px-3 py-2 rounded-md hover:bg-white/10 transition flex items-center gap-2"
                  >
                    <FontAwesomeIcon icon={faFolder} className="text-sm" />
                    <span>{group}</span>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-white/60">No groups yet</p>
          )}

          {/* Create new group */}
          <div className="border-t pt-3 mt-3">
            <p className="text-xs text-white/60 mb-2">Create new group</p>
            <div className="flex gap-2">
              <Input
                placeholder="Group name"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleCreateNewGroup();
                  }
                }}
                className="text-sm"
              />
              <Button
                size="sm"
                onClick={handleCreateNewGroup}
                disabled={!newGroupName.trim()}
              >
                <FontAwesomeIcon icon={faPlus} />
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
