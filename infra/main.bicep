targetScope = 'resourceGroup'

@description('Identificador corto del proyecto. Se usa en el naming de recursos.')
param project string = 'fintech'

@description('Nombre del entorno (dev, staging, prod). Se usa en el naming de recursos.')
@allowed([
  'dev'
  'staging'
  'prod'
])
param env string = 'dev'

@description('Región Azure para todos los recursos.')
param location string = resourceGroup().location

@description('Owner del proyecto. Solo se usa como tag. Inyectar al deploy si se quiere identificar individuo.')
param owner string = 'fintech-team'

// Sufijo único determinístico para nombres globales (Storage, KV).
// Se basa en el RG ID, así dentro del mismo RG el sufijo es estable.
var uniqueSuffix = uniqueString(resourceGroup().id)

var commonTags = {
  project: 'fintech-mcp'
  env: env
  owner: owner
  managedBy: 'bicep'
}

// ───── Slice 3: ACR + Storage + Key Vault ─────

module acr './modules/acr.bicep' = {
  name: 'deploy-acr'
  params: {
    name: take('acr${project}${env}${uniqueSuffix}', 50)
    location: location
    tags: commonTags
  }
}

module storage './modules/storage.bicep' = {
  name: 'deploy-storage'
  params: {
    name: take('st${project}${env}${uniqueSuffix}', 24)
    location: location
    tags: commonTags
  }
}

module keyVault './modules/key-vault.bicep' = {
  name: 'deploy-keyvault'
  params: {
    name: take('kv-${project}-${env}-${uniqueSuffix}', 24)
    location: location
    tags: commonTags
  }
}

// ───── Slice 4: Container Apps Environment ─────

module cae './modules/container-apps-env.bicep' = {
  name: 'deploy-cae'
  params: {
    name: 'cae-${project}-${env}'
    location: location
    tags: commonTags
  }
}

// ───── Slice 5: MCP server identity + RBAC + Container App ─────

@description('Tag de la imagen del MCP server en ACR. Se actualiza en cada deploy de CI.')
param mcpImageTag string = 'bootstrap'

module mcpIdentity './modules/mcp-identity.bicep' = {
  name: 'deploy-mcp-identity'
  params: {
    name: 'uai-mcp-${env}'
    location: location
    tags: commonTags
    acrName: acr.outputs.name
    storageAccountName: storage.outputs.name
    keyVaultName: keyVault.outputs.name
  }
}

module mcpApp './modules/container-app.bicep' = {
  name: 'deploy-mcp-app'
  params: {
    name: 'ca-mcp-${project}-${env}'
    location: location
    tags: commonTags
    environmentId: cae.outputs.id
    image: '${acr.outputs.loginServer}/mcp-server:${mcpImageTag}'
    acrLoginServer: acr.outputs.loginServer
    userAssignedIdentityId: mcpIdentity.outputs.id
    targetPort: 3001
    external: false
    minReplicas: 0
    maxReplicas: 3
    cpu: '0.5'
    memory: '1Gi'
    secrets: [
      {
        name: 'mcp-api-keys'
        keyVaultUrl: '${keyVault.outputs.uri}secrets/mcp-api-keys'
      }
    ]
    secretEnvVars: [
      {
        name: 'MCP_API_KEYS_SECRET'
        secretRef: 'mcp-api-keys'
      }
    ]
    envVars: [
      {
        name: 'KEY_VAULT_URL'
        value: keyVault.outputs.uri
      }
      {
        name: 'MCP_API_KEYS_SECRET_NAME'
        value: 'mcp-api-keys'
      }
    ]
  }
}

// ───── Slice 6: web (Next.js) — fachada pública del MCP ─────

@description('Tag de la imagen del web en ACR.')
param webImageTag string = 'bootstrap'

module webIdentity './modules/web-identity.bicep' = {
  name: 'deploy-web-identity'
  params: {
    name: 'uai-web-${env}'
    location: location
    tags: commonTags
    acrName: acr.outputs.name
  }
}

module webApp './modules/container-app.bicep' = {
  name: 'deploy-web-app'
  params: {
    name: 'ca-web-${project}-${env}'
    location: location
    tags: commonTags
    environmentId: cae.outputs.id
    image: '${acr.outputs.loginServer}/web:${webImageTag}'
    acrLoginServer: acr.outputs.loginServer
    userAssignedIdentityId: webIdentity.outputs.id
    targetPort: 3000
    external: true
    minReplicas: 0
    maxReplicas: 3
    cpu: '0.5'
    memory: '1Gi'
    envVars: [
      {
        name: 'MCP_URL'
        value: 'http://${mcpApp.outputs.name}'
      }
      {
        name: 'NEXT_TELEMETRY_DISABLED'
        value: '1'
      }
    ]
  }
}

// ───── Outputs ─────

output acrLoginServer string = acr.outputs.loginServer
output acrName string = acr.outputs.name
output storageAccountName string = storage.outputs.name
output storageBlobEndpoint string = storage.outputs.blobEndpoint
output keyVaultName string = keyVault.outputs.name
output keyVaultUri string = keyVault.outputs.uri
output caeName string = cae.outputs.name
output caeDefaultDomain string = cae.outputs.defaultDomain
output mcpAppName string = mcpApp.outputs.name
output mcpAppFqdn string = mcpApp.outputs.fqdn
output mcpIdentityClientId string = mcpIdentity.outputs.clientId
output webAppName string = webApp.outputs.name
output webAppFqdn string = webApp.outputs.fqdn
output webPublicUrl string = 'https://${webApp.outputs.fqdn}'
