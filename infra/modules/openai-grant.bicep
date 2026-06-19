// Cross-RG role assignment: grants the supplied managed identity
// "Cognitive Services OpenAI User" on an existing AOAI account in another RG.

param aoaiName string
param miPrincipalId string

resource aoai 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: aoaiName
}

var openAiUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'

resource assignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(aoai.id, miPrincipalId, openAiUserRoleId)
  scope: aoai
  properties: {
    principalId: miPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', openAiUserRoleId)
  }
}
