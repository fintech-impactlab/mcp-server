# Configuración

## Dónde se almacena la configuración

Toda la configuración de la extensión vive en `chrome.storage.local`. Chrome cifra este storage con las credenciales del perfil del usuario — los valores no son accesibles para otras extensiones ni sitios web.

No hay archivos de configuración en el repo. No hay variables de entorno. No hay secrets comprometidos en el código.

## Valores configurables

| Clave | Descripción | Default en options.html |
|---|---|---|
| `mcpUrl` | URL completa del endpoint MCP (debe terminar en `/mcp`) | URL de Azure Container Apps |
| `mcpApiKey` | API key en texto plano para autenticación Bearer | — (vacío, debe configurarse) |

## Cómo configurar

### Opción A — Página de opciones (recomendado)

1. Click derecho en el ícono 🛡️ de la extensión
2. Seleccionar **Opciones**
3. Completar los campos y hacer clic en **Guardar configuración**

O desde la barra de extensiones:
```
chrome://extensions → Escudo Financiero → Detalles → Opciones de extensión
```

### Opción B — DevTools (para desarrollo)

Desde la consola del service worker (`chrome://extensions` → Inspeccionar service worker):

```javascript
chrome.storage.local.set({
  mcpUrl: 'https://ca-mcp-fintech-dev.ambitiousstone-a9e5f771.eastus.azurecontainerapps.io/mcp',
  mcpApiKey: 'tu-api-key-aqui'
});
```

### Opción C — Importar desde JSON (múltiples instalaciones)

Útil para instalar la extensión en varias máquinas con la misma configuración:

```javascript
// Ejecutar en consola del service worker
chrome.storage.local.set({
  mcpUrl: 'https://...',
  mcpApiKey: 'VJ1c9tCVkN-...'
});
```

## URL del MCP server

### Producción (Azure Container Apps)

```
https://ca-mcp-fintech-dev.ambitiousstone-a9e5f771.eastus.azurecontainerapps.io/mcp
```

Esta URL está pre-cargada en la página de opciones como valor por defecto.

### Desarrollo local

```
http://localhost:3002/mcp
```

Requiere agregar `http://localhost:3002/*` a `host_permissions` en `manifest.json` o usar `http://*/*` (ya incluido).

Para arrancar el MCP server en modo desarrollo:

```bash
cd /ruta/al/mcp-server
PORT=3002 pnpm dev:server
```

## Generación de API keys

Las keys se generan desde el MCP server:

```bash
cd /ruta/al/mcp-server
PORT=3002 pnpm dev:gen-key
```

La salida muestra dos valores:
- `MCP_API_KEYS_LOCAL_JSON` — hash SHA-256 (va al `.env` del servidor)
- `MCP_DEV_BEARER` — la key en texto plano (va en la extensión como `mcpApiKey`)

**La extensión usa `MCP_DEV_BEARER`, no el hash.**

## Comportamiento sin configuración

Si `mcpApiKey` no está guardada:

1. El service worker detecta que la config está vacía y lanza `MCP_NOT_CONFIGURED`
2. El badge del ícono muestra `⚙` en morado
3. El popup muestra el estado "Extensión no configurada" con un botón "Configurar ahora"
4. El botón abre la página de opciones directamente

Una vez guardada la key, el siguiente análisis funciona sin necesidad de recargar la extensión.

## Caché de análisis

Los resultados de análisis se cachean por dominio con TTL de **1 hora**:

- **L1 (memoria):** `Map` en el service worker, se limpia cuando Chrome cierra el SW
- **L2 (persistente):** `chrome.storage.local` con clave `escudo:{hostname}`

Para forzar un nuevo análisis de un dominio (saltando caché):

```javascript
// Desde la consola del service worker
chrome.storage.local.remove('escudo:ejemplo.cl');
```

Para limpiar toda la caché:

```javascript
// Lista todas las claves de caché y las elimina
chrome.storage.local.get(null, items => {
  const cacheKeys = Object.keys(items).filter(k => k.startsWith('escudo:'));
  chrome.storage.local.remove(cacheKeys);
  console.log('Cache limpiada:', cacheKeys.length, 'entradas');
});
```

## Resultados por tab

Los resultados del análisis activo se almacenan en `chrome.storage.session` (se borran al cerrar Chrome):

- Clave: `current:{tabId}` — resultado del análisis de esa pestaña
- El popup lee esta clave al abrirse
- Si no existe, muestra el estado "manual" con botón de analizar

Para inspeccionar el resultado actual de un tab:

```javascript
// Reemplazar 123 con el ID real del tab
chrome.storage.session.get('current:123', console.log);
```
