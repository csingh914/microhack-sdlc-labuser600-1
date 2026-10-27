// =============================================================================
// Module: containerapp.bicep  (generic Container App — reused for api + frontend)
// -----------------------------------------------------------------------------
// One reusable module for BOTH workloads:
//   - api:      target port 3000, internal ingress
//   - frontend: target port 80, external ingress, with API_HOST/API_PORT env
//               vars pointing at the api app so nginx can proxy /api.
// =============================================================================

@description('Azure region for the app.')
param location string

@description('Name of the container app (also its DNS label within the environment).')
param appName string

@description('Resource ID of the Container Apps managed environment.')
param environmentId string

@description('Fully-qualified image reference, e.g. myregistry.azurecr.io/api:latest.')
param image string

@description('The port the container listens on (api=3000, frontend=80).')
param targetPort int

@description('Whether ingress is exposed externally (public). Set false for internal-only.')
param externalIngress bool = true

@description('Login server of the ACR the image is pulled from.')
param registryLoginServer string

@description('Resource ID of the user-assigned managed identity used to pull images.')
param registryIdentityResourceId string

@description('Environment variables for the container. Array of { name, value } objects.')
param env array = []

@description('Tags applied to the app.')
param tags object = {}

@minValue(0)
param minReplicas int = 1

@minValue(1)
param maxReplicas int = 1

param cpu string = '0.5'
param memory string = '1.0Gi'

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${registryIdentityResourceId}': {}
    }
  }
  properties: {
    managedEnvironmentId: environmentId
    configuration: {
      ingress: {
        external: externalIngress
        targetPort: targetPort
        traffic: [
          {
            weight: 100
            latestRevision: true
          }
        ]
      }
      registries: [
        {
          server: registryLoginServer
          identity: registryIdentityResourceId
        }
      ]
    }
    template: {
      containers: [
        {
          name: appName
          image: image
          resources: {
            cpu: json(cpu)
            memory: memory
          }
          env: env
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
    }
  }
}

@description('The fully-qualified domain name of the app (empty when ingress is disabled).')
output fqdn string = containerApp.properties.configuration.ingress.fqdn

@description('The name of the container app.')
output appName string = containerApp.name
