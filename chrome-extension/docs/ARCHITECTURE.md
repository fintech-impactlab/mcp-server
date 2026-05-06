# Arquitectura

## Visión general

La extensión conecta directamente al MCP server sin pasar por ningún backend intermediario. El MCP server es el único sistema externo: provee el análisis, el score y el contexto regulatorio en una sola llamada.

```
┌─────────────────────────────────────────────────────────┐
│                    CHROME BROWSER                        │
│                                                          │
│  ┌──────────────┐    DOM scan     ┌──────────────────┐  │
│  │ content.js   │ ─────────────→  │ service-worker   │  │
│  │ (cada página)│  ANALYZE_PAGE   │ (background)     │  │
│  └──────────────┘                 └────────┬─────────┘  │
│                                            │             │
│  ┌──────────────┐  session storage         │             │
│  │  popup.js    │ ←──────────────────────  │             │
│  │  (UI)        │   current:{tabId}        │             │
│  └──────────────┘                          │             │
│                                            │ fetch JSON-RPC 2.0
└────────────────────────────────────────────┼────────────┘
                                             │
                              ┌──────────────▼──────────────┐
                              │      MCP SERVER              │
                              │  Azure Container Apps        │
                              │                              │
                              │  POST /mcp                   │
                              │  Authorization: Bearer <key> │
                              │                              │
                              │  full_evaluation({           │
                              │    input: url,               │
                              │    text: pageText,           │
                              │    situacion: ...            │
                              │  })                          │
                              └──────────────────────────────┘
```

## Capas del sistema

### 1. content.js — Escaneo DOM en tiempo real

Corre en cada página (`document_idle`). Extrae:

- `forms[]` — acción, si es externa, si tiene campo de contraseña o RUT
- `externalScripts[]` — hostnames de scripts de terceros (máx. 20)
- `ssl.valid` — protocolo HTTPS o HTTP
- `title`, `metaDescription` — texto de la página
- `visibleText` — texto visible del DOM (máx. 2000 chars, excluye `<script>` y `<style>`)

Envía `ANALYZE_PAGE` al service worker con `{ url, domain, pageData }`.

También escucha `REQUEST_PAGE_DATA` del popup (para análisis manual) y `SHOW_WARNING` del service worker (para el overlay de peligro cuando score < 20).

### 2. service-worker.js — Orquestación y cliente MCP

**Responsabilidades:**
- Leer config (`mcpUrl`, `mcpApiKey`) desde `chrome.storage.local`
- Inicializar sesión MCP y reutilizarla durante la vida del service worker
- Llamar `full_evaluation` con los datos de la página
- Normalizar el score del MCP al rango 0–100
- Cachear resultados por dominio (TTL 1h, dos niveles: memCache + storage)
- Actualizar el badge del ícono de la extensión
- Almacenar el resultado en `chrome.storage.session` para el popup

**No hace:**
- JWT — usa la API key directamente en Bearer
- Llamadas a backends propios — el MCP es el único destino
- Parsing de HTML — eso lo hace content.js

### 3. popup.js — Interfaz de usuario

Cinco estados posibles:

| Estado | Cuándo aparece |
|---|---|
| `state-manual` | No hay análisis previo de este tab |
| `state-loading` | Análisis en curso (polling cada 500ms) |
| `state-result` | Análisis completado exitosamente |
| `state-error` | Error de red o MCP no disponible |
| `state-setup` | API key no configurada |

Renderiza:
- **Score ring** — SVG animado 0–100
- **Título y resumen** — derivados del verdict del MCP
- **Razones** — lista de `reasons[].message` del MCP
- **Detalles técnicos** — breakdown por etapa (score parcial + tools ejecutadas)
- **Marco legal** — canales de denuncia con URLs de formularios

### 4. options.js — Configuración

Formulario simple que guarda en `chrome.storage.local`:
- `mcpUrl` — URL del endpoint MCP (con la URL de Azure como default)
- `mcpApiKey` — API key en texto plano (Chrome cifra el storage local)

## Flujo de datos detallado

```
content.js                service-worker.js              MCP server
    │                           │                             │
    │─ ANALYZE_PAGE ───────────▶│                             │
    │  { url, domain,           │                             │
    │    pageData }             │                             │
    │                           │── getConfig() ──────────────│
    │                           │   (chrome.storage.local)    │
    │                           │                             │
    │                           │── POST /mcp initialize ────▶│
    │                           │◀─ mcp-session-id ───────────│
    │                           │                             │
    │                           │── POST /mcp tools/call ────▶│
    │                           │   full_evaluation({         │
    │                           │     input: url,             │
    │                           │     text: pageText,         │
    │                           │     situacion               │
    │                           │   })                        │
    │                           │◀─ { totalScore, verdict,    │
    │                           │    reasons, breakdown,      │
    │                           │    recomendaciones }        │
    │                           │                             │
    │                           │── normalizeScore() ─────────│
    │                           │   totalScore [-100..+100]   │
    │                           │   → score [0..100]          │
    │                           │                             │
    │                           │── saveToCache(domain)       │
    │                           │── session.set(current:tab)  │
    │                           │── updateBadge(tabId)        │
    │                           │                             │
popup.js                        │
    │─ storage.session.get ─────│
    │◀─ analysis ───────────────│
    │                           │
    │── renderMcpDetails()      │
    │── renderRegulationContext()│
```

## Cliente MCP (JSON-RPC 2.0)

El service worker implementa un cliente MCP mínimo sin usar el SDK de Node.js:

### Handshake inicial

```
POST {mcpUrl}
Content-Type: application/json
Accept: application/json, text/event-stream
Authorization: Bearer {mcpApiKey}

{
  "jsonrpc": "2.0",
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": { "name": "escudo-financiero", "version": "2.0.0" }
  },
  "id": 1
}

← HTTP 200, Content-Type: text/event-stream
← Response headers: mcp-session-id: <uuid>
← Body SSE:
   event: message
   data: {"result":{"protocolVersion":"2024-11-05",...},"jsonrpc":"2.0","id":1}
```

> El header `Accept` es obligatorio. Sin él el servidor devuelve `406 Not Acceptable`.
> El servidor responde siempre con `text/event-stream` — nunca con `application/json` puro.
> El service worker parsea la línea `data:` del SSE body en lugar de llamar `res.json()`.

### Llamada a tool

```
POST {mcpUrl}
Content-Type: application/json
Accept: application/json, text/event-stream
Authorization: Bearer {mcpApiKey}
mcp-session-id: <uuid>

{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "full_evaluation",
    "arguments": { "input": "...", "text": "...", "situacion": "otro" }
  },
  "id": 2
}
```

La sesión se mantiene durante la vida del service worker (se reinicia cuando Chrome termina el SW). El `mcp-session-id` se reutiliza en todas las llamadas consecutivas de la misma instancia.

## Normalización del score

El motor de scoring del MCP produce un `totalScore` en rango aproximado [-100, +100]:
- Señales negativas restan (blacklist -50, SII suspendido -30, etc.)
- Señales positivas suman (RPSF autorizada +30, SII activo +10, etc.)

La extensión normaliza a [0, 100] para la UI:

```
score = round(clamp((totalScore + 100) / 2, 0, 100))
```

Mapeo de score a color:

| Score | Color | Badge |
|---|---|---|
| ≥ 75 | verde | ✓ |
| 55–74 | verde pálido | ~ |
| 40–54 | amarillo | ! |
| 25–39 | naranja | !! |
| < 25 | rojo | ✕ |

## Caché

Dos niveles para minimizar llamadas al MCP:

| Nivel | Medio | Scope |
|---|---|---|
| L1 | `Map` en memoria | Vida del service worker |
| L2 | `chrome.storage.local` | Persistente entre reinicios |

TTL: **1 hora** por dominio. La clave es `escudo:{hostname}`.

## Detección de situación

El campo `situacion` del MCP se deriva de señales del DOM:

| Señal DOM | Valor MCP |
|---|---|
| Form con campo contraseña o RUT | `transaccion_no_reconocida` |
| Sin señales de credenciales | `otro` |

## Decisiones de diseño

**Sin backend propio** — El MCP server tiene `full_evaluation` que cubre blacklists, dominio, DNS, SII y modelo de negocio. No hay valor en agregar un backend intermediario que solo reenvíe datos.

**Sin bundler** — Chrome 116+ soporta ESM nativo en service workers. El código es vanilla JS puro, sin dependencias npm, lo que elimina un paso de build y hace el repo auditeable línea por línea.

**Sin JWT** — El MCP valida API keys directamente via SHA-256 con timing-safe comparison. La extensión usa la key en Bearer sin necesidad de intercambio de tokens.

**CORS no requerido** — Los service workers de extensiones con `host_permissions` pueden hacer fetch cross-origin sin que el servidor configure CORS. La extensión tiene `host_permissions` para el dominio Azure del MCP.

**Qué no cubre esta extensión** — Datos de reclamos SERNAC/reclamos.cl y Google Safe Browsing no están disponibles en el MCP server. La síntesis narrativa (título, resumen) se genera determinísticamente desde el verdict, no con LLM.
