import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import useAuth from "@/context/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import AppIcon from "@dashwise/app-icon";
import {
  exportMigrationArchiveAction,
  importMigrationArchiveAction,
  type MigrationArchiveImportResult,
} from "@/lib/migrationArchiveApi";

type ImportNotice = { kind: "success" | "error"; message: string; result?: MigrationArchiveImportResult };

export default function MigratePage() {
  const { token, redirectToLogin, withAuthRedirect } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState<"export" | "import" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [notice, setNotice] = useState<ImportNotice | null>(null);

  useEffect(() => {
    if (!token) redirectToLogin();
  }, [redirectToLogin, token]);

  if (!token) return null;

  const exportArchive = async () => {
    setLoading("export");
    setNotice(null);
    try {
      const blob = await withAuthRedirect(exportMigrationArchiveAction);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `dashwise-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setNotice({ kind: "success", message: "your account archive has been downloaded." });
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "could not export account data." });
    } finally {
      setLoading(null);
    }
  };

  const importArchive = async () => {
    if (!file) return;
    setLoading("import");
    setConfirmOpen(false);
    setNotice(null);
    try {
      let archive: unknown;
      try {
        archive = JSON.parse(await file.text());
      } catch {
        throw new Error("choose a valid JSON archive file.");
      }
      if (!archive || typeof archive !== "object" || Array.isArray(archive)) {
        throw new Error("the selected file is not a dashwise archive.");
      }
      const result = await withAuthRedirect((auth) => importMigrationArchiveAction(auth, archive));
      setNotice({ kind: "success", message: "the archive was imported into your account.", result });
      setFile(null);
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "could not import the archive." });
    } finally {
      setLoading(null);
    }
  };

  return (
    <main className="mx-auto w-full max-w-3xl space-y-5 p-4 text-foreground sm:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">account data</h1>
        <p className="text-sm opacity-75">export a copy of your dashwise data or import an archive into this account.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="frosted flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2">
            <AppIcon source="solar:download-minimalistic-bold" />
            <h2 className="text-lg font-medium">export data</h2>
          </div>
          <p className="min-h-12 text-sm opacity-75">
            download an archive of your links, views, integrations, activities, news, monitoring, notifications, and other account data.
          </p>
          <Button onClick={exportArchive} disabled={loading !== null} className="mt-auto w-fit">
            {loading === "export" ? "preparing archive…" : "download archive"}
          </Button>
        </Card>

        <Card className="frosted flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2">
            <AppIcon source="solar:upload-minimalistic-bold" />
            <h2 className="text-lg font-medium">import data</h2>
          </div>
          <p className="min-h-12 text-sm opacity-75">
            choose a dashwise json archive. imported records are merged into the account you are signed in to.
          </p>
          <Input
            key={file?.name ?? "empty"}
            type="file"
            accept="application/json,.json"
            aria-label="choose a dashwise archive"
            disabled={loading !== null}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setNotice(null);
            }}
          />
          {file && <p className="truncate text-xs opacity-70">selected: {file.name}</p>}
          <Button onClick={() => setConfirmOpen(true)} disabled={!file || loading !== null} className="mt-auto w-fit">
            {loading === "import" ? "importing archive…" : "import archive"}
          </Button>
        </Card>
      </div>

      {notice && (
        <Card className="frosted space-y-2 p-4" role={notice.kind === "error" ? "alert" : "status"}>
          <p className={notice.kind === "error" ? "text-destructive" : ""}>{notice.message}</p>
          {notice.result && (
            <>
              <p className="text-sm font-medium">records imported</p>
              <ul className="grid gap-x-5 gap-y-1 text-sm opacity-80 sm:grid-cols-2">
                {Object.entries(notice.result.imported ?? {}).map(([table, count]) => (
                  <li key={table} className="flex justify-between gap-3">
                    <span className="break-all">{table}</span>
                    <span className="font-mono">{count}</span>
                  </li>
                ))}
              </ul>
              {!!notice.result.skipped?.length && (
                <div className="space-y-1 text-sm">
                  <p className="font-medium">skipped items</p>
                  <ul className="list-inside list-disc opacity-80">
                    {notice.result.skipped.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}
        </Card>
      )}

      <Link to="/home" className="inline-flex">
        <Button variant="ghost" className="cursor-pointer">
          <AppIcon source="fa6-solid:arrow-left" />
          back to dashboard
        </Button>
      </Link>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="frosted text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>import this archive?</AlertDialogTitle>
            <AlertDialogDescription>
              Data from “{file?.name}” will be merged into the account you are signed in to. Existing records may be updated when their ids match.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading !== null}>cancel</AlertDialogCancel>
            <AlertDialogAction disabled={loading !== null || !file} onClick={(event) => { event.preventDefault(); void importArchive(); }}>
              import into this account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
