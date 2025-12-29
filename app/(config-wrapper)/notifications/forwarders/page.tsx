"use client";

import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { MoreHorizontal, Copy, Trash2, Edit2 } from "lucide-react";
import CreateForwarderDialogComponent, { ForwarderItem } from "@/components/notifications/CreateForwarderDialog";

export default function NotificationForwardersPage() {
    const [items, setItems] = useState<ForwarderItem[]>([]);
    const [topics, setTopics] = useState<{ id: string; title: string }[]>([]);
    const [activeTopic, setActiveTopic] = useState<string | null>(null);
    const [newForwarderDialogVisible, setNewForwarderDialogVisible] = useState(false);
    const [editingForwarder, setEditingForwarder] = useState<ForwarderItem | null>(null);
    const [editTarget, setEditTarget] = useState("");
    const [editIsActive, setEditIsActive] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const token = localStorage.getItem("pb_token");

    // Fetch topics
    const fetchTopics = async () => {
        if (!token) return;
        try {
            const res = await fetch("/api/v1/notifications/topics", {
                headers: { Authorization: `Bearer ${token}` },
            });
            const json = await res.json();
            if (res.ok && Array.isArray(json.items)) {
                setTopics(json.items);
                if (!activeTopic && json.items.length) setActiveTopic(json.items[0].id);
            }
        } catch (err) {
            console.error("Failed to fetch topics", err);
        }
    };

    // Fetch forwarders
    const fetchForwarders = async () => {
        if (!token) return;
        try {
            const res = await fetch("/api/v1/notifications/forwarders", {
                headers: { Authorization: `Bearer ${token}` },
            });
            const json = await res.json();
            if (Array.isArray(json.items)) setItems(json.items);
        } catch (err) {
            console.error("Failed to fetch forwarders", err);
        }
    };

    useEffect(() => {
        fetchForwarders();
        fetchTopics();
    }, []);

    const filtered = activeTopic
        ? items.filter((i) => i.topic?.id === activeTopic)
        : items;

    const fmt = (iso?: string | null) =>
        iso
            ? new Date(iso).toLocaleString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
            })
            : "—";

    const mask = (t: string) =>
        t.length <= 20 ? t : `${t.slice(0, 10)}…${t.slice(-10)}`;

    const copy = async (v: string) => {
        if (!v) return alert("No target value available");
        await navigator.clipboard.writeText(v);
    };

    const deleteForwarder = async (forwarderId: string) => {
        if (!token) return;
        if (!confirm("Are you sure you want to delete this forwarder?")) return;
        try {
            const res = await fetch("/api/v1/notifications/forwarders", {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ forwarderId }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error ?? "Failed to delete");
            setItems((old) => old.filter((i) => i.id !== forwarderId));
        } catch (err) {
            console.error(err);
            alert("Failed to delete forwarder");
        }
    };

    const startEdit = (forwarder: ForwarderItem) => {
        setEditingForwarder(forwarder);
        setEditTarget(forwarder.target);
        setEditIsActive(forwarder.isActive);
    };

    const saveEdit = async () => {
        if (!token || !editingForwarder) return;
        setIsSaving(true);

        try {
            const res = await fetch("/api/v1/notifications/forwarders", {
                method: "PUT",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    forwarderId: editingForwarder.id,
                    target: editTarget,
                    isActive: editIsActive,
                }),
            });

            const json = await res.json();
            if (!res.ok) throw new Error(json.error ?? "Failed to update");

            // Update the item in the list
            setItems((old) =>
                old.map((i) =>
                    i.id === editingForwarder.id
                        ? { ...i, target: editTarget, isActive: editIsActive }
                        : i
                )
            );

            setEditingForwarder(null);
        } catch (err) {
            console.error(err);
            alert("Failed to update forwarder");
        } finally {
            setIsSaving(false);
        }
    };

    const cancelEdit = () => {
        setEditingForwarder(null);
    };

    const getTopicTitle = (topicId: string) => {
        return topics.find((t) => t.id === topicId)?.title ?? topicId;
    };

    return (
        <>
            <div className="flex items-center justify-between mb-4">
                <h1 className="text-3xl font-semibold">Forwarders</h1>
                <Button onClick={() => setNewForwarderDialogVisible(true)}>Add forwarder</Button>
            </div>

            <div className="space-y-4">
                {/* Topic chips */}
                <div className="flex gap-2 overflow-x-auto mb-4">
                    <button
                        key="all"
                        onClick={() => setActiveTopic(null)}
                        className={cn(
                            "px-4 py-2 rounded-xl text-sm transition whitespace-nowrap",
                            activeTopic === null
                                ? "bg-white/20 backdrop-blur-md text-white border border-(--primary)"
                                : "bg-white/10 text-gray-100 hover:bg-white/20"
                        )}
                    >
                        All
                    </button>

                    {topics.map((t) => (
                        <button
                            key={t.id}
                            onClick={() => setActiveTopic(t.id)}
                            className={cn(
                                "px-4 py-2 rounded-xl text-sm transition whitespace-nowrap",
                                activeTopic === t.id
                                    ? "bg-white/20 backdrop-blur-md text-white border border-(--primary)"
                                    : "bg-white/10 text-gray-100 hover:bg-white/20"
                            )}
                        >
                            {t.title}
                        </button>
                    ))}
                </div>

                {/* Table */}
                {filtered.length === 0 ? (
                    <div className="text-center py-8 text-gray-400">
                        No forwarders configured
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Topic</TableHead>
                                <TableHead>Target</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Created</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.map((fwd) => (
                                <TableRow key={fwd.id}>
                                    <TableCell>
                                        {getTopicTitle(fwd.topic.id)}
                                    </TableCell>
                                    <TableCell className="font-mono text-xs">
                                        {editingForwarder?.id === fwd.id ? (
                                            <input
                                                type="text"
                                                value={editTarget}
                                                onChange={(e) => setEditTarget(e.target.value)}
                                                className="w-full bg-white/10 border border-white/20 rounded px-2 py-1"
                                            />
                                        ) : (
                                            <span title={fwd.target}>{mask(fwd.target)}</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {editingForwarder?.id === fwd.id ? (
                                            <label className="inline-flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    checked={editIsActive}
                                                    onChange={(e) => setEditIsActive(e.target.checked)}
                                                />
                                                <span className="text-xs">Active</span>
                                            </label>
                                        ) : (
                                            <span className={cn(
                                                "inline-block px-2 py-1 rounded text-xs",
                                                fwd.isActive ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"
                                            )}>
                                                {fwd.isActive ? "Active" : "Inactive"}
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {fmt(fwd.created)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {editingForwarder?.id === fwd.id ? (
                                            <div className="flex gap-2 justify-end">
                                                <button
                                                    onClick={saveEdit}
                                                    disabled={isSaving}
                                                    className="px-2 py-1 bg-blue-500/20 text-blue-300 rounded text-xs hover:bg-blue-500/30"
                                                >
                                                    {isSaving ? "Saving..." : "Save"}
                                                </button>
                                                <button
                                                    onClick={cancelEdit}
                                                    className="px-2 py-1 bg-gray-500/20 text-gray-300 rounded text-xs hover:bg-gray-500/30"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        ) : (
                                            <ForwarderActionsMenu
                                                forwarderId={fwd.id}
                                                target={fwd.target}
                                                onEdit={() => startEdit(fwd)}
                                                onDelete={() => deleteForwarder(fwd.id)}
                                                onCopy={() => copy(fwd.target)}
                                            />
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </div>

            <CreateForwarderDialogComponent
                open={newForwarderDialogVisible}
                onOpenChange={setNewForwarderDialogVisible}
                topics={topics}
                onForwarderCreated={(newItem) => {
                    setItems((old) => [...old, newItem]);
                }}
            />
        </>
    );
}

function ForwarderActionsMenu({
    forwarderId,
    target,
    onEdit,
    onDelete,
    onCopy,
}: {
    forwarderId: string;
    target: string;
    onEdit: () => void;
    onDelete: () => void;
    onCopy: () => void;
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <MoreHorizontal className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onEdit} className="cursor-pointer">
                    <Edit2 className="mr-2 h-4 w-4" />
                    Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onCopy} className="cursor-pointer">
                    <Copy className="mr-2 h-4 w-4" />
                    Copy Target
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDelete} className="cursor-pointer text-red-400">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
