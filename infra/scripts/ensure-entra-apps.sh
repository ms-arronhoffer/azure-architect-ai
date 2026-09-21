#!/usr/bin/env bash
# Idempotently repair the two Entra app registrations the SPA + API depend on.
#
# Fixes AADSTS500011 ("The resource principal named api://<api-app-id> was not
# found in the tenant"), which happens when any of the following drifted:
#   1. the API app registration has no Application ID URI (api://<client-id>),
#   2. the API app has no service principal (enterprise app) in the tenant,
#   3. the API app never exposed the access_as_user delegated scope,
#   4. the SPA app does not request that scope / is not pre-authorised,
#   5. the SPA app lost its redirect URIs.
#
# MSAL asks Entra for a token for the *resource* api://<api-app-id>; Entra can
# only resolve that resource if a service principal for the app exists in the
# signing-in tenant, so a bare app registration is not enough.
#
# Usage:
#   ./infra/scripts/ensure-entra-apps.sh \
#     --tenant-id  16b3c013-d300-468d-ac64-7eda0820b6d3 \
#     --api-app-id 5e5c9491-d850-4f1b-9d67-939824a4c819 \
#     --spa-app-id e9616e6b-3c8b-4153-b814-b01817c9ade2 \
#     --redirect-uri https://blueprint.techtools.host/ \
#     --redirect-uri https://dev.blueprint.techtools.host/
#
# Add --dry-run to print the changes without applying them.
#
# Requires: az (signed in to the target tenant as Application Administrator or
# Cloud Application Administrator), jq.

set -euo pipefail

GRAPH="https://graph.microsoft.com/v1.0"
API_SCOPE_NAME="access_as_user"
API_ROLE_NAME="Metrics.Read"

TENANT_ID=""
API_APP_ID=""
SPA_APP_ID=""
DRY_RUN=false
REDIRECT_URIS=()

die() { echo "error: $*" >&2; exit 1; }
info() { echo "==> $*"; }

usage() {
  sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tenant-id) TENANT_ID="${2:-}"; shift 2 ;;
    --api-app-id) API_APP_ID="${2:-}"; shift 2 ;;
    --spa-app-id) SPA_APP_ID="${2:-}"; shift 2 ;;
    --redirect-uri) REDIRECT_URIS+=("${2:-}"); shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage 0 ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
done

[[ -n "$TENANT_ID" ]] || die "--tenant-id is required"
[[ -n "$API_APP_ID" ]] || die "--api-app-id is required"
[[ -n "$SPA_APP_ID" ]] || die "--spa-app-id is required"
command -v az >/dev/null || die "az CLI not found"
command -v jq >/dev/null || die "jq not found"

SIGNED_IN_TENANT=$(az account show --query tenantId -o tsv 2>/dev/null || true)
[[ -n "$SIGNED_IN_TENANT" ]] || die "not signed in — run: az login --tenant $TENANT_ID --allow-no-subscriptions"
if [[ "${SIGNED_IN_TENANT,,}" != "${TENANT_ID,,}" ]]; then
  die "az is signed in to tenant $SIGNED_IN_TENANT but --tenant-id is $TENANT_ID. Run: az login --tenant $TENANT_ID --allow-no-subscriptions"
fi

# graph_get <relative-url> -> response body on stdout, empty string on 404.
graph_get() {
  az rest --method GET --url "$GRAPH/$1" --headers "Content-Type=application/json" 2>/dev/null || true
}

graph_patch() {
  local url="$1" body="$2"
  if [[ "$DRY_RUN" == true ]]; then
    echo "DRY-RUN PATCH $GRAPH/$url"
    jq . <<<"$body"
    return 0
  fi
  az rest --method PATCH --url "$GRAPH/$url" \
    --headers "Content-Type=application/json" --body "$body" >/dev/null
}

graph_post() {
  local url="$1" body="$2"
  if [[ "$DRY_RUN" == true ]]; then
    echo "DRY-RUN POST $GRAPH/$url"
    jq . <<<"$body"
    return 0
  fi
  az rest --method POST --url "$GRAPH/$url" \
    --headers "Content-Type=application/json" --body "$body" >/dev/null
}

# ---------------------------------------------------------------------------
# 1. API app registration must exist.
# ---------------------------------------------------------------------------
info "Reading API app registration $API_APP_ID"
API_APP=$(graph_get "applications(appId='$API_APP_ID')")
[[ -n "$API_APP" ]] || die "API app registration $API_APP_ID does not exist in tenant $TENANT_ID. Create it (az ad app create --display-name azure-architect-ai-api) or point ENTRA_AUDIENCE / VITE_ENTRA_API_SCOPE at the app that does."
API_OBJECT_ID=$(jq -r '.id' <<<"$API_APP")

# ---------------------------------------------------------------------------
# 2. Application ID URI api://<client-id> — the resource MSAL asks for.
# ---------------------------------------------------------------------------
API_URI="api://$API_APP_ID"
if jq -e --arg uri "$API_URI" '(.identifierUris // []) | index($uri) != null' <<<"$API_APP" >/dev/null; then
  info "Application ID URI $API_URI already set"
else
  info "Adding Application ID URI $API_URI"
  body=$(jq -c --arg uri "$API_URI" '{identifierUris: ((.identifierUris // []) + [$uri] | unique)}' <<<"$API_APP")
  graph_patch "applications/$API_OBJECT_ID" "$body"
fi

# ---------------------------------------------------------------------------
# 3. Delegated scope access_as_user + app role Metrics.Read.
# ---------------------------------------------------------------------------
SCOPE_ID=$(jq -r --arg n "$API_SCOPE_NAME" '(.api.oauth2PermissionScopes // []) | map(select(.value == $n)) | .[0].id // empty' <<<"$API_APP")
if [[ -n "$SCOPE_ID" ]]; then
  info "Delegated scope $API_SCOPE_NAME already exposed ($SCOPE_ID)"
else
  SCOPE_ID=$(cat /proc/sys/kernel/random/uuid)
  info "Exposing delegated scope $API_SCOPE_NAME ($SCOPE_ID)"
  body=$(jq -c --arg id "$SCOPE_ID" --arg n "$API_SCOPE_NAME" '
    {api: ((.api // {}) + {oauth2PermissionScopes: ((.api.oauth2PermissionScopes // []) + [{
      id: $id,
      value: $n,
      type: "User",
      isEnabled: true,
      adminConsentDisplayName: "Access Azure Architect AI as the signed-in user",
      adminConsentDescription: "Allows the app to call the Azure Architect AI API on behalf of the signed-in user.",
      userConsentDisplayName: "Access Azure Architect AI on your behalf",
      userConsentDescription: "Allows the app to call the Azure Architect AI API on your behalf."
    }])})}' <<<"$API_APP")
  graph_patch "applications/$API_OBJECT_ID" "$body"
fi

if jq -e --arg n "$API_ROLE_NAME" '((.appRoles // []) | map(select(.value == $n)) | length) > 0' <<<"$API_APP" >/dev/null; then
  info "App role $API_ROLE_NAME already defined"
else
  ROLE_ID=$(cat /proc/sys/kernel/random/uuid)
  info "Adding app role $API_ROLE_NAME ($ROLE_ID)"
  body=$(jq -c --arg id "$ROLE_ID" --arg n "$API_ROLE_NAME" '
    {appRoles: ((.appRoles // []) + [{
      id: $id,
      value: $n,
      allowedMemberTypes: ["User", "Application"],
      displayName: $n,
      description: "Read Azure Architect AI operational metrics and run admin ingests.",
      isEnabled: true
    }])}' <<<"$API_APP")
  graph_patch "applications/$API_OBJECT_ID" "$body"
fi

# ---------------------------------------------------------------------------
# 4. Service principals. This is the actual AADSTS500011 fix: without a service
#    principal for the API app, Entra cannot resolve api://<client-id>.
# ---------------------------------------------------------------------------
for pair in "API:$API_APP_ID" "SPA:$SPA_APP_ID"; do
  label="${pair%%:*}"
  app_id="${pair#*:}"
  if [[ -n "$(graph_get "servicePrincipals(appId='$app_id')")" ]]; then
    info "$label service principal already present in tenant"
  else
    info "Creating $label service principal for $app_id"
    graph_post "servicePrincipals" "$(jq -nc --arg a "$app_id" '{appId: $a}')"
  fi
done

# ---------------------------------------------------------------------------
# 5. SPA app: redirect URIs, requested scope, pre-authorisation.
# ---------------------------------------------------------------------------
info "Reading SPA app registration $SPA_APP_ID"
SPA_APP=$(graph_get "applications(appId='$SPA_APP_ID')")
[[ -n "$SPA_APP" ]] || die "SPA app registration $SPA_APP_ID does not exist in tenant $TENANT_ID"
SPA_OBJECT_ID=$(jq -r '.id' <<<"$SPA_APP")

if [[ ${#REDIRECT_URIS[@]} -gt 0 ]]; then
  wanted=$(printf '%s\n' "${REDIRECT_URIS[@]}" | jq -R . | jq -sc .)
  if jq -e --argjson want "$wanted" '(($want - (.spa.redirectUris // [])) | length) == 0' <<<"$SPA_APP" >/dev/null; then
    info "SPA redirect URIs already registered"
  else
    info "Adding SPA redirect URIs: ${REDIRECT_URIS[*]}"
    body=$(jq -c --argjson want "$wanted" '{spa: ((.spa // {}) + {redirectUris: (((.spa.redirectUris // []) + $want) | unique)})}' <<<"$SPA_APP")
    graph_patch "applications/$SPA_OBJECT_ID" "$body"
  fi
fi

if jq -e --arg api "$API_APP_ID" --arg sid "$SCOPE_ID" '
    ((.requiredResourceAccess // [])
     | map(select(.resourceAppId == $api))
     | .[0].resourceAccess // []
     | map(select(.id == $sid)) | length) > 0' <<<"$SPA_APP" >/dev/null; then
  info "SPA already requests $API_SCOPE_NAME"
else
  info "Granting the SPA a requiredResourceAccess entry for $API_SCOPE_NAME"
  body=$(jq -c --arg api "$API_APP_ID" --arg sid "$SCOPE_ID" '
    {requiredResourceAccess: (
      ((.requiredResourceAccess // []) | map(select(.resourceAppId != $api)))
      + [{resourceAppId: $api, resourceAccess: [{id: $sid, type: "Scope"}]}]
    )}' <<<"$SPA_APP")
  graph_patch "applications/$SPA_OBJECT_ID" "$body"
fi

API_APP=$(graph_get "applications(appId='$API_APP_ID')")
if jq -e --arg spa "$SPA_APP_ID" --arg sid "$SCOPE_ID" '
    ((.api.preAuthorizedApplications // [])
     | map(select(.appId == $spa and ((.delegatedPermissionIds // []) | index($sid) != null)))
     | length) > 0' <<<"$API_APP" >/dev/null; then
  info "SPA already pre-authorised on the API app"
else
  info "Pre-authorising the SPA on the API app (skips the per-user consent prompt)"
  body=$(jq -c --arg spa "$SPA_APP_ID" --arg sid "$SCOPE_ID" '
    {api: ((.api // {}) + {preAuthorizedApplications: (
      ((.api.preAuthorizedApplications // []) | map(select(.appId != $spa)))
      + [{appId: $spa, delegatedPermissionIds: [$sid]}]
    )})}' <<<"$API_APP")
  graph_patch "applications/$API_OBJECT_ID" "$body"
fi

# ---------------------------------------------------------------------------
# 6. Report the values the deployment must use.
# ---------------------------------------------------------------------------
cat <<EOF

Entra configuration is consistent. Deployment values:

  VITE_ENTRA_TENANT_ID  = $TENANT_ID
  VITE_ENTRA_CLIENT_ID  = $SPA_APP_ID
  VITE_ENTRA_API_SCOPE  = $API_URI/$API_SCOPE_NAME
  ENTRA_TENANT_ID       = $TENANT_ID
  ENTRA_AUDIENCE        = $API_URI
  ENTRA_CLIENT_ID       = $API_APP_ID

Verify resource resolution (prints an expiry, not AADSTS500011):

  az account get-access-token --tenant $TENANT_ID --resource $API_URI --query expiresOn -o tsv
EOF
