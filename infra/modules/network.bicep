// VNet with three subnets (aca, private endpoints, postgres) and
// private DNS zones for Postgres, Key Vault, and Azure OpenAI.

param prefix string
param env string
param location string
param tags object

@description('VNet address space, /20 default gives ample room for the three subnets.')
param addressPrefix string = '10.50.0.0/20'

var vnetName = '${prefix}-${env}-vnet'

var acaSubnetPrefix = cidrSubnet(addressPrefix, 23, 0)
var peSubnetPrefix = cidrSubnet(addressPrefix, 24, 2)
var dataSubnetPrefix = cidrSubnet(addressPrefix, 24, 3)

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: vnetName
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [ addressPrefix ]
    }
    subnets: [
      {
        name: 'aca-subnet'
        properties: {
          addressPrefix: acaSubnetPrefix
          delegations: [
            {
              name: 'aca-delegation'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
        }
      }
      {
        name: 'pe-subnet'
        properties: {
          addressPrefix: peSubnetPrefix
          privateEndpointNetworkPolicies: 'Disabled'
          privateLinkServiceNetworkPolicies: 'Disabled'
        }
      }
      {
        name: 'data-subnet'
        properties: {
          addressPrefix: dataSubnetPrefix
          delegations: [
            {
              name: 'pg-delegation'
              properties: {
                serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers'
              }
            }
          ]
        }
      }
    ]
  }
}

var dnsZoneNames = [
  'privatelink.postgres.database.azure.com'
  'privatelink.vaultcore.azure.net'
  'privatelink.openai.azure.com'
  'privatelink.search.windows.net'
]

resource dnsZones 'Microsoft.Network/privateDnsZones@2024-06-01' = [for zone in dnsZoneNames: {
  name: zone
  location: 'global'
  tags: tags
}]

resource dnsLinks 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = [for (zone, i) in dnsZoneNames: {
  parent: dnsZones[i]
  name: '${vnetName}-link'
  location: 'global'
  tags: tags
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}]

output id string = vnet.id
output vnetId string = vnet.id
output vnetName string = vnet.name
output acaSubnetId string = '${vnet.id}/subnets/aca-subnet'
output peSubnetId string = '${vnet.id}/subnets/pe-subnet'
output dataSubnetId string = '${vnet.id}/subnets/data-subnet'
output name string = vnet.name
output privateDnsZoneIds object = {
  postgres: dnsZones[0].id
  keyvault: dnsZones[1].id
  openai: dnsZones[2].id
  search: dnsZones[3].id
}
