// User-Assigned Managed Identity para el MCP server, con AcrPull + KV Secrets User
// + Storage Blob Data Contributor sobre los recursos del Slice 3.
// Se usa UAI (en lugar de system-assigned) para evitar el bootstrap circular
// ACR↔identity al crear el Container App por primera vez.

@description('Nombre de la User-Assigned Identity.')
param name string

@description('Región Azure.')
param location string

@description('Tags estándar.')
param tags object

@description('Nombre del ACR sobre el que conceder AcrPull.')
param acrName string

@description('Nombre del Storage Account sobre el que conceder Blob Data Contributor.')
param storageAccountName string

@description('Nombre del Key Vault sobre el que conceder Secrets User.')
param keyVaultName string

// Built-in role IDs (Azure RBAC)
var acrPullRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
var kvSecretsUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
var storageBlobContributorRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')

resource uai 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: name
  location: location
  tags: tags
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource acrPullAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: acr
  name: guid(acr.id, uai.id, 'AcrPull')
  properties: {
    roleDefinitionId: acrPullRoleId
    principalId: uai.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource kvSecretsUserAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: kv
  name: guid(kv.id, uai.id, 'KeyVaultSecretsUser')
  properties: {
    roleDefinitionId: kvSecretsUserRoleId
    principalId: uai.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource storageBlobAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, uai.id, 'StorageBlobDataContributor')
  properties: {
    roleDefinitionId: storageBlobContributorRoleId
    principalId: uai.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

output id string = uai.id
output principalId string = uai.properties.principalId
output clientId string = uai.properties.clientId
