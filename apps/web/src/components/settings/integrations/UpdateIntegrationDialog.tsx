import React from "react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface UpdateIntegrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integrationName: string;
  currentConfig: string;
  newConfig: string;
  newVersion: string;
  onConfirm: () => void;
  loading: boolean;
}

export function UpdateIntegrationDialog({
  open,
  onOpenChange,
  integrationName,
  currentConfig,
  newConfig,
  newVersion,
  onConfirm,
  loading,
}: UpdateIntegrationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Update {integrationName}</DialogTitle>
          <DialogDescription>
            A new version ({newVersion}) is available for this integration. Please review the changes carefully.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden space-y-4 py-4">
          <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive-foreground">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Security Warning</AlertTitle>
            <AlertDescription>
              This is a third-party integration. Updating it will execute new code/configuration which could potentially perform malicious actions. Only proceed if you trust the source.
            </AlertDescription>
          </Alert>

          <div className="rounded-xl border bg-muted/30 overflow-y-scroll">
              <ReactDiffViewer
                oldValue={currentConfig}
                newValue={newConfig}
                splitView={true}
                compareMethod={DiffMethod.WORDS}
                leftTitle="Current Configuration"
                rightTitle={`New Version (${newVersion})`}
                useDarkTheme={true}
                styles={{
                  variables: {
                    dark: {
                      diffViewerBackground: "transparent",
                    },
                  },
                }}
              />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={loading} className="gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Update to {newVersion}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
