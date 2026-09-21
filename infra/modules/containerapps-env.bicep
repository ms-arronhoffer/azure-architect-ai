// Container Apps environment, VNet-injected into aca-subnet so it can reach
// private Postgres.
//
// Console and system logs stream into the Log Analytics workspace created by
// modules/monitoring.bicep. The workspace is referenced (not re-declared) so
// there is exactly one telemetry sink per environment — declaring it here too
// produced two conflicting definitions of the same workspace name.

param prefix string
param env string
param location string
param tags object
param acaSubnetId string

@description('Name of the Log Analytics workspace (in this resource group) that receives container console + system logs.')
param logAnalyticsWorkspaceName string

var envName = '${prefix}-${env}-cae'

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logAnalyticsWorkspaceName
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
