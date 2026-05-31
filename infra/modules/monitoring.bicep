// Log Analytics + workspace-based Application Insights + on-call action group
// and three baseline metric alerts for a target Container App.

param prefix string
param env string
param location string
param tags object

@description('Resource ID of the Container App to monitor with the metric alerts.')
param targetContainerAppId string

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

resource alert5xx 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${prefix}-${env}-alert-http5xx'
  location: 'global'
  tags: tags
  properties: {
    description: 'HTTP 5xx responses > 5 in 5 minutes.'
    severity: 2
    enabled: true
    scopes: [ targetContainerAppId ]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    targetResourceType: 'Microsoft.App/containerApps'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'Http5xx'
          metricNamespace: 'Microsoft.App/containerApps'
          metricName: 'Requests'
          operator: 'GreaterThan'
          threshold: 5
          timeAggregation: 'Total'
          criterionType: 'StaticThresholdCriterion'
          dimensions: [
            {
              name: 'statusCodeCategory'
              operator: 'Include'
              values: [ '5xx' ]
            }
          ]
        }
      ]
    }
    actions: [
      {
        actionGroupId: actionGroup.id
      }
    ]
  }
}

resource alertCpu 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${prefix}-${env}-alert-cpu'
  location: 'global'
  tags: tags
  properties: {
    description: 'CPU usage > 80% for 10 minutes.'
    severity: 3
    enabled: true
    scopes: [ targetContainerAppId ]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT10M'
    targetResourceType: 'Microsoft.App/containerApps'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'CpuPercent'
          metricNamespace: 'Microsoft.App/containerApps'
          metricName: 'UsageNanoCores'
          operator: 'GreaterThan'
          threshold: 80
          timeAggregation: 'Average'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [
      {
        actionGroupId: actionGroup.id
      }
    ]
  }
}

resource alertMem 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${prefix}-${env}-alert-mem'
  location: 'global'
  tags: tags
  properties: {
    description: 'MemoryWorkingSet > 80% for 10 minutes.'
    severity: 3
    enabled: true
    scopes: [ targetContainerAppId ]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT10M'
    targetResourceType: 'Microsoft.App/containerApps'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'MemoryWorkingSet'
          metricNamespace: 'Microsoft.App/containerApps'
          metricName: 'WorkingSetBytes'
          operator: 'GreaterThan'
          threshold: 80
          timeAggregation: 'Average'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [
      {
        actionGroupId: actionGroup.id
      }
    ]
  }
}

output id string = law.id
output name string = law.name
output workspaceId string = law.id
output appInsightsConnectionString string = appi.properties.ConnectionString
output actionGroupId string = actionGroup.id
