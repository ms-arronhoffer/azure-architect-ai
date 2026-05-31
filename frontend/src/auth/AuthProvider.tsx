import { PublicClientApplication } from "@azure/msal-browser";
import { MsalProvider, useMsal, useIsAuthenticated } from "@azure/msal-react";
import type { ReactNode } from "react";
import { AUTH_ENABLED, authConfigured, loginRequest, msalConfig } from "./msalConfig";

// Singleton MSAL instance — created lazily so dev builds without env vars
// don't blow up at import time.
let _instance: PublicClientApplication | null = null;
function getInstance(): PublicClientApplication {
  if (!_instance) {
    _instance = new PublicClientApplication(msalConfig);
  }
  return _instance;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!AUTH_ENABLED) return <>{children}</>;
  if (!authConfigured()) {
    return (
      <div style={{ padding: 24, fontFamily: "sans-serif" }}>
        <h2>Authentication misconfigured</h2>
        <p>
          VITE_AUTH_ENABLED=true but one of VITE_ENTRA_TENANT_ID, VITE_ENTRA_CLIENT_ID, or
          VITE_ENTRA_API_SCOPE is missing. Check your build environment.
        </p>
      </div>
    );
  }
  return <MsalProvider instance={getInstance()}>{children}</MsalProvider>;
}

export function useAuth() {
  // Hooks always run — but their values only matter when AUTH_ENABLED.
  const msal = useMsal();
  const isAuthenticated = useIsAuthenticated();

  async function login() {
    if (!AUTH_ENABLED) return;
    await msal.instance.loginPopup(loginRequest);
  }

  async function logout() {
    if (!AUTH_ENABLED) return;
    await msal.instance.logoutPopup();
  }

  async function getAccessToken(): Promise<string | null> {
    if (!AUTH_ENABLED) return null;
    const account = msal.accounts[0];
    if (!account) return null;
    try {
      const result = await msal.instance.acquireTokenSilent({ ...loginRequest, account });
      return result.accessToken;
    } catch {
      const result = await msal.instance.acquireTokenPopup(loginRequest);
      return result.accessToken;
    }
  }

  return {
    enabled: AUTH_ENABLED,
    isAuthenticated: AUTH_ENABLED ? isAuthenticated : true,
    account: AUTH_ENABLED ? msal.accounts[0] ?? null : null,
    login,
    logout,
    getAccessToken,
  };
}
