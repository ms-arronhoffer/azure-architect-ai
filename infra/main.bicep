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

@description('Environment name (dev, test, stg, prod). Used in naming and tags.')
@allowed([ 'dev', 'test', 'stg', 'prod' ])
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
    name: 'gpt-5.4'
    model: 'gpt-5.4'
    version: '2026-03-05'
    capacity: 50
  }
  {
    name: 'gpt-5.4-mini'
    model: 'gpt-5.4-mini'
    version: '2026-03-17'
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
param deployFrontDoor bool = false

@description('Email address that receives on-call alerts.')
param oncallEmail string

@description('Entra ID tenant ID (single-tenant app reg lives here).')
param entraTenantId string

@description('API app registration audience (client ID or api://<id> URI). Tokens issued for this audience authorise /api/* calls.')
param entraAudience string

@description('Custom domain bindings for the frontend container app. Each entry: { name, certificateId, bindingType }. Leave empty for envs that only use the default ACA FQDN.')
param frontendCustomDomains array = []

@description('Fernet key for at-rest secret encryption (Base64, 32 bytes). Generate once: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"')
@secure()
param secretEncryptionKey string

@description('When false, skip creating an AOAI account and instead grant the workload MI access to an existing one referenced by existingOpenAi*.')
param deployOpenAi bool = true

@description('Resource group of an existing AOAI account to share. Required when deployOpenAi=false.')
param existingOpenAiResourceGroup string = ''

@description('Name of an existing AOAI account to share. Required when deployOpenAi=false.')
param existingOpenAiName string = ''

@description('Endpoint of an existing AOAI account (e.g. https://<name>.openai.azure.com/). Required when deployOpenAi=false.')
param existingOpenAiEndpoint string = ''

@description('When false, skip creating an ACR and instead grant the workload MI AcrPull on an existing one referenced by existingAcr*.')
param deployAcr bool = true

@description('Resource group of an existing ACR to share. Required when deployAcr=false.')
param existingAcrResourceGroup string = ''

@description('Name of an existing ACR to share. Required when deployAcr=false.')
param existingAcrName string = ''

@description('Login server (e.g. <name>.azurecr.io) of an existing ACR. Required when deployAcr=false.')
param existingAcrLoginServer string = ''

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
    createOpenAiPrivateDnsZone: deployOpenAi
    createSearchPrivateDnsZone: deploySearch
  }
}

module acr 'modules/containerregistry.bicep' = if (deployAcr) {
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

module acrGrant 'modules/acr-grant.bicep' = if (!deployAcr) {
  name: 'acr-grant'
  scope: resourceGroup(existingAcrResourceGroup)
  params: {
    acrName: existingAcrName
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

module openai 'modules/openai.bicep' = if (deployOpenAi) {
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

module openaiGrant 'modules/openai-grant.bicep' = if (!deployOpenAi) {
  name: 'openai-grant'
  scope: resourceGroup(existingOpenAiResourceGroup)
  params: {
    aoaiName: existingOpenAiName
    miPrincipalId: identity.outputs.principalId
  }
}

#disable-next-line BCP318
var aoaiEndpoint = deployOpenAi ? openai.outputs.endpoint : existingOpenAiEndpoint
#disable-next-line BCP318
var acrLoginServer = deployAcr ? acr.outputs.loginServer : existingAcrLoginServer

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

module kvSecrets 'modules/keyvault-secrets.bicep' = {
  name: 'kv-secrets'
  scope: rg
  params: {
    keyVaultName: kv.outputs.name
    databaseUrl: 'postgresql+asyncpg://${postgres.outputs.administratorLogin}:${postgresAdminPassword}@${postgres.outputs.serverFqdn}:5432/${postgres.outputs.databaseName}?ssl=require'
    secretEncryptionKey: secretEncryptionKey
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
    acaSubnetId: network.outputs.acaSubnetId
  }
}

module backendApp 'modules/containerapp.bicep' = {
  name: 'app-backend'
  scope: rg
  dependsOn: [ kvSecrets ]
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
    acrLoginServer: acrLoginServer
    cpu: '1.0'
    memory: '2.0Gi'
    minReplicas: 1
    maxReplicas: 3
    envVars: [
      { name: 'AZURE_OPENAI_ENDPOINT', value: aoaiEndpoint }
      { name: 'AZURE_CLIENT_ID', value: identity.outputs.clientId }
      { name: 'AZURE_OPENAI_DEPLOYMENT_ARCH', value: 'gpt-5.4' }
      { name: 'AZURE_OPENAI_DEPLOYMENT_CHAT', value: 'gpt-5.4' }
      { name: 'AZURE_OPENAI_DEPLOYMENT_EMBEDDING', value: 'text-embedding-ada-002' }
      { name: 'ENABLE_MCP', value: 'true' }
      { name: 'AUTH_ENABLED', value: 'true' }
      { name: 'UNIFIED_AGENTS', value: 'false' }
      { name: 'ENTRA_TENANT_ID', value: entraTenantId }
      { name: 'ENTRA_AUDIENCE', value: entraAudience }
      { name: 'SESSION_COOKIE_SECURE', value: 'true' }
      { name: 'DATABASE_URL', secretRef: 'database-url' }
      { name: 'SECRET_ENCRYPTION_KEY', secretRef: 'secret-encryption-key' }
    ]
    secrets: [
      {
        name: 'database-url'
        keyVaultUrl: '${kv.outputs.uri}secrets/database-url'
        identity: identity.outputs.id
      }
      {
        name: 'secret-encryption-key'
        keyVaultUrl: '${kv.outputs.uri}secrets/secret-encryption-key'
        identity: identity.outputs.id
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
    acrLoginServer: acrLoginServer
    cpu: '0.5'
    memory: '1.0Gi'
    minReplicas: 1
    maxReplicas: 3
    envVars: [
      { name: 'BACKEND_HOST', value: backendApp.outputs.internalFqdn }
      { name: 'BACKEND_PORT', value: '443' }
    ]
    customDomains: frontendCustomDomains
  }
}

output resourceGroupName string = rg.name
output frontendUrl string = frontendApp.outputs.fqdn
output backendInternalFqdn string = backendApp.outputs.internalFqdn
output acrLoginServer string = acrLoginServer
output managedIdentityClientId string = identity.outputs.clientId
output keyVaultName string = kv.outputs.name
output openAiEndpoint string = aoaiEndpoint
output vnetId string = network.outputs.vnetId
output postgresFqdn string = postgres.outputs.serverFqdn
output appInsightsConnectionString string = monitoring.outputs.appInsightsConnectionString
#disable-next-line BCP318
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
