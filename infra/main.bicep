// =============================================================================
// main.bicep — Challenge 5 Container Apps deployment
// -----------------------------------------------------------------------------
// Target architecture expressed here (Azure Container Apps):
//
//   ACR ──images──> ┌─────────────── Container Apps Environment ───────────────┐
//                   │  frontend (nginx, :80, external)  ──proxy──>  api (:3000) │
//                   └───────────────────────────────────────────────────────────┘
//                                    │ logs
//                            Log Analytics workspace
//
// The frontend's nginx proxies /api to the api app using API_HOST / API_PORT
// (see src/frontend/entrypoint.sh + nginx.conf). Within one Container Apps
// environment, apps can address each other by app name, which is what makes
// that service discovery work.
//
// The API is private, the frontend proxies /api using same-origin browser
// requests, and SQLite remains ephemeral for this demo.
// =============================================================================

targetScope = 'resourceGroup'

@description('Azure region for all resources. Defaults to the resource group location.')
param location string = resourceGroup().location

@description('Short prefix used to derive resource names (lowercase letters/numbers).')
@minLength(2)
@maxLength(12)
param namePrefix string = 'octocat'

@description('Environment name / suffix (e.g. dev, test, hack). Keeps names unique per env.')
param environmentName string = 'dev'

@description('Container image reference for the API (e.g. <acr>.azurecr.io/api:<tag>).')
param apiImage string

@description('Container image reference for the frontend (e.g. <acr>.azurecr.io/frontend:<tag>).')
param frontendImage string

@description('Name of the globally unique Azure Container Registry.')
param registryName string

@description('Resource ID of the user-assigned identity used for ACR push and pull.')
param registryIdentityResourceId string

@description('Minimum replicas for each app.')
@minValue(0)
param minReplicas int = 1

@description('Maximum replicas. Keep at one because cart state is process-local.')
@minValue(1)
param maxReplicas int = 3

// -----------------------------------------------------------------------------
// Derived names.
// -----------------------------------------------------------------------------
var baseName = '${namePrefix}-${environmentName}'
var logAnalyticsName = '${baseName}-logs'
var environmentResourceName = '${baseName}-env'
var apiAppName = '${baseName}-api'
var frontendAppName = '${baseName}-frontend'

var commonTags = {
  project: 'octocat-supply'
  challenge: 'challenge-5-azure-deploy'
  managedBy: 'bicep'
  environment: environmentName
}

// -----------------------------------------------------------------------------
// Container Registry
// -----------------------------------------------------------------------------
module registry 'modules/registry.bicep' = {
  name: 'registry'
  params: {
    location: location
    registryName: registryName
    tags: commonTags
  }
}

// -----------------------------------------------------------------------------
// Log Analytics (dependency of the Container Apps environment)
// -----------------------------------------------------------------------------
module logAnalytics 'modules/loganalytics.bicep' = {
  name: 'loganalytics'
  params: {
    location: location
    workspaceName: logAnalyticsName
    tags: commonTags
  }
}

// -----------------------------------------------------------------------------
// Container Apps managed environment
// -----------------------------------------------------------------------------
module environment 'modules/containerapp-env.bicep' = {
  name: 'containerapp-env'
  params: {
    location: location
    environmentName: environmentResourceName
    logAnalyticsWorkspaceId: logAnalytics.outputs.workspaceId
    tags: commonTags
  }
}

// -----------------------------------------------------------------------------
// API container app — internal ingress routes to the container on 3000.
// -----------------------------------------------------------------------------
module apiApp 'modules/containerapp.bicep' = {
  name: 'api-app'
  params: {
    location: location
    appName: apiAppName
    environmentId: environment.outputs.environmentId
    image: apiImage
    targetPort: 3000
    externalIngress: false
    registryLoginServer: registry.outputs.loginServer
    registryIdentityResourceId: registryIdentityResourceId
    minReplicas: minReplicas
    maxReplicas: maxReplicas
    tags: commonTags
    // The demo uses the API's default SQLite path inside the container.
    env: []
  }
}

// -----------------------------------------------------------------------------
// Frontend container app — nginx on 80, external, proxying to the api.
// -----------------------------------------------------------------------------
// The API_HOST/API_PORT env vars tell nginx where the api lives. Using the api
// app name resolves inside the environment for service discovery.
module frontendApp 'modules/containerapp.bicep' = {
  name: 'frontend-app'
  params: {
    location: location
    appName: frontendAppName
    environmentId: environment.outputs.environmentId
    image: frontendImage
    targetPort: 80
    externalIngress: true
    registryLoginServer: registry.outputs.loginServer
    registryIdentityResourceId: registryIdentityResourceId
    minReplicas: minReplicas
    maxReplicas: maxReplicas
    tags: commonTags
    env: [
      {
        name: 'API_HOST'
        value: apiAppName
      }
      {
        name: 'API_PORT'
        value: '3000'
      }
    ]
  }
}

// -----------------------------------------------------------------------------
// Outputs
// -----------------------------------------------------------------------------
@description('ACR login server — push images here and reference them in the apps.')
output acrLoginServer string = registry.outputs.loginServer

@description('Public URL of the frontend app.')
output frontendUrl string = 'https://${frontendApp.outputs.fqdn}'

@description('FQDN of the internal API app.')
output apiFqdn string = apiApp.outputs.fqdn
