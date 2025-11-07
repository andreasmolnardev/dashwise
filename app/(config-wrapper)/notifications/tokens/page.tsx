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
import { MoreHorizontal } from "lucide-react";
import { format } from "date-fns";
import CreateTopicTokenDialogComponent from "@/components/notifications/CreateTopicTokenDialog";

export type TokenItem = {
    id: string;
    token: string | null;
    topic: { id: string; title?: string };
    created?: string | null;
    expires?: string | null;
};

export default function SearchSettingsPage() {
    const [items, setItems] = useState<TokenItem[]>([]);
    const [topics, setTopics] = useState<{ id: string; title: string }[]>([]);
    const [activeTopic, setActiveTopic] = useState<string | null>(null);
    const [visible, setVisible] = useState<Record<string, boolean>>({});
    const [newTokenDialogVisible, setNewTokenDialogVisible] = useState(false);
    const [newTopicId, setNewTopicId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);

    // New expiry UI states:
    const [expiryMode, setExpiryMode] = useState<"never" | "inDays" | "onDate">("never");
    const [inDays, setInDays] = useState<number>(30);
    const [onDate, setOnDate] = useState<string>(() => {
        const d = new Date();
        d.setMonth(d.getMonth() + 1);
        return d.toISOString().split("T")[0];
    });

    useEffect(() => {
        const token = localStorage.getItem("pb_token");
        if (!token) return;

        fetch("/api/v1/notifications/topicTokens", {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then((r) => r.json())
            .then(({ items }) => setItems(items ?? []))
            .catch(console.error);

        fetch("/api/v1/notifications/topics", {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then((r) => r.json())
            .then(({ items }) => {
                setTopics(items ?? []);
                if (items?.length) setActiveTopic(items[0].id);
            })
            .catch(console.error);
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

    const mask = (t: string | null) =>
        !t ? "—" : t.length <= 10 ? t : `${t.slice(0, 6)}…${t.slice(-6)}`;

    const copy = async (v: string | null) => {
        if (!v) return alert("No token value available");
        await navigator.clipboard.writeText(v);
    };



    // Helper to show a compact label for the chosen expiry
    const expiryLabel = () => {
        if (expiryMode === "never") return "Never";
        if (expiryMode === "inDays") {
            const d = new Date();
            d.setDate(d.getDate() + (inDays || 0));
            return `In ${inDays} day${inDays === 1 ? "" : "s"} — ${format(d, "yyyy-MM-dd")}`;
        }
        if (expiryMode === "onDate") {
            return onDate ? format(new Date(onDate), "yyyy-MM-dd") : "Select date";
        }
        return "—";
    };

    const revokeToken = async (tokenId: string) => {
        const token = localStorage.getItem("pb_token");
        if (!token) return;

        if (!confirm("Are you sure you want to revoke this token?")) return;

        try {
            const res = await fetch("/api/v1/notifications/topicTokens", {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ tokenId }),
            });

            const json = await res.json();
            if (!res.ok) throw new Error(json.error ?? "Failed to revoke");

            // Remove the token locally
            setItems((old) => old.filter((i) => i.id !== tokenId));
        } catch (err) {
            console.error(err);
            alert("Failed to revoke token");
        }
    };


    return (
        <>
            <div className="flex items-center justify-between mb-4">
                <h1 className="text-3xl font-semibold">Tokens</h1>
                <Button onClick={() => setNewTokenDialogVisible(true)}>Add token</Button>
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

                {/* Tokens list */}
                {filtered.map((tk) => (
                    <div
                        key={tk.id}
                        className="frosted p-4 rounded-xl border border-white/20 backdrop-blur-md flex justify-between items-start shadow-lg group"
                    >
                        <div className="flex flex-col gap-2 w-full">
                            <div className="flex justify-between text-xs text-(--text-secondary)">
                                <span className="font-semibold">{tk.topic?.title ?? tk.topic?.id}</span>
                                <span>{fmt(tk.created)}</span>
                            </div>

                            <div
                                className={cn(
                                    "font-mono text-sm group-hover:text-(--primary)",
                                    visible[tk.id] ? "font-bold" : ""
                                )}
                            >
                                {visible[tk.id] ? tk.token ?? "—" : mask(tk.token)}
                            </div>

                            <div className="text-xs text-(--text-secondary)">
                                Expires: {tk.expires ? fmt(tk.expires) : "Never"}
                            </div>

                            <Button
                                variant="ghost"
                                size="sm"
                                className="w-fit px-2"
                                onClick={() => setVisible((s) => ({ ...s, [tk.id]: !s[tk.id] }))}
                            >
                                {visible[tk.id] ? "Hide" : "Show"}
                            </Button>
                        </div>

                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="p-2">
                                    <MoreHorizontal />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="frosted">
                                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                <DropdownMenuItem onClick={() => copy(tk.token)}>Copy token</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => navigator.clipboard.writeText(tk.id)}>Copy token ID</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => revokeToken(tk.id)}>Revoke</DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                ))}

                {!filtered.length && (
                    <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                        <h2 className="text-lg font-semibold mb-1">No tokens</h2>
                        <p>Nothing here yet</p>
                    </div>
                )}

                <CreateTopicTokenDialogComponent
                    open={newTokenDialogVisible}
                    onOpenChange={setNewTokenDialogVisible} topics={topics}
                    onTokenCreated={(newItem: TokenItem) => {
                        setItems((old) => [...old, newItem]);
                    }} />
            </div>
        </>
    );
}
