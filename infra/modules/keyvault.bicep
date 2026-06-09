// Key Vault (RBAC mode) for runtime secrets.
// The workload MI gets Key Vault Secrets User on the vault.

param prefix string
param env string
param location string
param tags object
param miPrincipalId string

@description('Private DNS zone ID for privatelink.vaultcore.azure.net. When non-empty along with peSubnetId, a private endpoint is created.')
param privateDnsZoneId string = ''

@description('Subnet ID for the Key Vault private endpoint. When non-empty along with privateDnsZoneId, a private endpoint is created.')
param peSubnetId string = ''

var deployPrivateEndpoint = !empty(privateDnsZoneId) && !empty(peSubnetId)

var kvName = take(toLower(replace('${prefix}-${env}-kv-${uniqueString(resourceGroup().id, location)}', '_', '-')), 24)

resource kv 'Microsoft.KeyVault/vaults@2024-11-01' = {
  name: kvName
  location: location
  tags: tags
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
  }
}

// Key Vault Secrets User
var secretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

resource assignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, miPrincipalId, secretsUserRoleId)
  scope: kv
  properties: {
    principalId: miPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', secretsUserRoleId)
  }
}

output id string = kv.id
output name string = kv.name
output uri string = kv.properties.vaultUri

resource pe 'Microsoft.Network/privateEndpoints@2024-05-01' = if (deployPrivateEndpoint) {
  name: '${kvName}-pe'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: peSubnetId
    }
    privateLinkServiceConnections: [
      {
        name: '${kvName}-plsc'
        properties: {
          privateLinkServiceId: kv.id
          groupIds: [ 'vault' ]
        }
      }
    ]
  }
}

resource peDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = if (deployPrivateEndpoint) {
  parent: pe
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'keyvault'
        properties: {
          privateDnsZoneId: privateDnsZoneId
        }
      }
    ]
  }
}
