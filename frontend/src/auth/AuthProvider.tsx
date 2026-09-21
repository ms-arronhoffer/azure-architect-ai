import { PublicClientApplication } from "@azure/msal-browser";
import { MsalProvider, useMsal, useIsAuthenticated } from "@azure/msal-react";
import { useSyncExternalStore, type ReactNode } from "react";
import {
  AUTH_ENABLED,
  apiScope,
  authConfigured,
  clientId,
  loginRequest,
  msalConfig,
  tenantId,
} from "./msalConfig";
import { describeAuthFailure, type AuthFailure } from "./authErrors";

// Singleton MSAL instance — created lazily so dev builds without env vars
// don't blow up at import time.
let _instance: PublicClientApplication | null = null;
function getInstance(): PublicClientApplication {
  if (!_instance) {
    _instance = new PublicClientApplication(msalConfig);
  }
  return _instance;
}

// Module-level failure store. MSAL errors surface from promises that several
// unrelated callers await (the sign-in button, the apiFetch token provider), so
// the last failure is parked here and rendered once by AuthGate instead of
// escaping as an unhandled rejection in the console.
let _failure: AuthFailure | null = null;
const _listeners = new Set<() => void>();

function emit(): void {
  for (const listener of _listeners) listener();
}

function subscribeFailure(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

function snapshotFailure(): AuthFailure | null {
  return _failure;
}

export function recordAuthFailure(err: unknown): AuthFailure | null {
  const failure = describeAuthFailure(err, { tenantId, clientId, apiScope });
  if (failure) {
    console.error("auth.failed", failure.code, failure.message);
  }
  _failure = failure;
  emit();
  return failure;
}

export function clearAuthFailure(): void {
  if (_failure === null) return;
  _failure = null;
  emit();
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
  const authError = useSyncExternalStore(subscribeFailure, snapshotFailure, snapshotFailure);

  async function login() {
    if (!AUTH_ENABLED) return;
    clearAuthFailure();
    try {
      await msal.instance.loginPopup(loginRequest);
    } catch (err) {
      // Never rethrow: this is fired from an onClick handler, where a rejected
      // promise is invisible to the user apart from a console stack trace.
      recordAuthFailure(err);
    }
  }

  async function logout() {
    if (!AUTH_ENABLED) return;
    try {
      await msal.instance.logoutPopup();
    } catch (err) {
      recordAuthFailure(err);
    }
  }

  async function getAccessToken(): Promise<string | null> {
    if (!AUTH_ENABLED) return null;
    const account = msal.accounts[0];
    if (!account) return null;
    try {
      const result = await msal.instance.acquireTokenSilent({ ...loginRequest, account });
      clearAuthFailure();
      return result.accessToken;
    } catch {
      try {
        const result = await msal.instance.acquireTokenPopup(loginRequest);
        clearAuthFailure();
        return result.accessToken;
      } catch (err) {
        // apiFetch awaits this provider; returning null lets the request go out
        // unauthenticated and fail with a 401 instead of rejecting everywhere.
        recordAuthFailure(err);
        return null;
      }
    }
  }

  return {
    enabled: AUTH_ENABLED,
    isAuthenticated: AUTH_ENABLED ? isAuthenticated : true,
    account: AUTH_ENABLED ? msal.accounts[0] ?? null : null,
    authError,
    roles: AUTH_ENABLED
      ? ((msal.accounts[0]?.idTokenClaims as Record<string, unknown>)?.roles as string[] ?? [])
      : [],
    login,
    logout,
    getAccessToken,
  };
}
