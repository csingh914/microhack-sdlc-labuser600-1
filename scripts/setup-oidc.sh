#!/usr/bin/env bash
# Configure GitHub Actions -> Azure federated (OIDC) authentication using a
# USER-ASSIGNED MANAGED IDENTITY.
#
# Advantages over the app-registration approach:
#   - The identity is an Azure resource, so it lives/dies with the resource group
#     and is managed via ARM RBAC rather than Entra directory permissions.
#   - No Application Administrator / directory write privileges required.
#   - It can additionally be attached to Azure resources (ACR pull, Key Vault, ...).
#
# Creates the identity and ACR, grants the required roles, adds federated
# credentials for this repo, and pushes the ids into GitHub Actions
# secrets/variables.
#
# Prereqs: az login, and (optionally) gh auth login with a token that can write
# Actions secrets. If the gh write fails the values are printed for manual entry.
#
# Usage:
#   ./scripts/setup-oidc.sh [-g <resource-group>] [-l <location>] [-r <owner/repo>] [-b <branch>] [-e <gh-environment>] [-n <identity-name>] [-a <acr-name>] [-c <container-apps-environment-resource-id>]

set -euo pipefail

RESOURCE_GROUP=""
LOCATION=""
REPO=""
BRANCH="main"
GH_ENVIRONMENT=""
IDENTITY_NAME=""
ACR_NAME="csingh914octocat5acr"
CONTAINER_APPS_ENVIRONMENT_ID=""
ROLE="Contributor"

while getopts "g:l:r:b:e:n:a:c:R:h" opt; do
  case "$opt" in
    g) RESOURCE_GROUP="$OPTARG" ;;
    l) LOCATION="$OPTARG" ;;
    r) REPO="$OPTARG" ;;
    b) BRANCH="$OPTARG" ;;
    e) GH_ENVIRONMENT="$OPTARG" ;;
    n) IDENTITY_NAME="$OPTARG" ;;
    a) ACR_NAME="$OPTARG" ;;
    c) CONTAINER_APPS_ENVIRONMENT_ID="$OPTARG" ;;
    R) ROLE="$OPTARG" ;;
    h) sed -n '2,19p' "$0"; exit 0 ;;
    *) exit 1 ;;
  esac
done

command -v az >/dev/null || { echo "az CLI not found" >&2; exit 1; }
command -v gh >/dev/null || { echo "gh CLI not found" >&2; exit 1; }

az account show >/dev/null 2>&1 || { echo "Run 'az login' first." >&2; exit 1; }

if [[ -z "$REPO" ]]; then
  REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
fi

PLAIN_REPO_SUBJECT_PREFIX="repo:$REPO"
EMU_REPO_SUBJECT_PREFIX=""
if repo_subject_parts=$(gh api "repos/$REPO" --jq '[.owner.login, .owner.id, .name, .id] | @tsv' 2>/dev/null); then
  read -r REPO_OWNER REPO_OWNER_ID REPO_NAME REPO_ID <<<"$repo_subject_parts"
  if [[ -n "$REPO_OWNER" && -n "$REPO_OWNER_ID" && -n "$REPO_NAME" && -n "$REPO_ID" ]]; then
    EMU_REPO_SUBJECT_PREFIX="repo:${REPO_OWNER}@${REPO_OWNER_ID}/${REPO_NAME}@${REPO_ID}"
  fi
else
  echo "! Could not read GitHub repository ids; skipping Enterprise Managed User OIDC subjects."
fi

# Managed identity names allow only alphanumerics, hyphens and underscores.
[[ -n "$IDENTITY_NAME" ]] || IDENTITY_NAME="id-gh-oidc-$(echo "${REPO//\//-}" | tr -cd '[:alnum:]-_')"

SUBSCRIPTION_ID=$(az account show --query id -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)

echo "Repo:           $REPO"
echo "Subscription:   $SUBSCRIPTION_ID"
echo "Tenant:         $TENANT_ID"
echo "Resource group: $RESOURCE_GROUP ($LOCATION)"
echo "Identity:       $IDENTITY_NAME (user-assigned managed identity)"
echo "Registry:       $ACR_NAME"
echo "Role:           $ROLE"
if [[ -n "$CONTAINER_APPS_ENVIRONMENT_ID" ]]; then
  echo "Container Apps environment: $CONTAINER_APPS_ENVIRONMENT_ID"
fi
echo

# --- 1. Resource group -------------------------------------------------------
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" -o none
echo "✓ resource group ready"

# --- 2. User-assigned managed identity ---------------------------------------
if az identity show --name "$IDENTITY_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  echo "✓ reusing existing managed identity"
else
  az identity create \
    --name "$IDENTITY_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    -o none
  echo "✓ created managed identity"
fi

read -r CLIENT_ID PRINCIPAL_ID IDENTITY_RESOURCE_ID <<<"$(az identity show \
  --name "$IDENTITY_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "[clientId, principalId, id]" -o tsv | paste -s)"

# --- 3. Container registry and image permissions ----------------------------
if az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  echo "✓ reusing existing container registry"
else
  az acr create \
    --name "$ACR_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --sku Basic \
    --admin-enabled false \
    -o none
  echo "✓ created container registry with admin credentials disabled"
fi

REGISTRY_SCOPE=$(az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" --query id -o tsv)
for registry_role in AcrPush AcrPull; do
  role_assignment_count=$(az role assignment list \
    --scope "$REGISTRY_SCOPE" \
    --assignee-object-id "$PRINCIPAL_ID" \
    --query "[?roleDefinitionName=='$registry_role'] | length(@)" -o tsv)
  if [[ "$role_assignment_count" == "0" ]]; then
    az role assignment create \
      --assignee-object-id "$PRINCIPAL_ID" \
      --assignee-principal-type ServicePrincipal \
      --role "$registry_role" \
      --scope "$REGISTRY_SCOPE" \
      -o none
  fi
  echo "✓ $registry_role granted on $REGISTRY_SCOPE"
done

# --- 4. Role assignment (scoped to the resource group) -----------------------
SCOPE="/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP"
ROLE_ASSIGNMENT_COUNT=$(az role assignment list \
  --scope "$SCOPE" \
  --assignee-object-id "$PRINCIPAL_ID" \
  --query "[?roleDefinitionName=='$ROLE'] | length(@)" -o tsv)
if [[ "$ROLE_ASSIGNMENT_COUNT" == "0" ]]; then
  az role assignment create \
    --assignee-object-id "$PRINCIPAL_ID" \
    --assignee-principal-type ServicePrincipal \
    --role "$ROLE" \
    --scope "$SCOPE" \
    -o none
fi
echo "✓ $ROLE granted on $SCOPE"

# --- 5. Existing Container Apps environment (optional) ----------------------
CONTAINER_APPS_LOCATION=""
if [[ -n "$CONTAINER_APPS_ENVIRONMENT_ID" ]]; then
  CONTAINER_APPS_LOCATION=$(az resource show \
    --ids "$CONTAINER_APPS_ENVIRONMENT_ID" \
    --query location \
    --output tsv)
  if [[ -z "$CONTAINER_APPS_LOCATION" ]]; then
    echo "Could not determine the Container Apps environment location." >&2
    exit 1
  fi

  ENVIRONMENT_ROLE="Container Apps Contributor"
  ENVIRONMENT_ROLE_COUNT=$(az role assignment list \
    --scope "$CONTAINER_APPS_ENVIRONMENT_ID" \
    --assignee-object-id "$PRINCIPAL_ID" \
    --query "[?roleDefinitionName=='$ENVIRONMENT_ROLE'] | length(@)" -o tsv)
  if [[ "$ENVIRONMENT_ROLE_COUNT" == "0" ]]; then
    az role assignment create \
      --assignee-object-id "$PRINCIPAL_ID" \
      --assignee-principal-type ServicePrincipal \
      --role "$ENVIRONMENT_ROLE" \
      --scope "$CONTAINER_APPS_ENVIRONMENT_ID" \
      -o none
  fi
  echo "✓ $ENVIRONMENT_ROLE granted on $CONTAINER_APPS_ENVIRONMENT_ID ($CONTAINER_APPS_LOCATION)"
fi

# --- 6. Federated credentials ------------------------------------------------
add_federated_credential() {
  local name="$1" subject="$2"
  if [[ "$(az identity federated-credential list \
             --identity-name "$IDENTITY_NAME" \
             --resource-group "$RESOURCE_GROUP" \
             --query "[?subject=='$subject'] | length(@)" -o tsv)" != "0" ]]; then
    echo "  · federated credential already exists: $subject"
    return
  fi
  az identity federated-credential create \
    --name "$name" \
    --identity-name "$IDENTITY_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --issuer "https://token.actions.githubusercontent.com" \
    --subject "$subject" \
    --audiences "api://AzureADTokenExchange" \
    -o none
  echo "  · added federated credential: $subject"
}

add_federated_credential "gh-branch-$BRANCH" "$PLAIN_REPO_SUBJECT_PREFIX:ref:refs/heads/$BRANCH"
add_federated_credential "gh-pull-request" "$PLAIN_REPO_SUBJECT_PREFIX:pull_request"
if [[ -n "$GH_ENVIRONMENT" ]]; then
  add_federated_credential "gh-env-$GH_ENVIRONMENT" "$PLAIN_REPO_SUBJECT_PREFIX:environment:$GH_ENVIRONMENT"
fi
if [[ -n "$EMU_REPO_SUBJECT_PREFIX" ]]; then
  add_federated_credential "gh-emu-branch-$BRANCH" "$EMU_REPO_SUBJECT_PREFIX:ref:refs/heads/$BRANCH"
  add_federated_credential "gh-emu-pull-request" "$EMU_REPO_SUBJECT_PREFIX:pull_request"
  if [[ -n "$GH_ENVIRONMENT" ]]; then
    add_federated_credential "gh-emu-env-$GH_ENVIRONMENT" "$EMU_REPO_SUBJECT_PREFIX:environment:$GH_ENVIRONMENT"
  fi
fi
echo "✓ federated credentials configured"

# --- 7. GitHub secrets + variables ------------------------------------------
# The default Codespaces GITHUB_TOKEN cannot write Actions secrets (403), so fall
# back to printing the values instead of failing after the Azure side is done.
gh_write_ok=1
push_secret()   { gh secret   set "$1" --repo "$REPO" --body "$2" 2>/dev/null || gh_write_ok=0; }
push_variable() { gh variable set "$1" --repo "$REPO" --body "$2" 2>/dev/null || gh_write_ok=0; }

push_secret AZURE_CLIENT_ID       "$CLIENT_ID"
push_secret AZURE_TENANT_ID       "$TENANT_ID"
push_secret AZURE_SUBSCRIPTION_ID "$SUBSCRIPTION_ID"
push_variable AZURE_RESOURCE_GROUP    "$RESOURCE_GROUP"
push_variable AZURE_LOCATION          "$LOCATION"
push_variable AZURE_IDENTITY_RESOURCE_ID "$IDENTITY_RESOURCE_ID"
push_variable AZURE_CONTAINER_APPS_ENVIRONMENT_ID "$CONTAINER_APPS_ENVIRONMENT_ID"
push_variable AZURE_CONTAINER_APPS_LOCATION "$CONTAINER_APPS_LOCATION"

echo
if [[ "$gh_write_ok" == "1" ]]; then
  echo "✓ GitHub secrets and variables set"
  echo "Done. AZURE_CLIENT_ID=$CLIENT_ID"
  echo "Verify with: gh workflow run deploy.yml --repo $REPO"
else
  cat <<EOF
! Could not write GitHub secrets/variables with the current token.
  The Azure side is fully configured. Re-run after 'gh auth login' with a PAT
  that has the 'repo' scope, or add these manually at
  https://github.com/$REPO/settings/secrets/actions

  Secrets:
    AZURE_CLIENT_ID        $CLIENT_ID
    AZURE_TENANT_ID        $TENANT_ID
    AZURE_SUBSCRIPTION_ID  $SUBSCRIPTION_ID

  Variables (https://github.com/$REPO/settings/variables/actions):
    AZURE_RESOURCE_GROUP        $RESOURCE_GROUP
    AZURE_LOCATION              $LOCATION
    AZURE_IDENTITY_RESOURCE_ID  $IDENTITY_RESOURCE_ID
EOF
fi

cat <<EOF

Reuse tip: the same identity can pull from ACR without admin credentials —
  az role assignment create --assignee-object-id $PRINCIPAL_ID \\
    --assignee-principal-type ServicePrincipal --role AcrPull \\
    --scope <acr-resource-id>
then reference \$AZURE_IDENTITY_RESOURCE_ID as the container app's userAssignedIdentity.
EOF
