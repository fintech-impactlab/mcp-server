// User-Assigned Managed Identity para ca-web. Solo necesita AcrPull (no toca KV ni Storage).
// Si en el futuro la web requiere acceso a más recursos, se extiende este módulo.

@description('Nombre de la User-Assigned Identity.')
param name string

@description('Región Azure.')
param location string

@description('Tags estándar.')
param tags object

@description('Nombre del ACR sobre el que conceder AcrPull.')
param acrName string

var acrPullRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')

resource uai 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: name
  location: location
  tags: tags
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
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

output id string = uai.id
output principalId string = uai.properties.principalId
output clientId string = uai.properties.clientId
