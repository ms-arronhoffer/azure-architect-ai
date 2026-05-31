// Storage account + file share. The file share backs SQLite persistence for the
// backend container app — Container Apps ephemeral storage would lose conversations
// across revisions.

param prefix string
param env string
param location string
param tags object

var saName = toLower(take(replace('${prefix}${env}st${uniqueString(resourceGroup().id)}', '-', ''), 24))

resource sa 'Microsoft.Storage/storageAccounts@2024-01-01' = {
  name: saName
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2024-01-01' = {
  parent: sa
  name: 'default'
}

resource share 'Microsoft.Storage/storageAccounts/fileServices/shares@2024-01-01' = {
  parent: fileService
  name: 'data'
  properties: {
    shareQuota: 10
    enabledProtocols: 'SMB'
  }
}

output accountId string = sa.id
output accountName string = sa.name
#disable-next-line outputs-should-not-contain-secrets
output accountKey string = sa.listKeys().keys[0].value
output fileShareName string = share.name
