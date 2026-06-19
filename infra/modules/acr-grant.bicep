// Cross-RG role assignment: grants the supplied managed identity
// "AcrPull" on an existing Azure Container Registry in another RG.

param acrName string
param miPrincipalId string

resource acr 'Microsoft.ContainerRegistry/registries@2025-04-01' existing = {
  name: acrName
}

var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource assignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, miPrincipalId, acrPullRoleId)
  scope: acr
  properties: {
    principalId: miPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
  }
}
