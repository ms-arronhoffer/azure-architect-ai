// Container Apps environment with attached Log Analytics + App Insights, plus
// an environment-scoped Azure Files storage definition that the backend mounts.

param prefix string
param env string
param location string
param tags object
param storageAccountName string
@secure()
param storageAccountKey string
param fileShareName string

var lawName = '${prefix}-${env}-law'
var aiName  = '${prefix}-${env}-ai'
var envName = '${prefix}-${env}-cae'

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: lawName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource ai 'Microsoft.Insights/components@2020-02-02' = {
  name: aiName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: law.id
  }
}

resource cae 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: envName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: law.properties.customerId
        sharedKey: law.listKeys().primarySharedKey
      }
    }
    zoneRedundant: false
  }
}

resource caeStorage 'Microsoft.App/managedEnvironments/storages@2025-01-01' = {
  parent: cae
  name: 'data'
  properties: {
    azureFile: {
      accountName: storageAccountName
      accountKey: storageAccountKey
      shareName: fileShareName
      accessMode: 'ReadWrite'
    }
  }
}

output environmentId string = cae.id
output environmentName string = cae.name
output appInsightsConnectionString string = ai.properties.ConnectionString
output storageName string = caeStorage.name
