using './main.bicep'

param prefix = 'aarch'
param env = 'dev'
param location = 'eastus2'

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
    name: 'gpt-4o-mini'
    model: 'gpt-4o-mini'
    version: '2024-07-18'
    capacity: 50
  }
]
