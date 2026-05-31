// MSAL configuration sourced from build-time Vite env vars.
// Auth is OFF when VITE_AUTH_ENABLED !== "true"; the AuthProvider degrades
// to a passthrough and apiFetch sends no Authorization header.
import type { Configuration, PopupRequest } from "@azure/msal-browser";

export const AUTH_ENABLED = (import.meta.env.VITE_AUTH_ENABLED ?? "").toLowerCase() === "true";

const tenantId = (import.meta.env.VITE_ENTRA_TENANT_ID ?? "").trim();
const clientId = (import.meta.env.VITE_ENTRA_CLIENT_ID ?? "").trim();
const apiScope = (import.meta.env.VITE_ENTRA_API_SCOPE ?? "").trim();

export const msalConfig: Configuration = {
  auth: {
    clientId,
    authority: tenantId ? `https://login.microsoftonline.com/${tenantId}` : undefined,
    redirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: "sessionStorage",
    storeAuthStateInCookie: false,
  },
};

export const loginRequest: PopupRequest = {
  scopes: apiScope ? [apiScope] : [],
};

export function authConfigured(): boolean {
  return AUTH_ENABLED && Boolean(tenantId && clientId && apiScope);
}
