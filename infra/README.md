# `infra/` — Challenge 5 Azure deployment

This deployment runs the Octocat Supply frontend and TypeScript API on Azure
Container Apps.

## Architecture

```text
Azure Container Registry
        │
        ▼
Container Apps environment ── Log Analytics
  ├─ frontend: public nginx on port 80
  │      └─ proxies /api/* to the private API
  └─ api: internal Express service on port 3000
         └─ ephemeral SQLite database (demo only)
```

The browser calls the frontend's same-origin `/api` path. nginx forwards those
requests to the API over the Container Apps environment's internal network, so
the API does not need public ingress or browser-facing CORS.

The API uses its existing SQLite database inside the container. This is
intentionally **ephemeral for the demo**: data may be lost when a revision is
replaced or the app is rescheduled. This setup is not appropriate for
production persistence. Both apps are capped at one replica because the current
cart implementation also keeps cart state in process memory.

## Files

| File | Purpose |
| --- | --- |
| `main.bicep` | Creates the registry, Log Analytics workspace, Container Apps environment, identity role assignment, and both apps. |
| `modules/registry.bicep` | Basic ACR with the admin account disabled. |
| `modules/loganalytics.bicep` | Log Analytics workspace with 30-day retention. |
| `modules/containerapp-env.bicep` | Container Apps managed environment. |
| `modules/containerapp.bicep` | Reusable Container App module with managed-identity image pulls. |
| `main.parameters.json` | Demo defaults, including the available globally unique registry name. |

## Configure OIDC

Authenticate `az` and `gh`, then run:

```bash
./scripts/setup-oidc.sh \
  -g octocat-supply-challenge5-rg \
  -l eastus \
  -r csingh914/microhack-sdlc-labuser600-1 \
  -b main \
  -a csingh914octocat5acr
```

The signed-in Azure user needs permission to create resources in the resource
group and assign roles at that scope (for example, **Owner**, or **Contributor**
plus **Role Based Access Control Administrator**). The setup script creates
the registry and identity and assigns `Contributor`, `AcrPush`, and `AcrPull`;
plain `Contributor` alone cannot create those role assignments.

The script creates a user-assigned managed identity, grants it Contributor at
the resource-group scope, configures GitHub's branch federated credential, and
sets the following GitHub Actions secrets and variables when GitHub CLI has
permission to write them:

**Secrets:** `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`

**Variables:** `AZURE_RESOURCE_GROUP`, `AZURE_LOCATION`,
`AZURE_IDENTITY_RESOURCE_ID`

The setup script grants the identity `AcrPush` for workflow image publishing
and `AcrPull` for Container Apps. No registry admin password or Azure client
secret is used. Creating the Basic ACR incurs Azure charges while it exists.

## Deploy

The workflow [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)
is manual-only. From the repository's **Actions** tab, run **Deploy to Azure**
after configuring the OIDC secrets and variables. The setup script must have
created the resource group and registry first; the workflow verifies access,
builds and pushes both images, deploys Bicep, and checks the frontend and
proxied API.

Compile the infrastructure locally with:

```bash
az bicep build --file infra/main.bicep
```

For manual deployment, first ensure the registry exists and both images have
been pushed, then run `az deployment group create` with `infra/main.bicep`,
`infra/main.parameters.json`, and the `registryIdentityResourceId` parameter.
