// Log Analytics + workspace-based Application Insights + on-call action group.
//
// This is the single telemetry sink for the workload: the Container Apps
// environment streams console/system logs into the workspace and the backend
// exports OpenTelemetry traces, logs, and metrics into the Application Insights
// component via APPLICATIONINSIGHTS_CONNECTION_STRING. Metric alerts live in
// modules/alerts.bicep because they need the container app resource ID, which
// only exists after the apps are deployed.

param prefix string
param env string
param location string
param tags object

@description('Email address that receives critical alerts.')
param oncallEmail string

param retentionInDays int = 30

var workspaceName = '${prefix}-${env}-law'
var appiName = '${prefix}-${env}-appi'
var actionGroupName = '${prefix}-${env}-oncall-ag'

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: workspaceName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: retentionInDays
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

resource appi 'Microsoft.Insights/components@2020-02-02' = {
  name: appiName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: law.id
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource actionGroup 'Microsoft.Insights/actionGroups@2024-10-01-preview' = {
  name: actionGroupName
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'oncall'
    enabled: true
    emailReceivers: [
      {
        name: 'oncall-email'
        emailAddress: oncallEmail
        useCommonAlertSchema: true
      }
    ]
  }
}

output id string = law.id
output name string = law.name
output workspaceId string = law.id
output appInsightsConnectionString string = appi.properties.ConnectionString
output actionGroupId string = actionGroup.id
