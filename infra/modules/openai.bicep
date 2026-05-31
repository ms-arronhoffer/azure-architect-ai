// Azure OpenAI account + model deployments. Workload MI gets
// Cognitive Services OpenAI User so DefaultAzureCredential works at runtime
// (matches the existing services/openai_service.py path).

param prefix string
param env string
param location string
param tags object
param miPrincipalId string

@description('Array of { name, model, version, capacity } objects.')
param deployments array

var aoaiName = '${prefix}-${env}-aoai'

resource aoai 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: aoaiName
  location: location
  tags: tags
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: aoaiName
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: false
  }
}

@batchSize(1)
resource modelDeployments 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = [for d in deployments: {
  parent: aoai
  name: d.name
  sku: {
    name: 'Standard'
    capacity: d.capacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: d.model
      version: d.version
    }
  }
}]

// Cognitive Services OpenAI User
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

output id string = aoai.id
output name string = aoai.name
output endpoint string = aoai.properties.endpoint
