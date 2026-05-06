// User-Assigned Managed Identity para ca-web.
// Permisos asignados:
//   - AcrPull sobre ACR (para jalar la imagen).
//   - Key Vault Secrets User scoped al secret `mcp-api-key-web` específico
//     (para que Container Apps pueda inyectar MCP_API_KEY vía secretRef).
// Decisión: NO concedemos Secrets User a nivel de vault completo. Reduce el
// blast radius si uai-web se compromete (ver tasks/plan-auth.md A3.1).

@description('Nombre de la User-Assigned Identity.')
param name string

@description('Región Azure.')
param location string

@description('Tags estándar.')
param tags object

@description('Nombre del ACR sobre el que conceder AcrPull.')
param acrName string

@description('Nombre del Key Vault que contiene el secret mcp-api-key-web.')
param keyVaultName string

@description('Nombre del secret que contiene el bearer plaintext del cliente "web".')
param mcpApiKeyWebSecretName string = 'mcp-api-key-web'

var acrPullRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
var kvSecretsUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

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

// El secret debe existir antes de este deploy: lo crea
// `mcp-server/scripts/bootstrap-mcp-api-keys.mjs` (Slice A2.1+A2.4).
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource mcpApiKeyWebSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = {
  parent: kv
  name: mcpApiKeyWebSecretName
}

resource secretsUserAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: mcpApiKeyWebSecret
  name: guid(mcpApiKeyWebSecret.id, uai.id, 'KeyVaultSecretsUser')
  properties: {
    roleDefinitionId: kvSecretsUserRoleId
    principalId: uai.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

output id string = uai.id
output principalId string = uai.properties.principalId
output clientId string = uai.properties.clientId
