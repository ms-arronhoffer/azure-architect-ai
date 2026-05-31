// User-assigned managed identity used by all container apps.
// Single identity, scoped role assignments are added by the modules that own
// the target resource (kv, acr, openai).

param prefix string
param env string
param location string
param tags object

resource mi 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: '${prefix}-${env}-mi'
  location: location
  tags: tags
}

output id string = mi.id
output principalId string = mi.properties.principalId
output clientId string = mi.properties.clientId
output name string = mi.name
