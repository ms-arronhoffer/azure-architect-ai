using './main.bicep'

param prefix = 'aarch'
param env = 'test'
param location = 'centralus'

param tags = {
  app: 'azure-architect-ai'
  env: 'test'
  managedBy: 'bicep'
  owner: 'platform'
}

// Images live in the shared dev ACR.
param backendImage = 'aarchdevacr.azurecr.io/aa-backend:latest'
param frontendImage = 'aarchdevacr.azurecr.io/aa-frontend:latest'

// Share AOAI with aarch-dev-rg. The cross-RG grant module adds a role
// assignment on the shared account for the test workload MI.
param deployOpenAi = false
param existingOpenAiResourceGroup = 'aarch-dev-rg'
param existingOpenAiName = 'aarch-dev-aoai'
param existingOpenAiEndpoint = 'https://aarch-dev-aoai.openai.azure.com/'

// Share ACR with aarch-dev-rg.
param deployAcr = false
param existingAcrResourceGroup = 'aarch-dev-rg'
param existingAcrName = 'aarchdevacr'
param existingAcrLoginServer = 'aarchdevacr.azurecr.io'

// No model deployments to create — they live on the shared dev AOAI.
param openAiDeployments = []

param postgresAdminPassword = readEnvironmentVariable('PG_ADMIN_PASSWORD')
param secretEncryptionKey = readEnvironmentVariable('SECRET_ENCRYPTION_KEY')

param oncallEmail = readEnvironmentVariable('ONCALL_EMAIL', 'arronhoffer@microsoft.com')

param entraTenantId = readEnvironmentVariable('ENTRA_TENANT_ID')
param entraAudience = readEnvironmentVariable('ENTRA_AUDIENCE')

// Disambiguate from dev VNet (10.50.0.0/20).
param vnetAddressPrefix = '10.60.0.0/20'

// Custom domain for test frontend. Managed cert provisioned out-of-band in the
// test ACA env (one-time `az containerapp env certificate create --hostname ...`).
param frontendCustomDomains = [
  {
    name: 'dev.blueprint.techtools.host'
    certificateId: '/subscriptions/79398e05-f318-4010-a508-d913c3763e39/resourceGroups/aarch-test-rg/providers/Microsoft.App/managedEnvironments/aarch-test-cae/managedCertificates/dev.blueprint.techtools.host-aarch-te-260619193555'
    bindingType: 'SniEnabled'
  }
]
