// Writes the backend runtime secrets into the existing Key Vault.
// Called after the kv module so the vault exists; uses keyVaultName lookup.

param keyVaultName string

@secure()
param databaseUrl string

@secure()
param secretEncryptionKey string

resource kv 'Microsoft.KeyVault/vaults@2024-11-01' existing = {
  name: keyVaultName
}

resource dbUrlSecret 'Microsoft.KeyVault/vaults/secrets@2024-11-01' = {
  parent: kv
  name: 'database-url'
  properties: {
    value: databaseUrl
    contentType: 'text/plain'
  }
}

resource encKeySecret 'Microsoft.KeyVault/vaults/secrets@2024-11-01' = {
  parent: kv
  name: 'secret-encryption-key'
  properties: {
    value: secretEncryptionKey
    contentType: 'text/plain'
  }
}

output databaseUrlSecretName string = dbUrlSecret.name
output secretEncryptionKeySecretName string = encKeySecret.name
