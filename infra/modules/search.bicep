// Azure AI Search service with optional private endpoint into pe-subnet.

param prefix string
param env string
param location string
param tags object

param skuName string = 'standard'
param partitionCount int = 1
param replicaCount int = 1

@description('When true, public network access is disabled and a private endpoint is created.')
param usePrivateEndpoint bool = false

@description('Subnet ID for the private endpoint. Required when usePrivateEndpoint = true.')
param peSubnetId string = ''

@description('Private DNS zone ID for privatelink.search.windows.net. Required when usePrivateEndpoint = true.')
param privateDnsZoneId string = ''

var searchName = '${prefix}-${env}-search-${uniqueString(resourceGroup().id)}'

resource search 'Microsoft.Search/searchServices@2024-06-01-preview' = {
  name: searchName
  location: location
  tags: tags
  sku: {
    name: skuName
  }
  properties: {
    partitionCount: partitionCount
    replicaCount: replicaCount
    hostingMode: 'default'
    semanticSearch: 'free'
    publicNetworkAccess: usePrivateEndpoint ? 'disabled' : 'enabled'
    authOptions: {
      aadOrApiKey: {
        aadAuthFailureMode: 'http401WithBearerChallenge'
      }
    }
  }
}

resource pe 'Microsoft.Network/privateEndpoints@2024-05-01' = if (usePrivateEndpoint) {
  name: '${searchName}-pe'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: peSubnetId
    }
    privateLinkServiceConnections: [
      {
        name: '${searchName}-plsc'
        properties: {
          privateLinkServiceId: search.id
          groupIds: [ 'searchService' ]
        }
      }
    ]
  }
}

resource peDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = if (usePrivateEndpoint) {
  parent: pe
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'search'
        properties: {
          privateDnsZoneId: privateDnsZoneId
        }
      }
    ]
  }
}

output id string = search.id
output name string = search.name
output searchName string = search.name
output searchEndpoint string = 'https://${search.name}.search.windows.net'
