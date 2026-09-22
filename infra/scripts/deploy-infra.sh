#!/usr/bin/env bash
# Run the subscription-scope Bicep deployment, tolerating the intermittent
# Azure OpenAI race that fails the `openai` module with:
#
#   AccountProvisioningStateInvalid: Call to Microsoft.CognitiveServices/accounts
#   failed. Error message: Account /subscriptions/.../accounts/<name> in state Accepted
#
# ARM considers the `Microsoft.CognitiveServices/accounts` write complete while
# the resource provider is still settling the account, so the child
# `accounts/deployments` (model) writes in the same template are rejected.
#
# Blindly re-running the template does not help: every retry issues another PUT
# on the account, which keeps it in the non-terminal `Accepted` state. So on a
# retry we first poll the offending account (parsed out of the error message)
# until its provisioningState is terminal, and only then redeploy.
#
# Usage:
#   ./infra/scripts/deploy-infra.sh \
#     --name aarch-dev \
#     --location centralus \
#     --template-file infra/main.bicep \
#     --parameters infra/main.bicepparam
#
# Optional:
#   --max-attempts N   deployment attempts (default 3)
#   --wait-timeout S   seconds to wait for the account to settle (default 900)
#   --poll-interval S  seconds between account polls (default 30)
#
# Requires: az (already signed in to the target subscription).

set -euo pipefail

NAME=""
LOCATION=""
TEMPLATE_FILE=""
PARAMETERS=""
MAX_ATTEMPTS=3
WAIT_TIMEOUT=900
POLL_INTERVAL=30

usage() {
  cat <<'EOF'
Usage: deploy-infra.sh --name <deployment> --location <region> \
                       --template-file <path> --parameters <path>
                       [--max-attempts N] [--wait-timeout S] [--poll-interval S]

Runs `az deployment sub create`, retrying when the Azure OpenAI account is
still in the non-terminal `Accepted` state (AccountProvisioningStateInvalid).
EOF
}

die() {
  echo "error: $*" >&2
  usage >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --name) NAME="${2:-}"; shift 2 ;;
    --location) LOCATION="${2:-}"; shift 2 ;;
    --template-file) TEMPLATE_FILE="${2:-}"; shift 2 ;;
    --parameters) PARAMETERS="${2:-}"; shift 2 ;;
    --max-attempts) MAX_ATTEMPTS="${2:-}"; shift 2 ;;
    --wait-timeout) WAIT_TIMEOUT="${2:-}"; shift 2 ;;
    --poll-interval) POLL_INTERVAL="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -n "$NAME" ] || die "--name is required"
[ -n "$LOCATION" ] || die "--location is required"
[ -n "$TEMPLATE_FILE" ] || die "--template-file is required"
[ -n "$PARAMETERS" ] || die "--parameters is required"

# Echoes the Cognitive Services account resource ID referenced by an
# AccountProvisioningStateInvalid error, or nothing when the failure was
# something else.
stuck_account_id() {
  sed -n 's#.*Account \(/subscriptions/[^ "\\]*/providers/Microsoft\.CognitiveServices/accounts/[^ "\\]*\) in state Accepted.*#\1#p' <<< "$1" | head -n 1
}

# Polls the account until provisioningState is terminal. Returns non-zero when
# the timeout elapses (the caller then gives up rather than re-PUTting it).
wait_for_account() {
  local resource_id="$1"
  local resource_group="${resource_id#*/resourceGroups/}"
  resource_group="${resource_group%%/*}"
  local account="${resource_id##*/}"
  local waited=0
  local state

  echo "Waiting for Azure OpenAI account '$account' (rg '$resource_group') to finish provisioning..."
  while [ "$waited" -lt "$WAIT_TIMEOUT" ]; do
    state=$(az cognitiveservices account show \
      --name "$account" \
      --resource-group "$resource_group" \
      --query 'properties.provisioningState' -o tsv 2>/dev/null) || state=""

    case "$state" in
      Accepted|Creating|Provisioning|Updating|Deleting|ResolvingDNS)
        : # still settling
        ;;
      "")
        # The account is not readable (deleted, or a transient control-plane
        # error). Let the redeploy decide what to do about it.
        echo "Account state unavailable; retrying the deployment."
        sleep "$POLL_INTERVAL"
        return 0
        ;;
      *)
        echo "Account provisioningState=$state after ${waited}s."
        return 0
        ;;
    esac

    sleep "$POLL_INTERVAL"
    waited=$((waited + POLL_INTERVAL))
  done

  echo "::error::Azure OpenAI account '$account' is still in a non-terminal provisioning state after ${WAIT_TIMEOUT}s."
  return 1
}

for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  if deploy_output=$(az deployment sub create \
    --name "$NAME" \
    --location "$LOCATION" \
    --template-file "$TEMPLATE_FILE" \
    --parameters "$PARAMETERS" 2>&1); then
    echo "$deploy_output"
    exit 0
  fi

  echo "$deploy_output" >&2

  account_id=$(stuck_account_id "$deploy_output")
  if [ -z "$account_id" ] || [ "$attempt" -eq "$MAX_ATTEMPTS" ]; then
    exit 1
  fi

  echo "::warning::Azure OpenAI account is still provisioning; waiting before deployment attempt $((attempt + 1))/${MAX_ATTEMPTS}."
  wait_for_account "$account_id" || exit 1
done

exit 1
