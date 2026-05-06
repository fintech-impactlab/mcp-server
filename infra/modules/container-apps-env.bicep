@description('Nombre del Container Apps Environment.')
param name string

@description('Región Azure.')
param location string

@description('Tags estándar.')
param tags object

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

output id string = cae.id
output name string = cae.name
output defaultDomain string = cae.properties.defaultDomain
output staticIp string = cae.properties.staticIp
