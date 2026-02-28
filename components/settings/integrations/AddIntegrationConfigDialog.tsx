"use client";

import { Loader2 } from "lucide-react";
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
} from "@/components/ui/dialog";
import type { EnvDefinition } from "@/lib/integrations/types";

type AddIntegrationConfigDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  newName: string;
  onNewNameChange: (value: string) => void;
  newConfig: string;
  onNewConfigChange: (value: string) => void;
  visibleEnvFields: EnvDefinition[];
  environmentOverrides: Record<string, string>;
  onEnvironmentOverrideChange: (key: string, value: string) => void;
  formError: string | null;
  creating: boolean;
  onCancel: () => void;
  onCreate: () => void;
};

export function AddIntegrationConfigDialog({
  open,
  onOpenChange,
  newName,
  onNewNameChange,
  newConfig,
  onNewConfigChange,
  visibleEnvFields,
  environmentOverrides,
  onEnvironmentOverrideChange,
  formError,
  creating,
  onCancel,
  onCreate,
}: AddIntegrationConfigDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl frosted text-foreground">
        <DialogHeader>
          <DialogTitle>Add a manual integration</DialogTitle>
          <DialogDescription>
            Paste JSON or YAML configs and override visible environment variables before saving.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="integration-name">Integration name</Label>
            <Input
              id="integration-name"
              value={newName}
              onChange={(event) => onNewNameChange(event.target.value)}
              placeholder="e.g. NewsFetcher"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="integration-config">Config JSON or YAML</Label>
            <textarea
              id="integration-config"
              value={newConfig}
              onChange={(event) => onNewConfigChange(event.target.value)}
              rows={6}
              className="w-full rounded-xl border border-input bg-background/70 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2"
              placeholder='{ "configuration": { "endpoints": [] } }'
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="integration-environment">Environment overrides (optional)</Label>
            {visibleEnvFields.length ? (
              <div className="space-y-3">
                {visibleEnvFields.map((field) => (
                  <div
                    key={field.key}
                    className="rounded-xl border border-border/70 bg-background/60 px-3 py-2"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span>{field.key}</span>
                      {field.required ? <span className="text-destructive-foreground">required</span> : null}
                    </div>
                    <Input
                      id={`integration-env-${field.key}`}
                      value={environmentOverrides[field.key] ?? ""}
                      placeholder={field.defaultValue ?? "Leave blank to use defaults"}
                      onChange={(event) => onEnvironmentOverrideChange(field.key, event.target.value)}
                    />
                    {field.description ? (
                      <p className="text-[0.75rem]">{field.description}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm">
                Paste a config JSON or YAML that declares environment_variables to show override inputs here.
              </p>
            )}
          </div>
          {formError && <p className="text-sm text-destructive-foreground">{formError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={creating}>
            Cancel
          </Button>
          <Button onClick={() => void onCreate()} disabled={creating}>
            {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
