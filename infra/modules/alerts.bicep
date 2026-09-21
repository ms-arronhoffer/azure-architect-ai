// Baseline metric alerts for a target Container App, routed to the on-call
// action group created by modules/monitoring.bicep.
//
// Split out of monitoring.bicep so the workspace / Application Insights
// component can be created *before* the container apps that emit telemetry
// into it, while the alerts (which need the app's resource ID) are applied
// afterwards. Keeping them in one module would create a dependency cycle.

param prefix string
param env string
param tags object

@description('Resource ID of the Container App to monitor with the metric alerts.')
param targetContainerAppId string

@description('Resource ID of the action group that receives alert notifications.')
param actionGroupId string

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
        actionGroupId: actionGroupId
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
        actionGroupId: actionGroupId
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
        actionGroupId: actionGroupId
      }
    ]
  }
}
