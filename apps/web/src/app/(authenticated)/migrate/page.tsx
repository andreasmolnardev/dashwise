import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import useAuth from "@/context/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import AppIcon from "@dashwise/app-icon";
import { migrateLegacyPageConfigAction } from '@/lib/apiClient';
import { fixMissingTitlesAction } from '@/lib/apiClient';

export default function MigratePage() {
  const [loading, setLoading] = useState(false);
  const { token, redirectToLogin, withAuthRedirect } = useAuth();
  const [result, setResult] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    if (!token) {
      redirectToLogin();
    }
  }, [redirectToLogin, token]);

  if (!token) return null;

  const runMigration = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await withAuthRedirect(migrateLegacyPageConfigAction);
      setResult(JSON.stringify(res, null, 2));
    } catch (err) {
      setResult(String(err));
    } finally {
      setLoading(false);
    }
  };

  const runFixMissingTitles = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await withAuthRedirect(fixMissingTitlesAction);
      setResult(JSON.stringify(res, null, 2));
    } catch (err) {
      setResult(String(err));
    } finally {
      setLoading(false);
    }
  };

  const downloadArchive = async () => {
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/v1/migration/export", {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({})))?.error ?? `Export failed (${response.status})`);
      const warnings = JSON.parse(decodeURIComponent(response.headers.get("x-dashwise-export-warnings") ?? "%5B%5D")) as string[];
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `dashwise-pocketbase-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportOpen(false);
      setResult(warnings.length
        ? `your private archive was downloaded with ${warnings.length} source mapping warning(s): ${warnings.join("; ")}. keep it secure and delete it after migration.`
        : "your private archive was downloaded. keep it secure and delete it after importing into go dashwise.");
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error));
    } finally { setLoading(false); }
  };

  return (
    <div style={{ padding: 16, width: "50vw", marginInline: "auto" }} className="space-y-2">
      <h1 className="text-2xl font-bold">Migrations</h1>
      <p>Sometimes data doesn't persist fully across version updates.</p>
      <Card className="p-2 frosted text-foreground">
        <h2 className="text-xl font-semibold">
          Legacy per-user config migration
        </h2>
        <p>
          Trigger migration that converts legacy per-user config into new
          pageConfig and user prefs.
        </p>
        <Button onClick={runMigration} disabled={loading} className="w-min ml-auto">
          <AppIcon source="solar:play-bold"/>
          {loading ? "Running migration…" : "Run migration"}
        </Button>
      </Card>
      <Card className="p-2 frosted text-foreground">
        <h2 className="text-xl font-semibold">export data for go dashwise</h2>
        <p>Download your account data as a private migration archive. It includes integration and monitor secrets so go dashwise can re-encrypt them during import. Keep the file private and delete it after migration.</p>
        <Button onClick={() => setExportOpen(true)} disabled={loading} className="w-min ml-auto">export data</Button>
      </Card>
      {exportOpen && <div role="dialog" aria-modal="true" aria-labelledby="export-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <Card className="frosted max-w-lg space-y-3 p-4 text-foreground">
          <h2 id="export-title" className="text-xl font-semibold">download migration archive?</h2>
          <p>the archive contains your dashwise data and private integration credentials. anyone with the file can access those values until go dashwise imports and re-encrypts them.</p>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setExportOpen(false)} disabled={loading}>cancel</Button><Button onClick={downloadArchive} disabled={loading}>{loading ? "preparing archive…" : "download archive"}</Button></div>
        </Card>
      </div>}
      <Card className="frosted p-2 text-foreground">
        <h2 className="text-xl font-semibold">
          News subscription add missing titles
        </h2>
        <p>
         Add subscription titles for those subscriptions where they're missing
        </p>
        <Button onClick={runFixMissingTitles} disabled={loading} className="w-min ml-auto">
          <AppIcon source="solar:play-bold"/>
          {loading ? "Running migration…" : "Run migration"}
        </Button>
      </Card>

      {result && (
        <Card className="p-2 frosted text-foreground">
          <h2 className="text-xl font-semibold">Result</h2>
          <pre style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{result}</pre>
        </Card>
      )}

      <Link to="/home">
        <Button variant={"ghost"} className="cursor-pointer">
          <AppIcon source="fa6-solid:arrow-left"/>
          Back to dashboard
        </Button>
      </Link>
    </div>
  );
}
