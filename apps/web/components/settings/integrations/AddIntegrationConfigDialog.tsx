"use client";

import { useState } from "react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
  const [stage, setStage] = useState<1 | 2>(1);

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        onOpenChange(open);
        if (!open) setStage(1);
      }}
    >
      <DialogContent className="frosted text-(--text-primary) w-[50vw]">
        <DialogHeader>
          <DialogTitle>Add a manual integration</DialogTitle>
          <DialogDescription>
            {stage === 1
              ? "Provide a name and configuration."
              : "Override environment variables before saving."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {stage === 1 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="integration-name">Integration name</Label>
                <Input
                  id="integration-name"
                  value={newName}
                  onChange={(event) =>
                    onNewNameChange(event.target.value)
                  }
                  placeholder="e.g. NewsFetcher"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="integration-config">
                  Config JSON or YAML
                </Label>
                <textarea
                  id="integration-config"
                  value={newConfig}
                  onChange={(event) =>
                    onNewConfigChange(event.target.value)
                  }
                  rows={6}
                  className="w-full rounded-xl border border-input bg-background/70 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2"
                  placeholder='{ "configuration": { "endpoints": [] } }'
                />
              </div>
            </>
          )}

          {stage === 2 && (
            <div className="space-y-2">
              <Label>Environment overrides (optional)</Label>

              {visibleEnvFields.length ? (
                <div className="space-y-3 max-h-[50dvh] overflow-y-scroll">
                  {visibleEnvFields.map((field) => (
                    <div
                      key={field.key}
                      className="bg-background/60 px-1 py-2 flex items-center justify-between gap-3"
                    >
                      <span className="text-sm">
                        {field.key}
                        {field.required && (
                          <span className="text-destructive-foreground ml-0.5">
                            *
                          </span>
                        )}
                        {field.description && (
                          <Tooltip>
                            <TooltipTrigger className="ml-1 cursor-pointer">
                              (i)
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{field.description}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </span>

                      <Input
                        id={`integration-env-${field.key}`}
                        value={environmentOverrides[field.key] ?? ""}
                        placeholder={
                          field.defaultValue ??
                          "Leave blank to use defaults"
                        }
                        onChange={(event) =>
                          onEnvironmentOverrideChange(
                            field.key,
                            event.target.value,
                          )
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm">
                  Paste a config JSON or YAML that declares
                  environment_variables to show override inputs here.
                </p>
              )}
            </div>
          )}

          {formError && (
            <p className="text-sm text-destructive-foreground">
              {formError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={creating}>
            Cancel
          </Button>

          {stage === 1 ? (
            <Button
              onClick={() => setStage(2)}
              disabled={!newName || !newConfig}
            >
              Configure Default Environment
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setStage(1)}
                disabled={creating}
              >
                Back
              </Button>

              <Button
                onClick={() => void onCreate()}
                disabled={creating}
              >
                {creating && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Create
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}