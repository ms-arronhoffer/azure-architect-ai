// Maps MSAL/Entra failures to an actionable message.
//
// Without this, a misconfigured tenant surfaces only as
// `Uncaught (in promise) ServerError: invalid_resource: AADSTS500011 ...`
// in the browser console while the UI sits on the sign-in button, which gives
// no clue about *which* value is wrong or how to fix it.

export type AuthFailure = {
  code: string;
  message: string;
  hint: string;
};

export type AuthContextValues = {
  tenantId: string;
  clientId: string;
  apiScope: string;
};

const AADSTS = /AADSTS\d+/;

function errorCodeOf(err: unknown): string {
  const e = err as { errorCode?: unknown } | null;
  return typeof e?.errorCode === "string" ? e.errorCode : "";
}

function messageOf(err: unknown): string {
  const e = err as { errorMessage?: unknown } | null;
  if (typeof e?.errorMessage === "string" && e.errorMessage) return e.errorMessage;
  if (err instanceof Error && err.message) return err.message;
  return String(err ?? "Unknown authentication error");
}

/**
 * Returns null for benign outcomes (the user closed the popup), otherwise a
 * failure with a remediation hint naming the offending configuration value.
 */
export function describeAuthFailure(err: unknown, ctx: AuthContextValues): AuthFailure | null {
  const code = errorCodeOf(err);
  const message = messageOf(err);

  if (code === "user_cancelled" || (code === "popup_window_error" && /closed/i.test(message))) {
    return null;
  }
  if (!code && /user_cancelled|AADSTS50058|user closed/i.test(message)) {
    return null;
  }

  const aadsts = AADSTS.exec(message)?.[0] ?? "";
  const resource = ctx.apiScope.replace(/\/[^/]*$/, "");

  let hint: string;
  if (code === "invalid_resource" || aadsts === "AADSTS500011" || aadsts === "AADSTS650057") {
    hint =
      `Entra could not resolve the API resource "${resource}" in tenant ${ctx.tenantId}. ` +
      "The API app registration is missing its Application ID URI or has no service principal " +
      "(enterprise application) in this tenant. An administrator can repair it with " +
      "infra/scripts/ensure-entra-apps.sh, then reload this page.";
  } else if (aadsts === "AADSTS700016" || aadsts === "AADSTS700054") {
    hint =
      `The SPA client ID ${ctx.clientId} was not found in tenant ${ctx.tenantId}. ` +
      "Check VITE_ENTRA_CLIENT_ID and VITE_ENTRA_TENANT_ID on the frontend build.";
  } else if (aadsts === "AADSTS50011" || code === "redirect_uri_mismatch") {
    hint =
      `${window.location.origin} is not a registered redirect URI on the SPA app registration. ` +
      "Add it under Authentication → Single-page application.";
  } else if (aadsts === "AADSTS65001" || code === "consent_required" || code === "interaction_required") {
    hint =
      `Consent is required for ${ctx.apiScope}. Ask an administrator to grant admin consent, ` +
      "or pre-authorise the SPA on the API app registration.";
  } else {
    hint = "Sign-in failed. Check the browser console for the full Entra error, then retry.";
  }

  return { code: code || aadsts || "unknown_error", message, hint };
}
