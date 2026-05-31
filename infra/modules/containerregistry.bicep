// Azure Container Registry (Premium) with AcrPull granted to the workload MI.

param prefix string
param env string
param location string
param tags object
param miPrincipalId string

var acrName = toLower(replace('${prefix}${env}acr', '-', ''))

resource acr 'Microsoft.ContainerRegistry/registries@2025-04-01' = {
  name: acrName
  location: location
  tags: tags
  sku: {
    name: 'Premium'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
    zoneRedundancy: 'Disabled'
  }
}

// AcrPull role
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource pullAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, miPrincipalId, acrPullRoleId)
  scope: acr
  properties: {
    principalId: miPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
  }
}

output id string = acr.id
output name string = acr.name
output loginServer string = acr.properties.loginServer
