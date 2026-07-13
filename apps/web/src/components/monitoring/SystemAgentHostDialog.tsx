"use client";

import { useEffect, useState } from "react";
import useAuth from "@/context/useAuth";
import { createMonitoringHostAction, type MonitoringHostRecord } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (host: MonitoringHostRecord) => void;
};

export default function SystemAgentHostDialog({ open, onOpenChange, onSaved }: Props) {
  const { withAuth } = useAuth();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setUrl("");
    setToken("");
    setError(null);
  }, [open]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const agentUrl = new URL(url.trim());
      if (!/^https?:$/.test(agentUrl.protocol)) throw new Error("Agent URL must use HTTP or HTTPS");
      const liveUrl = new URL("/api/v1/metrics/stream", agentUrl);
      liveUrl.protocol = liveUrl.protocol === "https:" ? "wss:" : "ws:";
      const host = await withAuth((auth) => createMonitoringHostAction(auth, {
        name: name.trim() || agentUrl.hostname,
        hostname: agentUrl.hostname,
        port: Number(agentUrl.port || (agentUrl.protocol === "https:" ? 443 : 80)),
        url: agentUrl.origin,
        liveUrl: liveUrl.toString(),
        token: token.trim(),
      }));
      onSaved(host);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to connect System Agent");
    } finally {
      setSaving(false);
    }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="frosted text-foreground sm:max-w-lg">
      <DialogHeader><DialogTitle>Connect System Agent</DialogTitle></DialogHeader>
      <div className="space-y-4">
        {error ? <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
        <div className="space-y-2"><Label>Host name</Label><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Homeserver" className="border-white/10 bg-white/5" /></div>
        <div className="space-y-2"><Label>Agent URL</Label><Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="http://192.168.1.20:45876" className="border-white/10 bg-white/5" /><p className="text-xs text-white/50">Dashwise uses this URL for history and live metrics. Need help adding a system agent? <a href="https://github.com/andreasmolnardev/dashwise-system-agent/blob/main/supplemental/guides/systemd.md#agent" target="_blank" rel="noreferrer" className="text-primary underline underline-offset-4">Read install guide</a>.</p></div>
        <div className="space-y-2"><Label>Agent token</Label><Input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Bearer token" className="border-white/10 bg-white/5" /></div>
      </div>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => void save()} disabled={saving || !url.trim() || !token.trim()}>{saving ? "Connecting..." : "Connect"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
