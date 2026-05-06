@description('Nombre del Key Vault. Globally unique, 3-24 chars, alfanuméricos + guiones.')
@minLength(3)
@maxLength(24)
param name string

@description('Región Azure.')
param location string

@description('Tags estándar.')
param tags object

@description('Tenant ID donde reside el KV.')
param tenantId string = subscription().tenantId

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    tenantId: tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: null
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

output id string = kv.id
output name string = kv.name
output uri string = kv.properties.vaultUri
