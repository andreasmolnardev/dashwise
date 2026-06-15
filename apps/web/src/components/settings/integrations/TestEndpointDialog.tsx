"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCopy } from "@fortawesome/free-solid-svg-icons";
import { EndpointTestResult } from "@/lib/integrations/types";

type Props = {
  open: boolean;
  testing: boolean;
  testError: string | null;
  testResult: EndpointTestResult | null;
  testingTarget: string | null;
  onOpenChange: (open: boolean) => void;
};

type CopyStatus = "idle" | "copied" | "error";

export function TestEndpointDialog({
  open,
  testing,
  testError,
  testResult,
  testingTarget,
  onOpenChange,
}: Props) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const curlCommand = useMemo(
    () => (testResult ? buildCurlCommand(testResult.request) : null),
    [testResult]
  );

  useEffect(() => {
    setCopyStatus("idle");
  }, [curlCommand]);

  useEffect(() => {
    if (copyStatus === "idle") {
      return;
    }
    const timer = window.setTimeout(() => setCopyStatus("idle"), 2200);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  const handleCopyCurlCommand = async () => {
    if (!curlCommand) {
      return;
    }
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      setCopyStatus("error");
      return;
    }
    try {
      await navigator.clipboard.writeText(curlCommand);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl frosted text-(--text-primary) h-[80vh] overflow-scroll">
        <DialogHeader>
          <DialogTitle>Endpoint test{testingTarget ? ` · ${testingTarget}` : ""}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Shows the request that was sent and the response returned by the integration endpoint.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {testing ? <p className="text-sm text-muted-foreground">Testing the endpoint…</p> : null}
          {testError ? <p className="text-sm text-destructive-foreground">{testError}</p> : null}
          {testResult ? (
            <Tabs defaultValue="request" className="space-y-4">
              <TabsList>
                <TabsTrigger value="request">Request</TabsTrigger>
                <TabsTrigger value="response">Response</TabsTrigger>
                <TabsTrigger value="manual">Manual</TabsTrigger>
              </TabsList>
              <TabsContent
                value="request"
                className="space-y-4 rounded-2xl border border-border/70 bg-background/60 p-4 text-[0.75rem]"
              >
                <div className="space-y-1 text-[0.7rem] text-muted-foreground">
                  <span>Method</span>
                  <span className="font-mono">{testResult.request.method}</span>
                  <span>URL</span>
                  <span className="font-mono break-all">{testResult.endpoint.url}</span>
                </div>
                <div className="space-y-2">
                  <p className="font-semibold">Headers</p>
                  <div className="grid gap-1 text-muted-foreground">
                    {Object.entries(testResult.request.headers).map(([key, value]) => (
                      <div key={key} className="flex justify-between">
                        <span>{key}</span>
                        <span className="font-mono">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="font-semibold">Body</p>
                  <pre className="rounded border border-border/70 bg-background/70 p-2 text-xs">
                    {testResult.request.body ?? "—"}
                  </pre>
                </div>
              </TabsContent>
              <TabsContent
                value="response"
                className="space-y-4 rounded-2xl border border-border/70 bg-background/60 p-4 text-[0.75rem]"
              >
                <div className="space-y-2">
                  <p className="font-semibold">Headers</p>
                  <div className="grid gap-1 text-muted-foreground">
                    {Object.entries(testResult.response.headers).map(([key, value]) => (
                      <div key={key} className="flex justify-between">
                        <span>{key}</span>
                        <span className="font-mono">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="font-semibold">Body</p>
                  <pre className="rounded border border-border/70 bg-background/70 p-2 text-xs max-w-30 overflow-auto">
                    {testResult.response.body || "—"}
                  </pre>
                </div>
                {testResult.response.parsedBody ? (
                  <div className="space-y-1">
                    <p className="font-semibold">Parsed JSON</p>
                    <pre className="rounded border border-border/70 bg-background/70 p-2 text-xs max-h-32 max-w-full overflow-auto">
                      {JSON.stringify(testResult.response.parsedBody, null, 2)}
                    </pre>
                  </div>
                ) : null}
                <div className="space-y-1 text-[0.7rem] text-muted-foreground">
                  <span>Status</span>
                  <span className="font-mono">
                    {testResult.response.status} {testResult.response.statusText}
                  </span>
                </div>
              </TabsContent>
              <TabsContent
                value="manual"
                className="space-y-3 rounded-2xl border border-border/70 bg-background/60 p-3 text-[0.75rem]"
              >
                <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                  cURL command
                </p>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {copyStatus === "copied" ? (
                      <span className="text-[0.65rem] text-foreground">Copied</span>
                    ) : null}
                    {copyStatus === "error" ? (
                      <span className="text-[0.65rem] text-destructive-foreground">Copy failed</span>
                    ) : null}
                  </div>
                  <Button
                    aria-label="Copy the cURL command"
                    title="Copy the cURL command"
                    variant="ghost"
                    size="icon"
                    onClick={handleCopyCurlCommand}
                    disabled={testing || !curlCommand}
                  >
                    <FontAwesomeIcon icon={faCopy} />
                  </Button>
                </div>
                {curlCommand ? (
                  <pre className="whitespace-pre-wrap break-words rounded-2xl border border-border/70 bg-background/70 p-3 text-[0.7rem] font-mono leading-snug">
                    {curlCommand}
                  </pre>
                ) : (
                  <p className="text-xs text-muted-foreground">No command available for this request.</p>
                )}
              </TabsContent>
            </Tabs>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={testing}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildCurlCommand(request: EndpointTestResult["request"]) {
  const tokens: { text: string; quoted: boolean }[] = [{ text: "curl", quoted: false }];
  const method = (request.method ?? "GET").toUpperCase();
  if (method && method !== "GET") {
    tokens.push({ text: "-X", quoted: false });
    tokens.push({ text: method, quoted: true });
  }

  for (const [key, value] of Object.entries(request.headers ?? {})) {
    if (value === undefined || value === null) {
      continue;
    }
    tokens.push({ text: "-H", quoted: false });
    tokens.push({ text: `${key}: ${value}`, quoted: true });
  }

  if (request.body !== null && request.body !== undefined) {
    tokens.push({ text: "-d", quoted: false });
    tokens.push({ text: request.body, quoted: true });
  }

  tokens.push({ text: request.url, quoted: true });

  return tokens.map((token) => (token.quoted ? quoteShellArg(token.text) : token.text)).join(" ");
}

function quoteShellArg(value: string) {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}
