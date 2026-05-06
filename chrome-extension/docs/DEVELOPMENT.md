# Guía de desarrollo

## Requisitos

- Chrome 116 o superior (soporte ESM nativo en service workers)
- MCP server corriendo (local o Azure)
- API key válida

No hay `npm install`, no hay build step, no hay bundler.

## Cargar la extensión

```
1. Abrir chrome://extensions
2. Activar "Modo desarrollador" (toggle superior derecho)
3. Click en "Cargar descomprimida"
4. Seleccionar la carpeta raíz del repo (donde está manifest.json)
```

La extensión aparece en la barra de herramientas. Si el ícono no aparece, click en el puzzle 🧩 y fijarlo.

## Configurar para desarrollo

### Con el MCP server local

```bash
cd /ruta/al/mcp-server
PORT=3002 pnpm dev:gen-key   # generar key de desarrollo
PORT=3002 pnpm dev:server    # arrancar el servidor
```

Luego en la página de opciones de la extensión:
- URL: `http://localhost:3002/mcp`
- API Key: el valor de `MCP_DEV_BEARER` que devolvió `dev:gen-key`

### Con el MCP server en Azure

- URL: `https://ca-mcp-fintech-dev.ambitiousstone-a9e5f771.eastus.azurecontainerapps.io/mcp`
- API Key: la key de Azure (ya generada)

## Estructura del código

```
background/service-worker.js
│
├── getConfig()                 Lee mcpUrl + mcpApiKey de chrome.storage.local
├── mcpPost(method, params)     Request JSON-RPC 2.0 al MCP server
├── initSession()               Handshake MCP: método "initialize"
├── callTool(name, args)        Llama un tool MCP, parsea content[0].text
│
├── getFromCache(domain)        Lookup L1 (Map) + L2 (storage.local) con TTL
├── saveToCache(domain, data)   Guarda en ambos niveles
│
├── normalizeScore(totalScore)  [-100..+100] → [0..100]
├── scoreToColor(score)         0–100 → green/green-pale/yellow/orange/red
├── verdictToTitulo(verdict)    "alto_riesgo" → "Alto riesgo detectado"
├── buildResumen(mcp)           Top 2 reasons del MCP como texto
├── buildRecomendacion(verdict) Texto de recomendación determinístico
│
└── analyzeURL(tabId, url, domain, pageData)
    ├── Detecta situacion desde pageData.forms
    ├── Construye text para business model analysis
    ├── Llama callTool('full_evaluation', ...)
    ├── Normaliza y mapea resultado
    ├── updateBadge(), saveToCache(), session.set()
    └── Si score < 20: envía SHOW_WARNING al content script

content/content.js
│
├── extractForms()              Detecta campos contraseña/RUT, action externa
├── extractExternalScripts()    Hostnames de scripts de terceros
├── extractVisibleText()        Texto visible del DOM (TreeWalker, máx 2000 chars)
├── buildPageData()             Agrega todo en un objeto
└── runAnalysis()               Envía ANALYZE_PAGE al service worker

popup/popup.js
│
├── animateScore(score)         SVG ring animation
├── renderRazones(razones)      Lista de razones del MCP
├── renderMcpDetails(mcp)       Breakdown por etapa con score parcial
├── renderRegulationContext(rc) Leyes aplicables y canales de denuncia
├── showResult/showError/showSetup/showLoading/showManual
├── startPolling(tabId)         Polling storage.session cada 500ms (timeout 25s)
└── init()                      Lee tab activo, muestra estado correcto
```

## Ciclo de desarrollo

Al modificar cualquier archivo JS:

```
1. Guardar el archivo
2. chrome://extensions → click ↺ en la tarjeta de Escudo Financiero
3. Recargar la página de prueba
```

No hay hot-reload automático. No hay watch mode.

## Debugging

### Service worker (background)

```
chrome://extensions → Escudo Financiero → Inspeccionar service worker
```

Abre DevTools para el service worker. Aquí se ven:
- `console.log` y `console.error` del service worker
- Requests HTTP al MCP (tab Network)
- Estado de `chrome.storage`

Inspeccionar el estado del storage desde la consola:

```javascript
// Config guardada
chrome.storage.local.get(['mcpUrl', 'mcpApiKey'], console.log);

// Resultado del tab activo (reemplazar 123)
chrome.storage.session.get('current:123', console.log);

// Caché de un dominio
chrome.storage.local.get('escudo:bancoestado.cl', console.log);
```

### Content script

Inspeccionar con DevTools de la página normal (F12). Los `console.log` de `content.js` aparecen en la consola de la página.

Para ver el `pageData` que envía al service worker, agregar temporalmente:
```javascript
// content.js — solo para debug
console.log('[escudo] pageData:', JSON.stringify(buildPageData(), null, 2));
```

### Popup

Click derecho sobre el popup abierto → Inspeccionar. Funciona igual que DevTools normal.

### Logs del service worker

El service worker prefija sus errores con `[escudo]`:

```javascript
// Los errores del service worker aparecen así:
[escudo] Error al analizar: MCP HTTP 403
[escudo] Error al analizar: MCP_NOT_CONFIGURED
```

## Escenarios de prueba

### Sitio sin señales negativas

```
https://www.bancoestado.cl
https://www.bci.cl
```
Esperar: score ≥ 75, badge verde ✓

### Sitio con señales de riesgo

Cualquier dominio recién registrado (< 30 días) o con SSL autofirmado generará señales.

Para simular un análisis sin visitar el sitio, desde la consola del service worker:

```javascript
// Forzar análisis de cualquier URL
analyzeURL(123, 'https://dominio-sospechoso.cl', 'dominio-sospechoso.cl', {
  title: 'Gana dinero rápido',
  metaDescription: 'Inversión segura, 50% de retorno mensual garantizado',
  forms: [{ hasPasswordField: true, hasRUTField: true, actionIsExternal: false }],
  externalScripts: [],
  visibleText: 'Gana 50% mensual sin riesgo. Únete ahora. Cupos limitados.'
});
```

### Sin MCP configurado

```javascript
// Borrar la configuración
chrome.storage.local.remove(['mcpUrl', 'mcpApiKey']);
// Luego abrir el popup → debe mostrar estado "Extensión no configurada"
```

### MCP caído o inaccesible

Apuntar la URL a un servidor que no existe y abrir el popup → debe mostrar estado "MCP no disponible".

## Modificar las reglas de scoring

Las reglas de scoring viven en el MCP server, no en la extensión:

```
/ruta/al/mcp-server/src/scoring/rules.ts
```

La extensión solo consume el resultado — no tiene lógica de scoring propia.

## Agregar un nuevo estado al popup

1. Agregar el HTML en `popup/popup.html` con `class="state hidden"`
2. Agregar la función `showNuevoEstado()` en `popup/popup.js` (oculta todos, muestra el nuevo)
3. Agregar los estilos necesarios en `popup/popup.css`
4. Llamar a `showNuevoEstado()` desde `init()` cuando corresponda

## Convenciones

- Sin TypeScript, sin build step, sin framework
- Vanilla JS (ES2022): `async/await`, `?.`, `??`, `structuredClone` si es necesario
- Un archivo por capa (content, background, popup, options)
- Errores del service worker: siempre `console.error('[escudo] ...')` con prefijo
