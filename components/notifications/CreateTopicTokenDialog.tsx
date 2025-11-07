"use client";

import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { Button } from "../ui/button";
import { TokenItem } from "@/app/(config-wrapper)/notifications/tokens/page";

type NewTokenDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    topics: { id: string; title: string }[];
    onTokenCreated?: (newItem: TokenItem) => void;
};


export default function CreateTopicTokenDialogComponent({
    open,
    onOpenChange,
    topics,
    onTokenCreated,
}: NewTokenDialogProps) {
    const [newTopicId, setNewTopicId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);

    const [expiryMode, setExpiryMode] = useState<"never" | "inDays" | "onDate">("never");
    const [inDays, setInDays] = useState<number>(30);
    const [onDate, setOnDate] = useState<string>(() => {
        const d = new Date();
        d.setMonth(d.getMonth() + 1);
        return d.toISOString().split("T")[0];
    });

    const expiryLabel = () => {
        if (expiryMode === "never") return "Never";
        if (expiryMode === "inDays") {
            const d = new Date();
            d.setDate(d.getDate() + (inDays || 0));
            return `In ${inDays} day${inDays === 1 ? "" : "s"} — ${format(d, "yyyy-MM-dd")}`;
        }
        if (expiryMode === "onDate") return onDate ? format(new Date(onDate), "yyyy-MM-dd") : "Select date";
        return "—";
    };

    type NewTokenDialogProps = {
        open: boolean;
        onOpenChange: (open: boolean) => void;
        topics: { id: string; title: string }[];
        onTokenCreated?: (newItem: TokenItem) => void; // optional parent callback
    };

    const handleCreate = async () => {
        if (!newTopicId) return;

        setCreating(true);
        try {
            const token = localStorage.getItem("pb_token");
            if (!token) throw new Error("No auth token");

            let expiresVal: string | undefined;
            if (expiryMode === "inDays") {
                const d = new Date();
                d.setDate(d.getDate() + (inDays || 0));
                expiresVal = d.toISOString();
            } else if (expiryMode === "onDate") {
                if (onDate) expiresVal = new Date(onDate).toISOString();
            }

            const body: Record<string, any> = { topicId: newTopicId };
            if (expiresVal) body.expires = expiresVal;

            const res = await fetch("/api/v1/notifications/topicTokens", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
            });

            const json = await res.json();
            if (!res.ok) throw new Error(json.error ?? "Failed to create token");

            // Add token locally in the dialog
            if (onTokenCreated) onTokenCreated(json.item);

            // Reset dialog state
            setNewTopicId(null);
            setExpiryMode("never");
            setInDays(30);
            const d = new Date();
            d.setMonth(d.getMonth() + 1);
            setOnDate(d.toISOString().split("T")[0]);

            onOpenChange(false);
        } catch (err) {
            console.error(err);
            alert("Failed to create token");
        } finally {
            setCreating(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="frosted text-(--text-primary)">
                <DialogHeader>
                    <DialogTitle>New Token</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Topic</label>
                        <Select onValueChange={(v) => setNewTopicId(v ?? null)}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select topic…" />
                            </SelectTrigger>
                            <SelectContent>
                                {topics.map((t) => (
                                    <SelectItem key={t.id} value={t.id}>
                                        {t.title}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Expiry</label>
                        <div className="flex gap-4 mb-2">
                            <label className="inline-flex items-center gap-2">
                                <input
                                    type="radio"
                                    name="expiry"
                                    value="never"
                                    checked={expiryMode === "never"}
                                    onChange={() => setExpiryMode("never")}
                                />
                                <span>Never</span>
                            </label>

                            <label className="inline-flex items-center gap-2">
                                <input
                                    type="radio"
                                    name="expiry"
                                    value="inDays"
                                    checked={expiryMode === "inDays"}
                                    onChange={() => setExpiryMode("inDays")}
                                />
                                <span>In x amount of days</span>
                            </label>

                            <label className="inline-flex items-center gap-2">
                                <input
                                    type="radio"
                                    name="expiry"
                                    value="onDate"
                                    checked={expiryMode === "onDate"}
                                    onChange={() => setExpiryMode("onDate")}
                                />
                                <span>On a specific date</span>
                            </label>
                        </div>

                        {/* Conditional inputs based on selection */}
                        {expiryMode === "inDays" && (
                            <div className="flex items-center gap-2">
                                <input
                                    type="number"
                                    min={1}
                                    className="w-20 rounded px-2 py-1 bg-transparent border border-white/10"
                                    value={inDays}
                                    onChange={(e) => setInDays(Number(e.target.value || 0))}
                                />
                                <span>day{inDays === 1 ? "" : "s"}</span>
                                <span className="text-xs text-(--text-secondary)">({expiryLabel()})</span>
                            </div>
                        )}

                        {expiryMode === "onDate" && (
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline">
                                        {onDate ? format(new Date(onDate), "yyyy-MM-dd") : "Select date"}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
                                    <Calendar
                                        mode="single"
                                        selected={onDate ? new Date(onDate) : undefined}
                                        onSelect={(date) => date && setOnDate(date.toISOString().split("T")[0])}
                                    />
                                </PopoverContent>
                            </Popover>
                        )}
                    </div>
                </div>

                <DialogFooter className="mt-4 flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button disabled={!newTopicId || creating} onClick={handleCreate}>Create</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
