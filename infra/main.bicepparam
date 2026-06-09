using './main.bicep'

param prefix = 'aarch'
param env = 'dev'
param location = 'centralus'

param tags = {
  app: 'azure-architect-ai'
  env: 'dev'
  managedBy: 'bicep'
  owner: 'platform'
}

// Set these after the first ACR build:
//   az acr build -r <acr>.azurecr.io -t aa-backend:v1 ./backend -f ./backend/Dockerfile.prod
//   az acr build -r <acr>.azurecr.io -t aa-frontend:v1 ./frontend -f ./frontend/Dockerfile.prod
// Then re-deploy with the real image references.
param backendImage = 'mcr.microsoft.com/azuredocs/aci-helloworld:latest'
param frontendImage = 'mcr.microsoft.com/azuredocs/aci-helloworld:latest'

param openAiDeployments = [
  {
    name: 'gpt-4.1'
    model: 'gpt-4.1'
    version: '2025-04-14'
    capacity: 50
  }
  {
    name: 'gpt-4.1-mini'
    model: 'gpt-4.1-mini'
    version: '2025-04-14'
    capacity: 50
  }
]

// Secrets sourced from environment at deploy time (set in GitHub Actions job env).
//   PG_ADMIN_PASSWORD: strong password for Postgres Flexible Server admin
//   SECRET_ENCRYPTION_KEY: Fernet key — generate once via
//     python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
param postgresAdminPassword = readEnvironmentVariable('PG_ADMIN_PASSWORD')
param secretEncryptionKey = readEnvironmentVariable('SECRET_ENCRYPTION_KEY')

param oncallEmail = readEnvironmentVariable('ONCALL_EMAIL', 'arronhoffer@microsoft.com')

// Entra ID single-tenant config. Set via env or replace inline.
//   ENTRA_TENANT_ID: directory (tenant) GUID
//   ENTRA_AUDIENCE: 'api://<api-app-client-id>' (or the bare client id GUID)
param entraTenantId = readEnvironmentVariable('ENTRA_TENANT_ID')
param entraAudience = readEnvironmentVariable('ENTRA_AUDIENCE')
