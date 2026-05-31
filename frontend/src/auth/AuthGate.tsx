import { useEffect, type ReactNode } from "react";
import { setAuthTokenProvider } from "../config/api";
import { useAuth } from "./AuthProvider";

// Wires MSAL's getAccessToken into the apiFetch wrapper, and (when auth is enabled)
// blocks rendering of authenticated UI until the user signs in.
export function AuthGate({ children }: { children: ReactNode }) {
  const { enabled, isAuthenticated, account, login, getAccessToken } = useAuth();

  useEffect(() => {
    if (!enabled) {
      setAuthTokenProvider(null);
      return;
    }
    setAuthTokenProvider(() => getAccessToken());
    return () => setAuthTokenProvider(null);
  }, [enabled, getAccessToken]);

  if (!enabled) return <>{children}</>;
  if (!isAuthenticated || !account) {
    return (
      <div style={{ padding: 48, fontFamily: "sans-serif", textAlign: "center" }}>
        <h2>Azure Architect AI</h2>
        <p>Sign in with your work account to continue.</p>
        <button onClick={() => void login()} style={{ padding: "8px 16px", fontSize: 16 }}>
          Sign in
        </button>
      </div>
    );
  }
  return <>{children}</>;
}
