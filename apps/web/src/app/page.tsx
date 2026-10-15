
import { Navigate, useLocation } from "react-router-dom";

export default function Page() {
  const { search } = useLocation();
  const loginToken = new URLSearchParams(search).get("loginToken");

  let hasStoredToken = false;
  if (!loginToken && typeof window !== "undefined") {
    try {
      hasStoredToken = Boolean(
        localStorage.getItem("pb_token") ||
        document.cookie
          .split("; ")
          .find((cookie) => cookie.startsWith("pb_token="))
          ?.split("=")[1],
      );
    } catch {
      // Storage can be unavailable; the auth welcome screen remains the safe fallback.
    }
  }

  const destination = loginToken
    ? `/auth${search}`
    : hasStoredToken
      ? "/home"
      : "/auth";

  return <Navigate to={destination} replace />;
}
