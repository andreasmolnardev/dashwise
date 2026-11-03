import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import useAuth from "@/context/useAuth";
import { backendUrl } from "@/lib/apiClient";
import { setClientSessionId } from "@/lib/session";

export default function SSOCallbackPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuth();

  useEffect(() => {
    let active = true;
    void fetch(backendUrl("/api/v1/auth/sso/exchange"), {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      const result = await response.json().catch(() => ({}));
      if (!response.ok || typeof result?.token !== "string" || !result.user) {
        throw new Error("SSO sign in expired. Please try again.");
      }
      if (!active) return;
      if (typeof result.sessionId === "string") setClientSessionId(result.sessionId);
      setAuth(result.user, result.token);
      navigate("/home", { replace: true });
    }).catch(() => {
      if (active) navigate("/auth/login?sso=failed", { replace: true });
    });
    return () => { active = false; };
  }, [navigate, setAuth]);

  return (
    <main className="grid min-h-screen place-items-center bg-background text-foreground">
      <p role="status" className="text-sm text-muted-foreground">Completing single sign-on…</p>
    </main>
  );
}
