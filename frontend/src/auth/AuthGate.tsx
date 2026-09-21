import { useEffect, type ReactNode } from "react";
import { setAuthTokenProvider } from "../config/api";
import { useAuth } from "./AuthProvider";

// Wires MSAL's getAccessToken into the apiFetch wrapper, and (when auth is enabled)
// blocks rendering of authenticated UI until the user signs in.
export function AuthGate({ children }: { children: ReactNode }) {
  const { enabled, isAuthenticated, account, login, getAccessToken, authError } = useAuth();

  // Set synchronously during render so child useEffect hooks have the provider
  // available on first mount (useEffect in parents runs after children's useEffect).
  setAuthTokenProvider(enabled ? () => getAccessToken() : null);

  // Cleanup only on unmount.
  useEffect(() => () => setAuthTokenProvider(null), []);

  if (!enabled) return <>{children}</>;
  if (!isAuthenticated || !account) {
    return (
      <div style={{ padding: 48, fontFamily: "sans-serif", textAlign: "center" }}>
        <h2>Azure Architect AI</h2>
        <p>Sign in with your work account to continue.</p>
        <button onClick={() => void login()} style={{ padding: "8px 16px", fontSize: 16 }}>
          Sign in
        </button>
        {authError && (
          <div
            role="alert"
            style={{
              margin: "24px auto 0",
              maxWidth: 640,
              padding: 16,
              textAlign: "left",
              border: "1px solid #d13438",
              borderRadius: 4,
              background: "#fdf3f4",
            }}
          >
            <strong>Sign-in failed ({authError.code})</strong>
            <p style={{ margin: "8px 0" }}>{authError.hint}</p>
            <details>
              <summary style={{ cursor: "pointer" }}>Entra error detail</summary>
              <pre style={{ whiteSpace: "pre-wrap", margin: "8px 0 0", fontSize: 12 }}>
                {authError.message}
              </pre>
            </details>
          </div>
        )}
      </div>
    );
  }
  return <>{children}</>;
}
