// Reusable Container App module. Used for backend and frontend.
// Pulls images from the workload's ACR via the user-assigned managed identity.

param name string
param location string
param tags object
param environmentId string
param image string
param targetPort int
@description('true = external ingress (public), false = internal-only.')
param external bool = false
param miId string
param miClientId string
param acrLoginServer string

param cpu string = '0.5'
param memory string = '1.0Gi'
param minReplicas int = 1
param maxReplicas int = 3

param envVars array = []
param volumeMounts array = []
param volumes array = []

@description('Container App secrets. Either { name, value } or KV-backed { name, keyVaultUrl, identity }. Referenced via secretRef in envVars.')
param secrets array = []

@description('Custom hostname bindings, e.g. [{ name: "example.com", certificateId: "<env-managed-cert-id>", bindingType: "SniEnabled" }].')
param customDomains array = []

resource app 'Microsoft.App/containerApps@2025-01-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${miId}': {}
    }
  }
  properties: {
    environmentId: environmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: external
        targetPort: targetPort
        transport: 'auto'
        allowInsecure: false
        customDomains: customDomains
      }
      registries: [
        {
          server: acrLoginServer
          identity: miId
        }
      ]
      secrets: secrets
    }
    template: {
      containers: [
        {
          name: name
          image: image
          resources: {
            cpu: json(cpu)
            memory: memory
          }
          env: concat(envVars, [
            {
              name: 'AZURE_CLIENT_ID_FALLBACK'
              value: miClientId
            }
          ])
          volumeMounts: volumeMounts
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
      volumes: volumes
    }
  }
}

output id string = app.id
output name string = app.name
output fqdn string = 'https://${app.properties.configuration.ingress.fqdn}'
output internalFqdn string = app.properties.configuration.ingress.fqdn
