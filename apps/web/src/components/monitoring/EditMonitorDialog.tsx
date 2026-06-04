"use client";

import { useEffect, useMemo, useState } from "react";
import useAuth from "@/context/useAuth";
import { updateMonitorAction, type MonitorRecord } from '@/lib/apiClient';
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildEndpointAuthPayload,
  parseEndpointAuth,
  parseResponseFilter,
  type EndpointAuthMode,
} from "./monitoringFormUtils";

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  monitor: MonitorRecord | null;
  onUpdated?: (monitor: MonitorRecord) => void;
};

export default function EditMonitorDialog({ open, onOpenChange, monitor, onUpdated }: Props) {
  const { token, withAuth } = useAuth();
  const [endpoint, setEndpoint] = useState("");
  const [method, setMethod] = useState("GET");
  const [expectedStatusCodes, setExpectedStatusCodes] = useState("");
  const [expectedResponseBody, setExpectedResponseBody] = useState("");
  const [endpointAuthMode, setEndpointAuthMode] = useState<EndpointAuthMode>("none");
  const [basicUsername, setBasicUsername] = useState("");
  const [basicPassword, setBasicPassword] = useState("");
  const [bearerToken, setBearerToken] = useState("");
  const [headerName, setHeaderName] = useState("");
  const [headerValue, setHeaderValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !monitor) return;

    setEndpoint(String(monitor.endpoint || ""));
    setMethod(String(monitor.method || "GET"));

    const responseFilter = parseResponseFilter(monitor.responseUpFilter);
    setExpectedStatusCodes(String(responseFilter.acceptStatusCodes || ""));
    setExpectedResponseBody(
      responseFilter.acceptBodyProperties !== undefined
        ? typeof responseFilter.acceptBodyProperties === "string"
          ? responseFilter.acceptBodyProperties
          : JSON.stringify(responseFilter.acceptBodyProperties, null, 2)
        : ""
    );

    const auth = parseEndpointAuth(monitor.endpointAuth);
    setEndpointAuthMode(auth.mode);
    setBasicUsername(auth.username || "");
    setBasicPassword(auth.password || "");
    setBearerToken(auth.token || "");
    setHeaderName(auth.headerName || "");
    setHeaderValue(auth.headerValue || "");

    setError(null);
  }, [open, monitor]);

  const authPayload = useMemo(
    () =>
      buildEndpointAuthPayload({
        mode: endpointAuthMode,
        basicUsername,
        basicPassword,
        bearerToken,
        headerName,
        headerValue,
      }),
    [endpointAuthMode, basicUsername, basicPassword, bearerToken, headerName, headerValue],
  );

  const handleSave = async () => {
    if (!token || !monitor) return;
    if (!endpoint.trim()) {
      setError("Endpoint is required");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const responseFilter = buildResponseUpFilter({
        acceptStatusCodes: expectedStatusCodes,
        acceptBodyProperties: expectedResponseBody,
      });

      const updated = await withAuth((auth) =>
        updateMonitorAction(auth, monitor.id, {
          endpoint: endpoint.trim(),
          method,
          endpointAuth: authPayload,
          responseUpFilter: responseFilter,
        })
      );

      if (updated) {
        onUpdated?.(updated as MonitorRecord);
        onOpenChange(false);
      }
    } catch (err) {
      console.error("Failed to update monitor:", err);
      setError(err instanceof Error ? err.message : "Failed to update monitor");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(720px,95%)] text-foreground frosted">
        <DialogHeader>
          <DialogTitle>Edit monitor</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="space-y-2">
            <Label>Endpoint</Label>
            <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://example.com/status" />
          </div>

          <div className="space-y-2">
            <Label>Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger>
                <SelectValue placeholder="Select method" />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Expected status codes</Label>
            <Input
              value={expectedStatusCodes}
              onChange={(e) => setExpectedStatusCodes(e.target.value)}
              placeholder="200-299"
            />
          </div>

          <div className="space-y-2">
            <Label>Expected response body</Label>
            <Input
              value={expectedResponseBody}
              onChange={(e) => setExpectedResponseBody(e.target.value)}
              placeholder="Optional JSON or text"
            />
          </div>

          <div className="space-y-2">
            <Label>Endpoint auth</Label>
            <Select value={endpointAuthMode} onValueChange={(value) => setEndpointAuthMode(value as EndpointAuthMode)}>
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="basic">Basic</SelectItem>
                <SelectItem value="bearer">Bearer</SelectItem>
                <SelectItem value="header">Header</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {endpointAuthMode === "basic" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Basic username</Label>
                <Input value={basicUsername} onChange={(e) => setBasicUsername(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Basic password</Label>
                <Input type="password" value={basicPassword} onChange={(e) => setBasicPassword(e.target.value)} />
              </div>
            </div>
          )}

          {endpointAuthMode === "bearer" && (
            <div className="space-y-2">
              <Label>Bearer token</Label>
              <Input value={bearerToken} onChange={(e) => setBearerToken(e.target.value)} />
            </div>
          )}

          {endpointAuthMode === "header" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Header name</Label>
                <Input value={headerName} onChange={(e) => setHeaderName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Header value</Label>
                <Input value={headerValue} onChange={(e) => setHeaderValue(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
