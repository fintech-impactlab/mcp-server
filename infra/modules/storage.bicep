@description('Nombre del Storage Account. Debe ser globally unique, 3-24 chars, lowercase, sin guiones.')
@minLength(3)
@maxLength(24)
param name string

@description('Región Azure.')
param location string

@description('Tags estándar.')
param tags object

@description('Lista de blob containers a crear (private access). DORMANT — la persistencia activa está en el File Share `mcp-data` (ver ADR-001). Se mantienen aprovisionados pero sin role assignment en mcp-identity.bicep, listos para futuros tools que prefieran cache blob (cache.ts createBlobStore).')
param containerNames array = [
  'cache-cmf'
  'cache-rpsf'
  'audit'
]

@description('Nombre del File Share SMB que se monta como volumen en la Container App MCP.')
param fileShareName string = 'mcp-data'

@description('Cuota del File Share en GiB.')
@minValue(1)
@maxValue(102400)
param fileShareQuotaGiB int = 100

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
    encryption: {
      services: {
        blob: {
          enabled: true
        }
        file: {
          enabled: true
        }
      }
      keySource: 'Microsoft.Storage'
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 7
    }
  }
}

resource containers 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = [for c in containerNames: {
  parent: blobService
  name: c
  properties: {
    publicAccess: 'None'
  }
}]

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource dataFileShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  parent: fileService
  name: fileShareName
  properties: {
    accessTier: 'TransactionOptimized'
    shareQuota: fileShareQuotaGiB
    enabledProtocols: 'SMB'
  }
}

output id string = storage.id
output name string = storage.name
output blobEndpoint string = storage.properties.primaryEndpoints.blob
output fileShareName string = dataFileShare.name
