"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import useAuth from "@/context/useAuth";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { DialogClose } from "@/components/ui/dialog";
import { useConfig } from "@/context/ConfigContext";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBars } from "@fortawesome/free-solid-svg-icons";

type Props = {
  linkGroups?: string[] | null;
  onReordered?: () => void | Promise<void>;
};

export default function MoveLinkGroupsFormComponent({ linkGroups = [], onReordered }: Props) {
  const { refreshConfig } = useConfig();

  // local order state
  const [order, setOrder] = useState<string[]>(linkGroups ?? []);
  useEffect(() => setOrder(linkGroups ?? []), [linkGroups?.length]);

  // drag state
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { token } = useAuth();

  // -- Drag handlers --
  const handleDragStart = (e: React.DragEvent<HTMLLIElement>, idx: number) => {
    setDraggingIndex(idx);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
  };

  const handleDragOverItem = (e: React.DragEvent<HTMLLIElement>, idx: number) => {
    e.preventDefault();
    if (draggingIndex === null) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const insertBefore = offsetY < rect.height / 2;
    const newIndex = insertBefore ? idx : idx + 1;
    if (newIndex !== dropIndex) setDropIndex(newIndex);
    e.dataTransfer.dropEffect = "move";
  };

  const handleDragOverList = (e: React.DragEvent<HTMLUListElement>) => {
    e.preventDefault();
    if (draggingIndex === null) return;
    const list = e.currentTarget;
    const items = list.querySelectorAll("li");
    if (items.length === 0) {
      setDropIndex(0);
      return;
    }
    const lastRect = (items[items.length - 1] as HTMLElement).getBoundingClientRect();
    if (e.clientY > lastRect.bottom) setDropIndex(order.length);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const fromIdxStr = e.dataTransfer.getData("text/plain");
    const fromIdx = fromIdxStr ? Number(fromIdxStr) : draggingIndex;
    if (fromIdx === null || fromIdx === undefined || isNaN(fromIdx)) return;
    let toIdx = dropIndex ?? order.length;
    if (fromIdx < toIdx) toIdx = toIdx - 1;
    if (toIdx < 0) toIdx = 0;
    if (toIdx > order.length) toIdx = order.length;

    const next = [...order];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setOrder(next);

    setDraggingIndex(null);
    setDropIndex(null);
  };

  const handleDragEnd = () => {
    setDraggingIndex(null);
    setDropIndex(null);
  };

  // -- Persist the new order to server by applying single moves sequentially --
  const persistOrder = async () => {
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      if (!token) throw new Error("Not authenticated");

      // current server list (we use the prop snapshot to calculate diffs)
      let current = Array.isArray(linkGroups) ? [...linkGroups] : [];
      if (current.length !== order.length) {
        throw new Error("Mismatch between server list and local list length");
      }

      // For each target index, ensure server has correct item there by moving it if necessary.
      for (let i = 0; i < order.length; i++) {
        const desired = order[i];
        const src = current.indexOf(desired);
        if (src === -1) {
          throw new Error(`Item "${desired}" not found on server list`);
        }
        if (src === i) continue; // already in place

        const res = await fetch(`/api/v1/config/move-arrayitems?path=linkGroups`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ src, dst: i }),
        });

        let json: any = {};
        try { json = await res.json(); } catch {}

        if (!res.ok) {
          throw new Error(json?.error || `Move failed (src=${src}, dst=${i})`);
        }

        // update our local representation of the server array
        const [moved] = current.splice(src, 1);
        current.splice(i, 0, moved);
      }

      setSuccess("Link groups reordered.");
      await refreshConfig();

      if (onReordered) await onReordered();
    } catch (err: any) {
      setError(err?.message || "Failed to persist new order");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="text-[var(--text-primary)]"
    >
      <div className="mb-2 text-sm text-[var(--text-secondary)]">
        Drag to reorder your link groups. Confirm to apply the new order.
      </div>

      {error && (
        <Alert className="mb-2" variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="mb-2">
          <AlertTitle>Success</AlertTitle>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      <div
        className="max-h-80 overflow-auto border rounded p-2 bg-[var(--surface)]/50"
        style={{ WebkitBackdropFilter: "blur(4px)", backdropFilter: "blur(4px)" }}
      >
        <ul
          className="space-y-2"
          onDragOver={handleDragOverList}
          onDrop={handleDrop}
          role="list"
        >
          {order.map((name, idx) => {
            const isDragging = draggingIndex === idx;
            const showInsertBefore = dropIndex === idx;
            return (
              <div key={name} className="relative">
                {showInsertBefore && (
                  <div
                    className="w-full my-1 rounded h-0 overflow-visible"
                    style={{
                      transition: "height 140ms ease, opacity 140ms ease",
                      height: "2px",
                      opacity: 1,
                    }}
                  >
                    <div
                      className="w-full h-[2px] rounded"
                      style={{ background: "var(--primary)" }}
                    />
                  </div>
                )}

                <li
                  draggable
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragOver={(e) => handleDragOverItem(e, idx)}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                  role="listitem"
                  aria-grabbed={isDragging}
                  className={
                    `flex items-center gap-3 p-2 rounded border 
                     transition-transform duration-150 ease-out transform will-change-transform
                     ${isDragging ? "opacity-70 scale-105 shadow-lg cursor-grabbing" : "cursor-grab hover:translate-y-[-2px]"}`
                  }
                  style={{ transitionProperty: "transform, opacity, box-shadow" }}
                >
                  <div className="w-6 h-6 flex items-center justify-center">
                    <FontAwesomeIcon icon={faBars} />
                  </div>
                  <div className="flex-1 text-sm font-medium">{name}</div>
                </li>
              </div>
            );
          })}

          {dropIndex === order.length && (
            <div
              className="w-full my-1 rounded h-0 overflow-visible"
              style={{
                transition: "height 140ms ease, opacity 140ms ease",
                height: "2px",
                opacity: 1,
              }}
            >
              <div
                className="w-full h-[2px] rounded"
                style={{ background: "var(--primary)" }}
              />
            </div>
          )}
        </ul>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <DialogClose asChild>
          <Button variant="outline" disabled={loading}>
            Cancel
          </Button>
        </DialogClose>

        <Button onClick={persistOrder} disabled={loading}>
          {loading ? "Saving..." : "Confirm"}
        </Button>
      </div>
    </div>
  );
}
