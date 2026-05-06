# Referencia de API — MCP Server

La extensión se comunica exclusivamente con el MCP server usando el protocolo MCP sobre HTTP (StreamableHTTP transport / JSON-RPC 2.0).

## Endpoint

```
POST https://ca-mcp-fintech-dev.ambitiousstone-a9e5f771.eastus.azurecontainerapps.io/mcp
```

También disponible localmente en desarrollo:
```
POST http://localhost:3002/mcp
```

## Autenticación

Todas las requests requieren un API key en el header `Authorization`:

```
Authorization: Bearer <api-key>
```

El servidor valida la key con SHA-256 (comparación timing-safe). Las keys se generan con:

```bash
cd /ruta/al/mcp-server && pnpm dev:gen-key
```

La salida incluye `MCP_DEV_BEARER` (la key en texto plano que va en el header).

## Sesiones

El MCP server es stateful. Antes de llamar tools se debe inicializar una sesión:

```http
POST /mcp
Content-Type: application/json
Accept: application/json, text/event-stream
Authorization: Bearer <key>

{
  "jsonrpc": "2.0",
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {
      "name": "escudo-financiero",
      "version": "2.0.0"
    }
  },
  "id": 1
}
```

> **Importante:** el header `Accept: application/json, text/event-stream` es **obligatorio**. Sin él el servidor devuelve `406 Not Acceptable`.

**Respuesta:** El servidor responde con `Content-Type: text/event-stream` (SSE). El cuerpo tiene el formato:

```
event: message
data: {"result":{...},"jsonrpc":"2.0","id":1}
```

El header `mcp-session-id` contiene el ID de sesión. Incluirlo en todas las requests subsecuentes:

```
mcp-session-id: <uuid>
```

Las sesiones expiran por inactividad (30 minutos). Si el servidor devuelve error de sesión inválida, reiniciar con un nuevo `initialize`.

## Tool: `full_evaluation`

El único tool que usa la extensión. Orquestador determinístico de 5 etapas que produce un score de riesgo consolidado.

### Llamada

```http
POST /mcp
Content-Type: application/json
Accept: application/json, text/event-stream
Authorization: Bearer <key>
mcp-session-id: <session-id>

{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "full_evaluation",
    "arguments": {
      "input": "https://ejemplo-financiero.cl",
      "text": "Título y descripción de la página...",
      "situacion": "otro"
    }
  },
  "id": 2
}
```

### Parámetros de entrada

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `input` | string | Sí | URL, dominio, RUT o nombre de entidad (1–2000 chars) |
| `text` | string | No | Texto de la página para análisis de modelo de negocio (máx. 50000 chars) |
| `situacion` | string | No | Contexto del usuario (default: `"otro"`) |

**Valores válidos de `situacion`:**

| Valor | Cuándo usarlo |
|---|---|
| `transaccion_no_reconocida` | La página tiene formularios con campos de contraseña o RUT |
| `suplantacion` | El sitio imita a una entidad legítima |
| `cargo_abusivo` | Investigando cobros no autorizados |
| `oferta_inversion_sospechosa` | La oferta promete rentabilidades extraordinarias |
| `problema_credito` | Problemas con crédito o deuda |
| `brecha_datos` | Posible filtración de datos personales |
| `otro` | Caso general (default) |

La extensión deriva `situacion` automáticamente desde el DOM:
- Formulario con campo contraseña o RUT → `"transaccion_no_reconocida"`
- Sin señales → `"otro"`

### Estructura de respuesta

La respuesta es SSE (`Content-Type: text/event-stream`). El service worker extrae el JSON de la línea `data:`:

```
event: message
data: {"result":{"content":[{"type":"text","text":"{...}"}]},"jsonrpc":"2.0","id":2}
```

El campo `result.content[0].text` es un JSON serializado que contiene el resultado real del tool:

```json
{
  "totalScore": -35,
  "verdict": "riesgo_medio",
  "confianza": 80,
  "stoppedAt": null,
  "shortCircuitReason": null,
  "tipoEntidad": "fintech",
  "situacion": "otro",
  "reasons": [
    {
      "ruleId": "domain.young_lt30d",
      "weight": -25,
      "message": "Dominio registrado hace menos de 30 días (≥7)",
      "fundamento": "Dominios <30d son incompatibles con un negocio financiero establecido."
    }
  ],
  "sources": [
    {
      "name": "whois",
      "fetchedAt": "2026-05-06T12:00:00.000Z",
      "dataAvailable": true
    }
  ],
  "breakdown": [
    {
      "stage": "etapa_1",
      "toolsRun": ["check_blacklist", "check_whitelist"],
      "partialScore": 0,
      "reasons": []
    },
    {
      "stage": "etapa_2",
      "toolsRun": ["analyze_domain", "check_dns_ownership"],
      "partialScore": -25,
      "reasons": [...]
    },
    {
      "stage": "etapa_3",
      "toolsRun": ["check_regulator_status"],
      "partialScore": -10,
      "reasons": [...]
    },
    {
      "stage": "etapa_4",
      "toolsRun": ["get_applicable_regulation"],
      "partialScore": 0,
      "reasons": []
    },
    {
      "stage": "etapa_5",
      "toolsRun": ["get_official_complaint_channels"],
      "partialScore": 0,
      "reasons": []
    }
  ],
  "recomendaciones": [
    {
      "nombre": "Formulario de denuncia CMF",
      "organismo": "CMF",
      "urlFormulario": "https://www.cmfchile.cl/portal/principal/613/w3-article-805.html"
    }
  ],
  "disclaimer": "Este análisis es orientativo..."
}
```

### Campos de la respuesta

| Campo | Tipo | Descripción |
|---|---|---|
| `totalScore` | number | Score acumulado. Rango práctico: −100 a +85 |
| `verdict` | string | `alto_riesgo` / `riesgo_medio` / `sin_senales_negativas` |
| `confianza` | number | % de tools que respondieron exitosamente (0–100) |
| `stoppedAt` | string\|null | Etapa donde hubo corte temprano, o null si completó |
| `shortCircuitReason` | string\|null | Razón del corte temprano |
| `tipoEntidad` | string\|null | Tipo detectado: `banco`, `fintech`, `desconocido`, etc. |
| `situacion` | string | La situación usada para el análisis |
| `reasons[]` | array | Reglas disparadas con peso, mensaje y fundamento legal |
| `sources[]` | array | Fuentes consultadas con timestamp y disponibilidad |
| `breakdown[]` | array | Score parcial y tools ejecutadas por etapa |
| `recomendaciones[]` | array | Canales de denuncia con URLs de formularios |
| `disclaimer` | string | Aviso legal del análisis |

### Lógica de veredicto

```
totalScore ≤ −50  →  alto_riesgo
totalScore < 0    →  riesgo_medio
totalScore ≥ 0    →  sin_senales_negativas
```

### Corte temprano

`full_evaluation` puede detenerse antes de las 5 etapas si acumula señales suficientes:

- **Después de etapa 1**: Si el dominio está en una blacklist de phishing/malware confirmada
- **Después de etapa 3**: Si es una entidad regulada verificada (sin señales negativas) o fraude confirmado por regulador

Cuando hay corte temprano, `stoppedAt` indica la etapa y `shortCircuitReason` explica el motivo.

## Etapas del orquestador

| Etapa | Tools ejecutadas | Qué analiza |
|---|---|---|
| `etapa_1` | `check_blacklist`, `check_whitelist` | Listas negras CMF/PhishTank/URLhaus, RPSF |
| `etapa_2` | `analyze_domain`, `check_dns_ownership` | WHOIS, edad, SSL, redirecciones, registrante DNS |
| `etapa_3` | `verify_chilean_entity`, `check_regulator_status` | SII, estado regulatorio CMF |
| `etapa_4` | `analyze_business_model`, `get_applicable_regulation` | Texto de la página, leyes aplicables |
| `etapa_5` | `get_official_complaint_channels` | Canales de denuncia (siempre ejecuta) |

## Mapeo score MCP → UI extensión

La extensión convierte `totalScore` al rango 0–100 para mostrar en el ring:

```javascript
score = Math.round(Math.max(0, Math.min(100, (totalScore + 100) / 2)))
```

| Score (0–100) | Color | Badge | Significado |
|---|---|---|---|
| ≥ 75 | verde | ✓ | Sin señales negativas |
| 55–74 | verde pálido | ~ | Señales leves |
| 40–54 | amarillo | ! | Señales moderadas |
| 25–39 | naranja | !! | Riesgo medio |
| < 25 | rojo | ✕ | Alto riesgo |

## Health check

El MCP server expone un endpoint de salud sin autenticación:

```http
GET /health

200 OK
{ "status": "ok", "name": "fintech-mcp", "version": "0.1.0" }
```

Útil para verificar disponibilidad antes de configurar la extensión.

## Errores

| Código HTTP | Causa | Acción |
|---|---|---|
| `401` | Header `Authorization` ausente o mal formado | Verificar formato `Bearer <key>` |
| `403` | API key inválida o revocada | Generar nueva key con `pnpm dev:gen-key` |
| `404` | Endpoint incorrecto | Verificar que la URL termine en `/mcp` |
| `500` | Error interno del MCP | Revisar logs del servidor |

Errores JSON-RPC (campo `error` en el body):

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32602,
    "message": "Invalid params: input is required"
  },
  "id": 2
}
```
