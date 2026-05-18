import { useState } from "react";
import { callApiAction } from "@/lib/apiClient";
import useAuth from "@/context/useAuth";

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
      const res = await callApiAction("pageConfig", "migrateLegacyAction", { auth: { token } });
      setResult(JSON.stringify(res, null, 2));
    } catch (err) {
      setResult(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h1>Run Legacy Config Migration</h1>
      <p>Trigger migration that converts legacy per-user config into new pageConfig and user prefs.</p>
      <button onClick={runMigration} disabled={loading}>
        {loading ? "Running migration…" : "Run migration for my account"}
      </button>
      {result && (
        <pre style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{result}</pre>
      )}
    </div>
  );
}
