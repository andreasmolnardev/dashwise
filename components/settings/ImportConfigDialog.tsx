"use client"

import {
    Dialog,
    DialogContent,
    DialogClose,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"
import { Button } from "@/components/ui/button"
import { faCaretRight, faUpload } from "@fortawesome/free-solid-svg-icons"
import { Label } from "../ui/label.tsx"
import { Input } from "../ui/input.tsx"
import { useEffect, useState } from "react"
import useAuth from "@/context/useAuth"
import { useConfig } from "@/context/ConfigContext.tsx"

export default function ImportConfigDialog() {
    const { config, refreshConfig } = useConfig();
    const { token } = useAuth();
    const [raw, setRaw] = useState<string>("");
    const [parsed, setParsed] = useState<{} | null>(null);
    const [isUploading, setIsUploading] = useState<boolean>(false);
    const [message, setMessage] = useState<string | null>(null);

    const parseText = (text: string) => {
        setMessage(null);
        setRaw(text);
        try {
            const obj = JSON.parse(text)
            // TODO: validate config using zod or whatever...
            if (obj === null || typeof obj !== "object") {
                setParsed(null);
                setMessage("Must be a valid JSON file.");
                return;
            }
            setParsed(obj);
        } catch (e) {
            setParsed(null);
            setMessage("Invalid JSON");
        }
    };

    const handleUpload = async () => {
        if (!parsed) {
            setMessage("Please choose a file first.");
            return;
        }
        setIsUploading(true);
        setMessage(null);

        const tokenStr = token ?? "";

        try {
            const res = await fetch("/api/v1/config", {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenStr}`,
                },
                body: JSON.stringify({ config: parsed })
            })
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                setMessage(j.error || `HTTP ${res.status}`);
            }
            setMessage("Upload successful");
            setParsed(null);
            setRaw("");
            await refreshConfig();
        } catch (err: any) {
            setMessage(err?.message || "Upload failed due to an internal server error");
        } finally {
            setIsUploading(false);
        }
    }

    useEffect(() => {
        if (parsed === null) {
            const j = config ?? {};
            setRaw(JSON.stringify(j, null, 2));
            setParsed(j);
        }
    }, [config]);

    return (
        <Dialog>
            <DialogTrigger className="grid grid-cols-subgrid border border-transparent hover-frosted items-center col-span-full p-1.5 rounded-md">
                <FontAwesomeIcon icon={faUpload} />
                <p className="text-left">Import Another Config</p>
                <FontAwesomeIcon icon={faCaretRight} />
            </DialogTrigger>

            <DialogContent className="frosted text-(--text-primary)">
                <DialogHeader>
                    <DialogTitle>Import Config</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <Label htmlFor="config-file">Config File</Label>
                    <Input
                        id="config-file"
                        type="file"
                        accept="application/json"
                        disabled={isUploading}
                        onChange={(event) => {
                            event.target.files?.[0].text().then(parseText).catch(() => setMessage("Failed to read file"));
                        }}
                    />
                </div>

                <textarea
                    rows={40}
                    className="bg-gray-900 p-4 rounded text-sm overflow-auto max-h-96 font-mono"
                    value={raw}
                    onChange={(e) => parseText(e.target.value)}
                    disabled={isUploading}
                />

                {message && (
                    <div className="text-sm text-muted-foreground">{message}</div>
                )}

                <DialogFooter>
                    <DialogClose asChild>
                        <Button variant="outline">Close</Button>
                    </DialogClose>
                    <Button disabled={isUploading} onClick={handleUpload}>Upload JSON</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}