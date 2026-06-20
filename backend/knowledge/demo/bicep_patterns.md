# Bicep Template Patterns

Reference patterns for generating Bicep infrastructure templates. All generated templates follow the `AISearchDemo` style: single `main.bicep` with inline resources, a matching `main.bicepparam`, and outputs formatted as `.env` paste-ready values.

---

## File Structure

```
infra/
├── main.bicep        # All resources inline (no modules for simple demos)
├── main.bicepparam   # Parameter values with comments
└── (modules/ only for complex multi-service demos)
```

---

## main.bicep Template Shell

```bicep
@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Base name used to derive resource names.')
param baseName string = '{demo-slug}'

@description('Principal ID (object ID) of the user or managed identity running the app.')
param principalId string

@description('Principal type for role assignments.')
@allowed(['User', 'ServicePrincipal', 'Group'])
param principalType string = 'User'

// ── Resource definitions here ──────────────────────────────────────────────

// ── Outputs (paste directly into .env) ────────────────────────────────────
output AZURE_OPENAI_ENDPOINT string = openAi.properties.endpoint
```

---

## main.bicepparam Template Shell

```bicep
using './main.bicep'

// Get your object ID: az ad signed-in-user show --query id -o tsv
param principalId = 'YOUR_PRINCIPAL_ID'

// Customize as needed
param baseName = '{demo-slug}'
param location = 'eastus'
```

---

## Resource Snippets

### Azure OpenAI + Model Deployments

```bicep
var cognitiveServicesOpenAiUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'

resource openAi 'Microsoft.CognitiveServices/accounts@2024-04-01-preview' = {
  name: '${baseName}-openai'
  location: location
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: {
    publicNetworkAccess: 'Enabled'
    customSubDomainName: '${baseName}-openai'
  }
}

// Deployments MUST use dependsOn to sequence them
resource embeddingDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-04-01-preview' = {
  parent: openAi
  name: 'text-embedding-3-small'
  sku: { name: 'Standard', capacity: 30 }
  properties: {
    model: { format: 'OpenAI', name: 'text-embedding-3-small', version: '1' }
  }
}

resource gpt4oMiniDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-04-01-preview' = {
  parent: openAi
  name: 'gpt-4o-mini'
  dependsOn: [embeddingDeployment]   // <-- required: sequential deployment
  sku: { name: 'Standard', capacity: 30 }
  properties: {
    model: { format: 'OpenAI', name: 'gpt-4o-mini', version: '2024-07-18' }
  }
}

resource gpt4oDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-04-01-preview' = {
  parent: openAi
  name: 'gpt-4o'
  dependsOn: [gpt4oMiniDeployment]
  sku: { name: 'Standard', capacity: 10 }
  properties: {
    model: { format: 'OpenAI', name: 'gpt-4o', version: '2024-11-20' }
  }
}

resource openAiUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: openAi
  name: guid(openAi.id, principalId, cognitiveServicesOpenAiUserRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesOpenAiUserRoleId)
    principalId: principalId
    principalType: principalType
  }
}
```

### Azure AI Search

```bicep
var searchServiceContributorRoleId   = '7ca78c08-252a-4471-8644-bb5ff32d4ba0'
var searchIndexDataContributorRoleId = '8ebe5a00-799e-43f5-93ac-243d3dce84a7'

resource searchService 'Microsoft.Search/searchServices@2023-11-01' = {
  name: '${baseName}-search'
  location: location
  sku: { name: 'basic' }   // basic = minimum tier for semantic ranking
  properties: {
    replicaCount: 1
    partitionCount: 1
    hostingMode: 'default'
    publicNetworkAccess: 'enabled'
    semanticSearch: 'free'
    disableLocalAuth: true
    authOptions: null
  }
}

resource searchContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: searchService
  name: guid(searchService.id, principalId, searchServiceContributorRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', searchServiceContributorRoleId)
    principalId: principalId
    principalType: principalType
  }
}

resource searchDataRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: searchService
  name: guid(searchService.id, principalId, searchIndexDataContributorRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', searchIndexDataContributorRoleId)
    principalId: principalId
    principalType: principalType
  }
}
```

### Azure Blob Storage

```bicep
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: replace('${baseName}store', '-', '')   // storage names: no hyphens, max 24 chars
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    publicNetworkAccess: 'Enabled'
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
  }
}

resource documentsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  name: '${storageAccount.name}/default/documents'
  properties: { publicAccess: 'None' }
}

resource storageBlobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storageAccount
  name: guid(storageAccount.id, principalId, storageBlobDataContributorRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributorRoleId)
    principalId: principalId
    principalType: principalType
  }
}
```

### Cosmos DB (NoSQL)

```bicep
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2023-11-15' = {
  name: '${baseName}-cosmos'
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    locations: [{ locationName: location, failoverPriority: 0 }]
    capabilities: [{ name: 'EnableServerless' }]   // serverless = cheapest for demos
    disableLocalAuth: true
  }
}

resource cosmosDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2023-11-15' = {
  parent: cosmosAccount
  name: '${baseName}-db'
  properties: { resource: { id: '${baseName}-db' } }
}
```

---

## Standard Outputs Block

Always include this at the end of `main.bicep`. Users paste these into `.env`:

```bicep
// ── Outputs (paste directly into .env) ────────────────────────────────────
output AZURE_OPENAI_ENDPOINT string = openAi.properties.endpoint
// Add per-resource outputs here — one per environment variable the app needs
```

---

## Deploy Commands to Include in README

```bash
# One-time setup
az login
az group create --name {demo-slug}-rg --location eastus

# Get your principal ID
az ad signed-in-user show --query id -o tsv
# Paste that value into infra/main.bicepparam as principalId

# Deploy
az deployment group create \
  --resource-group {demo-slug}-rg \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam

# Capture outputs into .env
az deployment group show \
  --resource-group {demo-slug}-rg \
  --name main \
  --query properties.outputs \
  --output json
```
