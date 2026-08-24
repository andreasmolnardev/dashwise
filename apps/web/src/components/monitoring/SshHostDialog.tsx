"use client";

import { useEffect, useState } from "react";
import useAuth from "@/context/useAuth";
import { createMonitoringSshHostAction, updateMonitoringSshHostAction, type MonitoringSshHostRecord } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  host?: MonitoringSshHostRecord | null;
  onSaved?: (host: MonitoringSshHostRecord) => void;
};

export default function SshHostDialog({ open, onOpenChange, host, onSaved }: Props) {
  const { withAuth } = useAuth();
  const [name, setName] = useState("");
  const [hostname, setHostname] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [authMethod, setAuthMethod] = useState<"password" | "key">("password");
  const [password, setPassword] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(host?.name || "");
    setHostname(host?.hostname || "");
    setPort(String(host?.port || 22));
    setUsername(host?.username || "");
    setAuthMethod(host?.authMethod || "password");
    setPassword("");
    setPublicKey("");
    setPrivateKey("");
    setError(null);
  }, [open, host]);

  const save = async () => {
    if (!name.trim() || !hostname.trim() || !username.trim()) {
      setError("Name, hostname/IP, and username are required");
      return;
    }

    const authMethodChanged = Boolean(host && host.authMethod !== authMethod);
    if (authMethod === "password" && (!host || authMethodChanged) && !password) {
      setError("Password is required");
      return;
    }
    if (authMethod === "key" && (!host || authMethodChanged) && (!publicKey.trim() || !privateKey.trim())) {
      setError("Public and private keys are required");
      return;
    }

    const payload = {
      name: name.trim(),
      hostname: hostname.trim(),
      port: Number(port || 22),
      username: username.trim(),
      authMethod,
      ...(authMethod === "password" && password ? { password } : {}),
      ...(authMethod === "key" && (publicKey || privateKey) ? { publicKey, privateKey } : {}),
    };

    setSaving(true);
    setError(null);

    try {
      const saved = host?.id
        ? await withAuth((auth) => updateMonitoringSshHostAction(auth, host.id, payload))
        : await withAuth((auth) => createMonitoringSshHostAction(auth, payload));
      onSaved?.(saved);
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save SSH host");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(720px,95%)] text-foreground frosted">
        <DialogHeader>
          <DialogTitle>{host ? "Edit SSH host" : "Add SSH host"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="space-y-2">
            <Label>Host name</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Homelab server" />
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
            <div className="space-y-2">
              <Label>Hostname/IP</Label>
              <Input value={hostname} onChange={(event) => setHostname(event.target.value)} placeholder="192.168.1.10" />
            </div>
            <div className="space-y-2">
              <Label>Port</Label>
              <Input type="number" min="1" max="65535" value={port} onChange={(event) => setPort(event.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Username</Label>
            <Input value={username} onChange={(event) => setUsername(event.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Authentication</Label>
            <Select value={authMethod} onValueChange={(value) => setAuthMethod(value as "password" | "key")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="password">Username/password</SelectItem>
                <SelectItem value="key">Public/private key</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {authMethod === "password" ? (
            <div className="space-y-2">
              <Label>Password{host?.hasCredential ? " (leave blank to keep current)" : ""}</Label>
              <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Public key</Label>
                <Textarea value={publicKey} onChange={(event) => setPublicKey(event.target.value)} placeholder="ssh-ed25519 ..." />
              </div>
              <div className="space-y-2">
                <Label>Private key{host?.hasCredential ? " (leave blank to keep current)" : ""}</Label>
                <Textarea value={privateKey} onChange={(event) => setPrivateKey(event.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save host"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
