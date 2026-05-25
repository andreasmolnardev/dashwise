"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { EnvDefinition } from "@/lib/integrations/types";

type EditIntegrationEnvironmentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integrationName: string;
  visibleEnvFields: EnvDefinition[];
  environmentValues: Record<string, string>;
  onEnvironmentValueChange: (key: string, value: string) => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
};

export function EditIntegrationEnvironmentDialog({
  open,
  onOpenChange,
  integrationName,
  visibleEnvFields,
  environmentValues,
  onEnvironmentValueChange,
  onSave,
  saving,
  error,
}: EditIntegrationEnvironmentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="frosted text-(--text-primary) w-[50vw] max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit environment for {integrationName}</DialogTitle>
          <DialogDescription>
            Update the environment variables used by this integration.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
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
                      <span className="text-destructive-foreground ml-0.5">*</span>
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
                    id={`edit-integration-env-${field.key}`}
                    value={environmentValues[field.key] ?? ""}
                    placeholder={field.defaultValue ?? "Leave blank to use defaults"}
                    onChange={(event) => onEnvironmentValueChange(field.key, event.target.value)}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              This integration does not declare any editable environment variables.
            </p>
          )}

          {error && <p className="text-sm text-destructive-foreground">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={saving || visibleEnvFields.length === 0}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save environment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}