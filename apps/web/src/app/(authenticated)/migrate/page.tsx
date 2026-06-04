import { useState } from "react";
import { Link } from "react-router-dom";
import useAuth from "@/context/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import AppIcon from "@dashwise/app-icon";
import { migrateLegacyPageConfigAction } from '@/lib/apiClient';
import { fixMissingTitlesAction } from '@/lib/apiClient';

export default function MigratePage() {
  const [loading, setLoading] = useState(false);
  const { token, user } = useAuth();
  const [result, setResult] = useState<string | null>(null);

  const runMigration = async () => {
    if (!token) {
      setResult("Missing auth token");
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const res = await migrateLegacyPageConfigAction({ token });
      setResult(JSON.stringify(res, null, 2));
    } catch (err) {
      setResult(String(err));
    } finally {
      setLoading(false);
    }
  };

  const runFixMissingTitles = async () => {
    if (!token) {
      setResult("Missing auth token");
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const res = await fixMissingTitlesAction({ token });
      setResult(JSON.stringify(res, null, 2));
    } catch (err) {
      setResult(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 16, width: "50vw", marginInline: "auto" }} className="space-y-2">
      <h1 className="text-2xl font-bold">Migrations</h1>
      <p>Sometimes data doesn't persist fully across version updates.</p>
      <Card className="p-2 frosted">
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
      <Card className="frosted p-2">
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
        <Card className="p-2 frosted">
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
