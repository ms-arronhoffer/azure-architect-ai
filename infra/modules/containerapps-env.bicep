// Container Apps environment with attached Log Analytics + App Insights,
// VNet-injected into aca-subnet so it can reach private Postgres.

param prefix string
param env string
param location string
param tags object
param acaSubnetId string

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
    vnetConfiguration: {
      infrastructureSubnetId: acaSubnetId
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
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

output environmentId string = cae.id
output environmentName string = cae.name
output appInsightsConnectionString string = ai.properties.ConnectionString
