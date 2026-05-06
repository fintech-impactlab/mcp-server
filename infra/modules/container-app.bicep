@description('Nombre del Container App.')
param name string

@description('Región Azure.')
param location string

@description('Tags estándar.')
param tags object

@description('ID del Managed Environment donde corre el container.')
param environmentId string

@description('Imagen completa con login server, ej. acrxxx.azurecr.io/mcp-server:tag.')
param image string

@description('Login server del ACR (acrxxx.azurecr.io). Necesario para registries[].server.')
param acrLoginServer string

@description('Resource ID de la User-Assigned Identity con permiso AcrPull sobre el ACR.')
param userAssignedIdentityId string

@description('Puerto interno donde escucha el container.')
param targetPort int

@description('Si true, ingress externo (HTTPS público); si false, ingress solo interno al CAE.')
param external bool = false

@description('Réplicas mínimas (0 = scale-to-zero).')
@minValue(0)
@maxValue(25)
param minReplicas int = 0

@description('Réplicas máximas.')
@minValue(1)
@maxValue(25)
param maxReplicas int = 3

@description('vCPU asignados por réplica.')
param cpu string = '0.5'

@description('Memoria asignada por réplica.')
param memory string = '1Gi'

@description('Variables de entorno simples (sin secretos).')
param envVars array = []

@description('Secret refs: lista de objetos { name, keyVaultUrl } que se exponen como env vars con el mismo nombre.')
param secrets array = []

@description('Mapeos secret → env var: lista de { name, secretRef } que crea env vars apuntando a secrets locales.')
param secretEnvVars array = []

@description('Volúmenes a definir a nivel de revisión, ej: [{ name, storageType, storageName }]. Vacío = sin volúmenes.')
param volumes array = []

@description('Mounts del container principal, ej: [{ volumeName, mountPath }]. Vacío = sin mounts.')
param volumeMounts array = []

var secretEnvVarsExpanded = [for sev in secretEnvVars: {
  name: sev.name
  secretRef: sev.secretRef
}]
var allEnvVars = concat(envVars, secretEnvVarsExpanded)

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${userAssignedIdentityId}': {}
    }
  }
  properties: {
    environmentId: environmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: external
        targetPort: targetPort
        transport: 'auto'
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      registries: [
        {
          server: acrLoginServer
          identity: userAssignedIdentityId
        }
      ]
      secrets: [for s in secrets: {
        name: s.name
        keyVaultUrl: s.keyVaultUrl
        identity: userAssignedIdentityId
      }]
    }
    template: {
      containers: [
        {
          name: name
          image: image
          resources: {
            cpu: json(cpu)
            memory: memory
          }
          env: allEnvVars
          volumeMounts: volumeMounts
        }
      ]
      volumes: volumes
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
    }
  }
}

output id string = containerApp.id
output name string = containerApp.name
output fqdn string = containerApp.properties.configuration.ingress.fqdn
