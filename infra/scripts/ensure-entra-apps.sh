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
# When an app registration is gone for good (deleted past the 30-day restore
# window), add --create-missing to mint a replacement and print its new client
# ID. --api-app-id / --spa-app-id then become optional: the app is looked up by
# display name first and only created when no match exists.
#
#   ./infra/scripts/ensure-entra-apps.sh \
#     --tenant-id 16b3c013-d300-468d-ac64-7eda0820b6d3 \
#     --create-missing \
#     --spa-app-id e9616e6b-3c8b-4153-b814-b01817c9ade2 \
#     --redirect-uri https://blueprint.techtools.host/
#
# Add --dry-run to print the changes without applying them.
#
# Requires: az only (signed in to the target tenant as Application
# Administrator or Cloud Application Administrator). Every response is read
# through `az --query` (JMESPath) and every request body is assembled in bash,
# so no jq, python or other helper has to be installed.

set -euo pipefail

GRAPH="https://graph.microsoft.com/v1.0"
API_SCOPE_NAME="access_as_user"
API_ROLE_NAME="Metrics.Read"
API_DISPLAY_NAME="azure-architect-ai-api"
SPA_DISPLAY_NAME="azure-architect-ai-spa"

TENANT_ID=""
API_APP_ID=""
SPA_APP_ID=""
DRY_RUN=false
CREATE_MISSING=false
REDIRECT_URIS=()

die() { echo "error: $*" >&2; exit 1; }
info() { echo "==> $*"; }

usage() {
  sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tenant-id) TENANT_ID="${2:-}"; shift 2 ;;
    --api-app-id) API_APP_ID="${2:-}"; shift 2 ;;
    --spa-app-id) SPA_APP_ID="${2:-}"; shift 2 ;;
    --api-display-name) API_DISPLAY_NAME="${2:-}"; shift 2 ;;
    --spa-display-name) SPA_DISPLAY_NAME="${2:-}"; shift 2 ;;
    --redirect-uri) REDIRECT_URIS+=("${2:-}"); shift 2 ;;
    --create-missing) CREATE_MISSING=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage 0 ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
done

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

[[ -n "$TENANT_ID" ]] || die "--tenant-id is required"
if [[ "$CREATE_MISSING" != true ]]; then
  [[ -n "$API_APP_ID" ]] || die "--api-app-id is required (or pass --create-missing to mint a new API app registration)"
  [[ -n "$SPA_APP_ID" ]] || die "--spa-app-id is required (or pass --create-missing to mint a new SPA app registration)"
fi
command -v az >/dev/null || die "az CLI not found"

SIGNED_IN_TENANT=$(az account show --query tenantId -o tsv 2>/dev/null || true)
[[ -n "$SIGNED_IN_TENANT" ]] || die "not signed in — run: az login --tenant $TENANT_ID --allow-no-subscriptions"
if [[ "$(lower "$SIGNED_IN_TENANT")" != "$(lower "$TENANT_ID")" ]]; then
  die "az is signed in to tenant $SIGNED_IN_TENANT but --tenant-id is $TENANT_ID. Run: az login --tenant $TENANT_ID --allow-no-subscriptions"
fi

# ---------------------------------------------------------------------------
# JSON helpers. Request bodies are small and fully under this script's control,
# so they are assembled from primitives instead of shelling out to jq.
# ---------------------------------------------------------------------------

# json_string <value> -> a quoted, escaped JSON string.
json_string() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\t'/\\t}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\n'/\\n}"
  printf '"%s"' "$s"
}

# json_string_array <value...> -> ["a","b"]; empty values are dropped.
json_string_array() {
  local out="" item
  for item in "$@"; do
    [[ -n "$item" ]] || continue
    out="${out:+$out,}$(json_string "$item")"
  done
  printf '[%s]' "$out"
}

# json_array <maybe-array> -> the array, or [] when absent/null.
json_array() {
  local arr
  arr="$(trim "${1:-}")"
  case "$arr" in
    ""|null|None) printf '[]' ;;
    *) printf '%s' "$arr" ;;
  esac
}

# json_array_append <array-json> <element-json> -> array with the element added.
json_array_append() {
  local arr element
  arr="$(json_array "${1:-}")"
  element="$2"
  if [[ "$arr" == "[]" ]]; then
    printf '[%s]' "$element"
  else
    printf '%s,%s]' "${arr%]}" "$element"
  fi
}

# json_bool <tsv-value> -> true / false / null.
json_bool() {
  case "$(lower "$(trim "${1:-}")")" in
    true) printf 'true' ;;
    false) printf 'false' ;;
    *) printf 'null' ;;
  esac
}

# json_number <tsv-value> -> the integer, or null when absent/not a number.
json_number() {
  local value
  value="$(trim "${1:-}")"
  if [[ "$value" =~ ^-?[0-9]+$ ]]; then printf '%s' "$value"; else printf 'null'; fi
}

# lines_contain <needle> <newline-separated-haystack>
lines_contain() {
  local needle="$1" line
  while IFS= read -r line; do
    if [[ "$line" == "$needle" ]]; then return 0; fi
  done <<<"${2:-}"
  return 1
}

# tsv_value <az-tsv-scalar> -> the value, or "" when the query matched nothing
# (the tsv formatter renders a null result as the literal "None").
tsv_value() {
  local value
  value="$(trim "${1:-}")"
  case "$value" in
    None|null) printf '' ;;
    *) printf '%s' "$value" ;;
  esac
}

# tsv_lines <az-tsv-list> -> one value per line, blanks and "None" removed.
tsv_lines() {
  local line value
  while IFS= read -r line; do
    value="$(tsv_value "$line")"
    if [[ -n "$value" ]]; then printf '%s\n' "$value"; fi
  done <<<"${1:-}"
  return 0
}

# new_uuid -> a lower-case UUID. /proc is Linux-only and uuidgen is missing on
# plenty of machines (notably Git Bash on Windows), hence the bash fallback.
new_uuid() {
  if [[ -r /proc/sys/kernel/random/uuid ]]; then
    tr '[:upper:]' '[:lower:]' </proc/sys/kernel/random/uuid
  elif command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  else
    printf '%04x%04x-%04x-4%03x-%04x-%04x%04x%04x\n' \
      $((RANDOM % 65536)) $((RANDOM % 65536)) $((RANDOM % 65536)) \
      $((RANDOM % 4096)) $(((RANDOM % 16384) + 32768)) \
      $((RANDOM % 65536)) $((RANDOM % 65536)) $((RANDOM % 65536))
  fi
}

# ---------------------------------------------------------------------------
# Graph helpers.
# ---------------------------------------------------------------------------

# graph_tsv <relative-url> <jmespath> -> tsv projection, empty on 404 / null.
graph_tsv() {
  az rest --method GET --url "$GRAPH/$1" --headers "Content-Type=application/json" \
    --query "$2" -o tsv 2>/dev/null || true
}

# graph_tsv_strict <relative-url> <jmespath> -> like graph_tsv, but a failed
# request propagates instead of being swallowed.
graph_tsv_strict() {
  az rest --method GET --url "$GRAPH/$1" --headers "Content-Type=application/json" \
    --query "$2" -o tsv 2>/dev/null
}

# graph_json <relative-url> <jmespath> -> raw JSON, empty on 404.
graph_json() {
  az rest --method GET --url "$GRAPH/$1" --headers "Content-Type=application/json" \
    --query "$2" -o json 2>/dev/null || true
}

graph_patch() {
  local url="$1" body="$2" attempt
  if [[ "$DRY_RUN" == true ]]; then
    echo "DRY-RUN PATCH $GRAPH/$url"
    echo "$body"
    return 0
  fi
  # A freshly created application is not immediately visible to every Graph
  # replica, so the first PATCH after --create-missing can 404. Retry before
  # letting the final attempt surface the real error.
  for attempt in 1 2; do
    if az rest --method PATCH --url "$GRAPH/$url" \
      --headers "Content-Type=application/json" --body "$body" >/dev/null 2>&1; then
      return 0
    fi
    sleep $((attempt * 5))
  done
  az rest --method PATCH --url "$GRAPH/$url" \
    --headers "Content-Type=application/json" --body "$body" >/dev/null
}

graph_post() {
  local url="$1" body="$2"
  if [[ "$DRY_RUN" == true ]]; then
    echo "DRY-RUN POST $GRAPH/$url"
    echo "$body"
    return 0
  fi
  az rest --method POST --url "$GRAPH/$url" \
    --headers "Content-Type=application/json" --body "$body" >/dev/null
}

# parse_app_tuple <az-tsv-output> -> sets APP_OBJECT_ID / APP_APP_ID /
# APP_NAME. `az -o tsv` prints a [id,appId,displayName] projection one value
# per line, and an empty string when the application does not exist.
parse_app_tuple() {
  local line index=0
  APP_OBJECT_ID=""
  APP_APP_ID=""
  APP_NAME=""
  while IFS= read -r line; do
    line="$(tsv_value "$line")"
    case "$index" in
      0) APP_OBJECT_ID="$line" ;;
      1) APP_APP_ID="$line" ;;
      2) APP_NAME="$line" ;;
    esac
    index=$((index + 1))
  done <<<"${1:-}"
  return 0
}

# find_app_by_display_name <name> -> the id / appId / displayName projection
# (one value per line), empty when no match.
find_app_by_display_name() {
  local escaped="${1//\'/\'\'}"
  graph_tsv "applications?\$filter=displayName%20eq%20'$escaped'&\$top=2" \
    "value[0].[id,appId,displayName]"
}

# create_app <body> <display-name> -> the id / appId / displayName projection of
# the created application. Under --dry-run the Graph call is skipped and a
# placeholder is returned so the remaining steps can still be previewed.
create_app() {
  local body="$1" display_name="$2"
  if [[ "$DRY_RUN" == true ]]; then
    echo "DRY-RUN POST $GRAPH/applications" >&2
    echo "$body" >&2
    printf '<new-object-id:%s>\n<new-app-id:%s>\n%s\n' "$display_name" "$display_name" "$display_name"
    return 0
  fi
  az rest --method POST --url "$GRAPH/applications" \
    --headers "Content-Type=application/json" --body "$body" \
    --query "[id,appId,displayName]" -o tsv
}

# api_patch_body <scopes-json> <preauth-json> -> {"api": {...}}. A Graph PATCH
# replaces the whole api object, so the sibling properties are read back and
# resent — silently dropping requestedAccessTokenVersion would downgrade the
# API to v1 access tokens. A failed read aborts instead of sending defaults.
api_patch_body() {
  local scopes="$1" preauth="$2" scalars="" known="" status=0 accept="" version="" line index=0
  local known_uris=()
  scalars=$(graph_tsv_strict "applications/$API_OBJECT_ID" "api.[acceptMappedClaims,requestedAccessTokenVersion]") || status=$?
  if [[ $status -eq 0 ]]; then
    known=$(graph_tsv_strict "applications/$API_OBJECT_ID" "api.knownClientApplications") || status=$?
  fi
  if [[ $status -ne 0 ]]; then
    # A just-created application is not readable from every Graph replica yet;
    # for anything else, refuse to overwrite settings we could not read.
    [[ "$API_APP_CREATED" == true ]] || die "could not read the current api settings of application $API_OBJECT_ID — refusing to PATCH, which would clear requestedAccessTokenVersion and knownClientApplications"
    scalars=""
    known=""
  fi

  while IFS= read -r line; do
    case "$index" in
      0) accept="$line" ;;
      1) version="$line" ;;
    esac
    index=$((index + 1))
  done <<<"$scalars"

  while IFS= read -r line; do
    line="$(tsv_value "$line")"
    if [[ -n "$line" ]]; then known_uris+=("$line"); fi
  done <<<"$known"

  printf '{"api":{"acceptMappedClaims":%s,"knownClientApplications":%s,"oauth2PermissionScopes":%s,"preAuthorizedApplications":%s,"requestedAccessTokenVersion":%s}}' \
    "$(json_bool "$accept")" \
    "$(json_string_array "${known_uris[@]+"${known_uris[@]}"}")" \
    "$(json_array "$scopes")" \
    "$(json_array "$preauth")" \
    "$(json_number "$version")"
}

# ---------------------------------------------------------------------------
# 1. API app registration must exist. With --create-missing it is looked up by
#    display name and minted when absent, which yields a brand new client ID.
# ---------------------------------------------------------------------------
if [[ -n "$API_APP_ID" ]]; then
  info "Reading API app registration $API_APP_ID"
  API_APP=$(graph_tsv "applications(appId='$API_APP_ID')" "[id,appId,displayName]")
else
  info "Looking up API app registration by display name $API_DISPLAY_NAME"
  API_APP=$(find_app_by_display_name "$API_DISPLAY_NAME")
fi

parse_app_tuple "$API_APP"
API_APP_CREATED=false
if [[ -z "$APP_APP_ID" ]]; then
  [[ "$CREATE_MISSING" == true ]] || die "API app registration ${API_APP_ID:-$API_DISPLAY_NAME} does not exist in tenant $TENANT_ID. Re-run with --create-missing to mint a replacement, restore it from deletedItems, or point ENTRA_AUDIENCE / VITE_ENTRA_API_SCOPE at the app that does exist."
  info "Creating API app registration $API_DISPLAY_NAME"
  API_APP=$(create_app "{\"displayName\":$(json_string "$API_DISPLAY_NAME"),\"signInAudience\":\"AzureADMyOrg\"}" "$API_DISPLAY_NAME")
  API_APP_CREATED=true
  parse_app_tuple "$API_APP"
fi

API_OBJECT_ID="$APP_OBJECT_ID"
API_APP_ID="$APP_APP_ID"
API_APP_NAME="$APP_NAME"
[[ -n "$API_APP_ID" ]] || die "could not determine the API app client ID"
info "API app $API_APP_NAME = $API_APP_ID"

# ---------------------------------------------------------------------------
# 1b. SPA app registration, resolved before the service principals so that a
#     newly minted SPA also gets an enterprise application below.
# ---------------------------------------------------------------------------
if [[ -n "$SPA_APP_ID" ]]; then
  info "Reading SPA app registration $SPA_APP_ID"
  SPA_APP=$(graph_tsv "applications(appId='$SPA_APP_ID')" "[id,appId,displayName]")
else
  info "Looking up SPA app registration by display name $SPA_DISPLAY_NAME"
  SPA_APP=$(find_app_by_display_name "$SPA_DISPLAY_NAME")
fi

parse_app_tuple "$SPA_APP"
SPA_APP_CREATED=false
if [[ -z "$APP_APP_ID" ]]; then
  [[ "$CREATE_MISSING" == true ]] || die "SPA app registration ${SPA_APP_ID:-$SPA_DISPLAY_NAME} does not exist in tenant $TENANT_ID. Re-run with --create-missing to mint a replacement."
  info "Creating SPA app registration $SPA_DISPLAY_NAME"
  spa_create_body="{\"displayName\":$(json_string "$SPA_DISPLAY_NAME"),\"signInAudience\":\"AzureADMyOrg\",\"spa\":{\"redirectUris\":$(json_string_array "${REDIRECT_URIS[@]+"${REDIRECT_URIS[@]}"}")}}"
  SPA_APP=$(create_app "$spa_create_body" "$SPA_DISPLAY_NAME")
  SPA_APP_CREATED=true
  parse_app_tuple "$SPA_APP"
fi

SPA_OBJECT_ID="$APP_OBJECT_ID"
SPA_APP_ID="$APP_APP_ID"
SPA_APP_NAME="$APP_NAME"
[[ -n "$SPA_APP_ID" ]] || die "could not determine the SPA app client ID"
info "SPA app $SPA_APP_NAME = $SPA_APP_ID"

# ---------------------------------------------------------------------------
# 2. Application ID URI api://<client-id> — the resource MSAL asks for.
# ---------------------------------------------------------------------------
API_URI="api://$API_APP_ID"
identifier_uris=$(tsv_lines "$(graph_tsv "applications/$API_OBJECT_ID" "identifierUris")")
if lines_contain "$API_URI" "$identifier_uris"; then
  info "Application ID URI $API_URI already set"
else
  info "Adding Application ID URI $API_URI"
  uris=()
  while IFS= read -r uri; do
    if [[ -n "$uri" ]]; then uris+=("$uri"); fi
  done <<<"$identifier_uris"
  uris+=("$API_URI")
  graph_patch "applications/$API_OBJECT_ID" "{\"identifierUris\":$(json_string_array "${uris[@]}")}"
fi

# ---------------------------------------------------------------------------
# 3. Delegated scope access_as_user + app role Metrics.Read.
# ---------------------------------------------------------------------------
SCOPE_ID=$(tsv_value "$(graph_tsv "applications/$API_OBJECT_ID" "api.oauth2PermissionScopes[?value=='$API_SCOPE_NAME'].id | [0]")")
if [[ -n "$SCOPE_ID" ]]; then
  info "Delegated scope $API_SCOPE_NAME already exposed ($SCOPE_ID)"
else
  SCOPE_ID=$(new_uuid)
  info "Exposing delegated scope $API_SCOPE_NAME ($SCOPE_ID)"
  new_scope="{\"id\":\"$SCOPE_ID\",\"value\":$(json_string "$API_SCOPE_NAME"),\"type\":\"User\",\"isEnabled\":true,\"adminConsentDisplayName\":\"Access Azure Architect AI as the signed-in user\",\"adminConsentDescription\":\"Allows the app to call the Azure Architect AI API on behalf of the signed-in user.\",\"userConsentDisplayName\":\"Access Azure Architect AI on your behalf\",\"userConsentDescription\":\"Allows the app to call the Azure Architect AI API on your behalf.\"}"
  scopes=$(json_array_append "$(graph_json "applications/$API_OBJECT_ID" "api.oauth2PermissionScopes")" "$new_scope")
  preauth=$(graph_json "applications/$API_OBJECT_ID" "api.preAuthorizedApplications")
  graph_patch "applications/$API_OBJECT_ID" "$(api_patch_body "$scopes" "$preauth")"
fi

if [[ -n "$(tsv_value "$(graph_tsv "applications/$API_OBJECT_ID" "appRoles[?value=='$API_ROLE_NAME'].id | [0]")")" ]]; then
  info "App role $API_ROLE_NAME already defined"
else
  ROLE_ID=$(new_uuid)
  info "Adding app role $API_ROLE_NAME ($ROLE_ID)"
  new_role="{\"id\":\"$ROLE_ID\",\"value\":$(json_string "$API_ROLE_NAME"),\"allowedMemberTypes\":[\"User\",\"Application\"],\"displayName\":$(json_string "$API_ROLE_NAME"),\"description\":\"Read Azure Architect AI operational metrics and run admin ingests.\",\"isEnabled\":true}"
  roles=$(json_array_append "$(graph_json "applications/$API_OBJECT_ID" "appRoles")" "$new_role")
  graph_patch "applications/$API_OBJECT_ID" "{\"appRoles\":$roles}"
fi

# ---------------------------------------------------------------------------
# 4. Service principals. This is the actual AADSTS500011 fix: without a service
#    principal for the API app, Entra cannot resolve api://<client-id>.
# ---------------------------------------------------------------------------
for pair in "API:$API_APP_ID" "SPA:$SPA_APP_ID"; do
  label="${pair%%:*}"
  app_id="${pair#*:}"
  if [[ -n "$(tsv_value "$(graph_tsv "servicePrincipals(appId='$app_id')" "id")")" ]]; then
    info "$label service principal already present in tenant"
  else
    info "Creating $label service principal for $app_id"
    graph_post "servicePrincipals" "{\"appId\":$(json_string "$app_id")}"
  fi
done

# ---------------------------------------------------------------------------
# 5. SPA app: redirect URIs, requested scope, pre-authorisation.
# ---------------------------------------------------------------------------
if [[ ${#REDIRECT_URIS[@]} -gt 0 ]]; then
  registered_uris=$(tsv_lines "$(graph_tsv "applications/$SPA_OBJECT_ID" "spa.redirectUris")")
  missing_uris=()
  for uri in "${REDIRECT_URIS[@]}"; do
    if ! lines_contain "$uri" "$registered_uris"; then missing_uris+=("$uri"); fi
  done
  if [[ ${#missing_uris[@]} -eq 0 ]]; then
    info "SPA redirect URIs already registered"
  else
    info "Adding SPA redirect URIs: ${missing_uris[*]}"
    uris=()
    while IFS= read -r uri; do
      if [[ -n "$uri" ]]; then uris+=("$uri"); fi
    done <<<"$registered_uris"
    uris+=("${missing_uris[@]}")
    graph_patch "applications/$SPA_OBJECT_ID" "{\"spa\":{\"redirectUris\":$(json_string_array "${uris[@]}")}}"
  fi
fi

if [[ -n "$(tsv_value "$(graph_tsv "applications/$SPA_OBJECT_ID" "requiredResourceAccess[?resourceAppId=='$API_APP_ID'].resourceAccess[] | [?id=='$SCOPE_ID'].id | [0]")")" ]]; then
  info "SPA already requests $API_SCOPE_NAME"
else
  info "Granting the SPA a requiredResourceAccess entry for $API_SCOPE_NAME"
  entry="{\"resourceAppId\":\"$API_APP_ID\",\"resourceAccess\":[{\"id\":\"$SCOPE_ID\",\"type\":\"Scope\"}]}"
  other_access=$(graph_json "applications/$SPA_OBJECT_ID" "requiredResourceAccess[?resourceAppId!='$API_APP_ID']")
  graph_patch "applications/$SPA_OBJECT_ID" "{\"requiredResourceAccess\":$(json_array_append "$other_access" "$entry")}"
fi

if [[ -n "$(tsv_value "$(graph_tsv "applications/$API_OBJECT_ID" "api.preAuthorizedApplications[?appId=='$SPA_APP_ID'] | [?contains(delegatedPermissionIds, '$SCOPE_ID')].appId | [0]")")" ]]; then
  info "SPA already pre-authorised on the API app"
else
  info "Pre-authorising the SPA on the API app (skips the per-user consent prompt)"
  entry="{\"appId\":\"$SPA_APP_ID\",\"delegatedPermissionIds\":[\"$SCOPE_ID\"]}"
  other_preauth=$(graph_json "applications/$API_OBJECT_ID" "api.preAuthorizedApplications[?appId!='$SPA_APP_ID']")
  scopes=$(graph_json "applications/$API_OBJECT_ID" "api.oauth2PermissionScopes")
  graph_patch "applications/$API_OBJECT_ID" "$(api_patch_body "$scopes" "$(json_array_append "$other_preauth" "$entry")")"
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

if [[ "$API_APP_CREATED" == true || "$SPA_APP_CREATED" == true ]]; then
  cat <<EOF

A new app registration was created, so the client ID changed. Update the GitHub
repository variables (repeat with --env test for the test environment) and then
redeploy — VITE_* values are baked into the frontend image at build time and
ENTRA_AUDIENCE only reaches the backend through a Bicep deployment:

  gh variable set VITE_ENTRA_TENANT_ID --env dev --body "$TENANT_ID"
  gh variable set VITE_ENTRA_CLIENT_ID --env dev --body "$SPA_APP_ID"
  gh variable set VITE_ENTRA_API_SCOPE --env dev --body "$API_URI/$API_SCOPE_NAME"
  gh variable set ENTRA_AUDIENCE       --env dev --body "$API_URI"

  gh workflow run deploy --ref main -f deploy_infra=true -f services=backend,frontend
EOF
fi
