// PostgreSQL Flexible Server v16 with VNet integration and pgvector enabled.
// The app DB lives on the data-subnet linked to the private DNS zone.

param prefix string
param env string
param location string
param tags object

@description('Subnet ID delegated to Microsoft.DBforPostgreSQL/flexibleServers.')
param delegatedSubnetId string

@description('Private DNS zone resource ID for privatelink.postgres.database.azure.com.')
param privateDnsZoneId string

param skuName string = 'Standard_B2s'
param skuTier string = 'Burstable'
param storageSizeGB int = 32

param administratorLogin string = 'pgadmin'

@secure()
param administratorLoginPassword string

param databaseName string = 'appdb'

var serverName = '${prefix}-${env}-pg-${uniqueString(resourceGroup().id)}'

resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: serverName
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {
    version: '16'
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorLoginPassword
    storage: {
      storageSizeGB: storageSizeGB
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      delegatedSubnetResourceId: delegatedSubnetId
      privateDnsZoneArmResourceId: privateDnsZoneId
      publicNetworkAccess: 'Disabled'
    }
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Enabled'
      tenantId: subscription().tenantId
    }
  }
}

resource vectorExt 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: pg
  name: 'azure.extensions'
  properties: {
    value: 'VECTOR'
    source: 'user-override'
  }
}

resource db 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: pg
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
  dependsOn: [ vectorExt ]
}

output id string = pg.id
output name string = pg.name
output serverName string = pg.name
output serverFqdn string = pg.properties.fullyQualifiedDomainName
output databaseName string = db.name
output administratorLogin string = administratorLogin
