// Subscription-scope entrypoint. Creates an RG and deploys all platform modules
// for a monolith Container Apps deployment of Azure Architect AI.
//
// Deploy:
//   az deployment sub create -l <region> -f infra/main.bicep -p infra/main.bicepparam

targetScope = 'subscription'

@description('Short prefix used for resource naming. Lowercase, 3-8 chars.')
@minLength(3)
@maxLength(8)
param prefix string

@description('Environment name (dev, stg, prod). Used in naming and tags.')
@allowed([ 'dev', 'stg', 'prod' ])
param env string = 'dev'

@description('Azure region for all resources.')
param location string = deployment().location

@description('Resource tags applied to every resource.')
param tags object = {
  app: 'azure-architect-ai'
  env: env
  managedBy: 'bicep'
}

@description('Azure OpenAI model deployments to create. Each entry: { name, model, version, capacity }.')
param openAiDeployments array = [
  {
    name: 'gpt-4.1'
    model: 'gpt-4.1'
    version: '2025-04-14'
    capacity: 50
  }
  {
    name: 'gpt-4o-mini'
    model: 'gpt-4o-mini'
    version: '2024-07-18'
    capacity: 50
  }
]

@description('Backend container image (set after first ACR build, e.g. <acr>.azurecr.io/aa-backend:<tag>).')
param backendImage string = 'mcr.microsoft.com/azuredocs/aci-helloworld:latest'

@description('Frontend container image (set after first ACR build, e.g. <acr>.azurecr.io/aa-frontend:<tag>).')
param frontendImage string = 'mcr.microsoft.com/azuredocs/aci-helloworld:latest'

@description('VNet address space.')
param vnetAddressPrefix string = '10.50.0.0/20'

@description('PostgreSQL admin password.')
@secure()
param postgresAdminPassword string

@description('Set true to deploy Azure AI Search.')
param deploySearch bool = false

@description('Set true to deploy Front Door fronting the frontend container app.')
param deployFrontDoor bool = true

@description('Email address that receives on-call alerts.')
param oncallEmail string

var rgName = '${prefix}-${env}-rg'

resource rg 'Microsoft.Resources/resourceGroups@2024-07-01' = {
  name: rgName
  location: location
  tags: tags
}

module identity 'modules/identity.bicep' = {
  name: 'identity'
  scope: rg
  params: {
    prefix: prefix
    env: env
    location: location
    tags: tags
  }
}

module network 'modules/network.bicep' = {
  name: 'network'
  scope: rg
  params: {
    prefix: prefix
    env: env
    location: location
    tags: tags
    addressPrefix: vnetAddressPrefix
  }
}

module acr 'modules/containerregistry.bicep' = {
  name: 'acr'
  scope: rg
  params: {
    prefix: prefix
    env: env
    location: location
    tags: tags
    miPrincipalId: identity.outputs.principalId
  }
}

module kv 'modules/keyvault.bicep' = {
  name: 'kv'
  scope: rg
  params: {
    prefix: prefix
    env: env
    location: location
    tags: tags
    miPrincipalId: identity.outputs.principalId
    privateDnsZoneId: network.outputs.privateDnsZoneIds.keyvault
    peSubnetId: network.outputs.peSubnetId
  }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  scope: rg
  params: {
    prefix: prefix
    env: env
    location: location
    tags: tags
  }
}

module openai 'modules/openai.bicep' = {
  name: 'openai'
  scope: rg
  params: {
    prefix: prefix
    env: env
    location: location
    tags: tags
    miPrincipalId: identity.outputs.principalId
    deployments: openAiDeployments
    privateDnsZoneId: network.outputs.privateDnsZoneIds.openai
    peSubnetId: network.outputs.peSubnetId
  }
}

module postgres 'modules/postgres.bicep' = {
  name: 'postgres'
  scope: rg
  params: {
    prefix: prefix
    env: env
    location: location
    tags: tags
    delegatedSubnetId: network.outputs.dataSubnetId
    privateDnsZoneId: network.outputs.privateDnsZoneIds.postgres
    administratorLoginPassword: postgresAdminPassword
  }
}

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  scope: rg
  params: {
    prefix: prefix
    env: env
    location: location
    tags: tags
    targetContainerAppId: backendApp.outputs.id
    oncallEmail: oncallEmail
  }
}

module search 'modules/search.bicep' = if (deploySearch) {
  name: 'search'
  scope: rg
  params: {
    prefix: prefix
    env: env
    location: location
    tags: tags
    usePrivateEndpoint: true
    peSubnetId: network.outputs.peSubnetId
    privateDnsZoneId: network.outputs.privateDnsZoneIds.search
  }
}

module acaEnv 'modules/containerapps-env.bicep' = {
  name: 'aca-env'
  scope: rg
  params: {
    prefix: prefix
    env: env
    location: location
    tags: tags
    storageAccountName: storage.outputs.accountName
    storageAccountKey: storage.outputs.accountKey
    fileShareName: storage.outputs.fileShareName
  }
}

module backendApp 'modules/containerapp.bicep' = {
  name: 'app-backend'
  scope: rg
  params: {
    name: '${prefix}-${env}-backend'
    location: location
    tags: tags
    environmentId: acaEnv.outputs.environmentId
    image: backendImage
    targetPort: 8000
    external: false
    miId: identity.outputs.id
    miClientId: identity.outputs.clientId
    acrLoginServer: acr.outputs.loginServer
    cpu: '1.0'
    memory: '2.0Gi'
    minReplicas: 1
    maxReplicas: 3
    envVars: [
      { name: 'AZURE_OPENAI_ENDPOINT', value: openai.outputs.endpoint }
      { name: 'AZURE_CLIENT_ID', value: identity.outputs.clientId }
      { name: 'AZURE_OPENAI_DEPLOYMENT', value: 'gpt-4.1' }
      { name: 'AZURE_OPENAI_MINI_DEPLOYMENT', value: 'gpt-4o-mini' }
      { name: 'ENABLE_MCP', value: 'true' }
    ]
    volumeMounts: [
      {
        volumeName: 'data'
        mountPath: '/app/data'
      }
    ]
    volumes: [
      {
        name: 'data'
        storageType: 'AzureFile'
        storageName: acaEnv.outputs.storageName
      }
    ]
  }
}

module frontendApp 'modules/containerapp.bicep' = {
  name: 'app-frontend'
  scope: rg
  params: {
    name: '${prefix}-${env}-frontend'
    location: location
    tags: tags
    environmentId: acaEnv.outputs.environmentId
    image: frontendImage
    targetPort: 8080
    external: true
    miId: identity.outputs.id
    miClientId: identity.outputs.clientId
    acrLoginServer: acr.outputs.loginServer
    cpu: '0.5'
    memory: '1.0Gi'
    minReplicas: 1
    maxReplicas: 3
    envVars: [
      { name: 'BACKEND_HOST', value: backendApp.outputs.internalFqdn }
    ]
  }
}

output resourceGroupName string = rg.name
output frontendUrl string = frontendApp.outputs.fqdn
output backendInternalFqdn string = backendApp.outputs.internalFqdn
output acrLoginServer string = acr.outputs.loginServer
output managedIdentityClientId string = identity.outputs.clientId
output keyVaultName string = kv.outputs.name
output openAiEndpoint string = openai.outputs.endpoint
output vnetId string = network.outputs.vnetId
output postgresFqdn string = postgres.outputs.serverFqdn
output appInsightsConnectionString string = monitoring.outputs.appInsightsConnectionString
output frontDoorHostname string = deployFrontDoor ? frontdoor.outputs.endpointHostname : ''

module frontdoor 'modules/frontdoor.bicep' = if (deployFrontDoor) {
  name: 'frontdoor'
  scope: rg
  params: {
    prefix: prefix
    env: env
    tags: tags
    originHostname: frontendApp.outputs.internalFqdn
  }
}
