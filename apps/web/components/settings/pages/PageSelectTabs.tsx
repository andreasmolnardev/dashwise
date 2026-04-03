"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type PageSelectTabsProps = {
  pages: string[];
  selectedPage: string;
  onSelectPage: (page: string) => void;
  onCreatePage: (pageName: string) => Promise<void> | void;
};

export function PageSelectTabs({
  pages,
  selectedPage,
  onSelectPage,
  onCreatePage,
}: PageSelectTabsProps) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newPageName, setNewPageName] = useState("");

  const handleCreatePage = async () => {
    const name = newPageName.trim();
    if (!name) {
      return;
    }

    await onCreatePage(name);
    setNewPageName("");
    setIsCreateDialogOpen(false);
  };

  return (
    <div className="flex w-full items-center justify-center gap-3">
      <div className="frosted flex min-h-11 w-min items-center gap-2 overflow-x-auto rounded-full border px-2 py-1">
        {pages.map((page) => (
          <button
            key={page}
            type="button"
            onClick={() => onSelectPage(page)}
            className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm capitalize transition ${
              selectedPage === page
                ? "bg-white/20 font-semibold text-white"
                : "text-white/70 hover:text-white"
            }`}
          >
            {page}
          </button>
        ))}
      </div>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogTrigger asChild>
          <Button size="icon" variant="outline" className="rounded-full frosted">
            <Plus className="h-4 w-4" />
          </Button>
        </DialogTrigger>
        <DialogContent className="frosted">
          <DialogHeader>
            <DialogTitle>Add New Page</DialogTitle>
            <DialogDescription>
              Enter a name for your new dashboard page.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-page">Page name</Label>
              <Input
                id="new-page"
                value={newPageName}
                onChange={(event) => setNewPageName(event.target.value)}
                placeholder="e.g. work, dashboard"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void handleCreatePage();
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" onClick={handleCreatePage}>
              Create Page
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}