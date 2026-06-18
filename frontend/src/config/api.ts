// Centralized API URL + fetch wrapper.
// In dev, VITE_API_BASE_URL is unset and Vite proxies /api → http://localhost:8000.
// In a split-host deploy (e.g. SPA on Static Web Apps, API on Container Apps),
// set VITE_API_BASE_URL=https://api.example.com at build time.
const RAW_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").trim();
const API_BASE = RAW_BASE.replace(/\/+$/, "");

export function apiPath(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${p}` : p;
}

// Registered by AuthGate at mount time. Lets non-React modules attach Authorization
// headers without each one importing MSAL hooks.
type TokenProvider = () => Promise<string | null>;
let _tokenProvider: TokenProvider | null = null;
export function setAuthTokenProvider(provider: TokenProvider | null): void {
  _tokenProvider = provider;
}

// Error notification callback — registered by App via useEffect so toast system
// can be triggered from anywhere that calls apiFetch.
type ErrorNotifier = (message: string) => void;
let _errorNotifier: ErrorNotifier | null = null;
export function setErrorNotifier(notifier: ErrorNotifier | null): void {
  _errorNotifier = notifier;
}

// Active engagement ID — propagated as X-Engagement-Id on every API call so cost
// + scan endpoints auto-scope to the customer's subscriptions and chat picks up
// the engagement preamble. Registered by App from localStorage.
type EngagementProvider = () => string | null;
let _engagementProvider: EngagementProvider | null = null;
export function setEngagementProvider(provider: EngagementProvider | null): void {
  _engagementProvider = provider;
}
export function currentEngagementId(): string | null {
  return _engagementProvider?.() ?? null;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const callerSetAuth = headers.has("Authorization");
  if (_tokenProvider && !callerSetAuth) {
    const token = await _tokenProvider();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  if (_engagementProvider && !headers.has("X-Engagement-Id")) {
    const eid = _engagementProvider();
    if (eid) headers.set("X-Engagement-Id", eid);
  }
  let resp: Response;
  try {
    resp = await fetch(apiPath(path), { ...init, headers });
  } catch {
    _errorNotifier?.("Network error — could not reach the server.");
    throw new Error("Network error");
  }
  // On 401, force a fresh token acquisition (handles stale cached tokens) and retry once.
  if (resp.status === 401 && _tokenProvider && !callerSetAuth) {
    try {
      const freshToken = await _tokenProvider();
      if (freshToken) {
        const retryHeaders = new Headers(init.headers);
        retryHeaders.set("Authorization", `Bearer ${freshToken}`);
        resp = await fetch(apiPath(path), { ...init, headers: retryHeaders });
      }
    } catch { /* retry failed, return original 401 */ }
  }
  if (!resp.ok && resp.status >= 500) {
    _errorNotifier?.(`Server error (${resp.status}) — please try again.`);
  }
  return resp;
}
