@description('Nombre del Container Apps Environment.')
param name string

@description('Región Azure.')
param location string

@description('Tags estándar.')
param tags object

@description('Nombre del Storage Account que hostea el File Share a montar como volumen. Vacío deshabilita la definición de storage del CAE.')
param dataStorageAccountName string = ''

@description('Nombre del File Share SMB dentro del Storage Account.')
param dataFileShareName string = ''

@description('Account key del Storage Account (secret leído desde Key Vault en main.bicep). Solo necesaria si dataStorageAccountName está set.')
@secure()
param dataStorageAccountKey string = ''

var enableDataStorage = !empty(dataStorageAccountName) && !empty(dataFileShareName) && !empty(dataStorageAccountKey)
var dataStorageDefinitionName = 'mcp-data-storage'

// Sin appLogsConfiguration ni workloadProfiles → Consumption puro, logs visibles solo
// vía control plane (`az containerapp logs show`). La integración con Log Analytics /
// App Insights se añade cuando se retome Slice 2 / Slice 7.
resource cae 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    zoneRedundant: false
  }
}

resource dataStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = if (enableDataStorage) {
  parent: cae
  name: dataStorageDefinitionName
  properties: {
    azureFile: {
      accountName: dataStorageAccountName
      accountKey: dataStorageAccountKey
      shareName: dataFileShareName
      accessMode: 'ReadWrite'
    }
  }
}

output id string = cae.id
output name string = cae.name
output defaultDomain string = cae.properties.defaultDomain
output staticIp string = cae.properties.staticIp
output dataStorageDefinitionName string = enableDataStorage ? dataStorageDefinitionName : ''
