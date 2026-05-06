# Cómo conectar al MCP de Cruce Chile

Guía para clientes externos (Claude Code, Cursor, agentes custom, LLMs vía SDK) que necesitan consumir las tools del MCP. Para detalles internos de infraestructura (Bicep, Key Vault, logs), ver [docs/CONNECTION.md](docs/CONNECTION.md).

---

> ⚠️ **Disclaimer — credenciales**
>
> Este MCP exige un **Bearer token**. La emisión y rotación son privadas y están restringidas al equipo de plataforma. **No intentes generar, deducir ni recuperar el token por tu cuenta.** Para obtener una credencial, contactá al equipo responsable del MCP (canal interno `#fintech-mcp` o al owner de la plataforma) e indicá:
>
> - nombre del cliente / app que se va a conectar,
> - propósito de uso (test, integración, agente productivo),
> - persona responsable.
>
> El equipo te entregará: `MCP_FQDN` (URL del servicio) y `BEARER` (token plaintext, vida útil hasta próxima rotación). Si el token deja de funcionar o sospechás compromiso, pedí rotación — no consumas el secreto desde Azure ni lo persistas fuera de tu vault.

---

## ¿Qué expone este MCP?

Servidor MCP en Azure Container Apps con tools determinísticas (sin LLM) para evaluar contrapartes financieras chilenas: dominio, blacklist CMF/PhishTank/URLhaus, whitelist RPSF, SII, modelo de negocio, scoring agregado.

Tools registradas hoy ([mcp-server/src/index.ts](mcp-server/src/index.ts)):

| Tool | Para qué sirve |
|---|---|
| `get_market_reference_rates` | TPM, UF, USD/CLP, EUR/CLP (BCE) |
| `explain_law_simple` | Explica leyes chilenas (BCN Ley Fácil) |
| `check_blacklist` | CMF — Plataformas/Créditos/Apps no reguladas, PhishTank, URLhaus |
| `check_whitelist` | RPSF (Ley 21.521) + FinteChile |
| `analyze_domain` | Edad de dominio, SSL, redirects |
| `check_dns_ownership` | WHOIS / RDAP del registrante |
| `verify_chilean_entity` | SII (inicio de actividades, estado) |
| `check_regulator_status` | Tipo de entidad + estado RPSF + giro |
| `analyze_business_model` | Promesas irreales, MLM, lenguaje vago, ausencia de info legal |
| `get_applicable_regulation` | Leyes/normas aplicables por categoría |
| `get_official_complaint_channels` | Canales oficiales de denuncia |
| `full_evaluation` | Orquestador: corre las anteriores y devuelve score + razones |

## Datos de conexión

| Campo | Valor |
|---|---|
| URL | `https://<MCP_FQDN>/mcp` *(provisto por el equipo)* |
| Método | `POST` |
| Auth | `Authorization: Bearer <BEARER>` *(provisto por el equipo)* |
| Content-Type | `application/json` |
| Accept | `application/json, text/event-stream` |
| Transport | Streamable HTTP (MCP) |
| Protocol version | `2024-11-05` (negociada en `initialize`) |
| Sesión | **Stateful**: el server devuelve `Mcp-Session-Id` en la respuesta de `initialize`; el cliente debe repetirlo en POSTs subsiguientes |

## Paso 1 — Conseguir credenciales

Pedile al equipo (ver disclaimer arriba):

```bash
export MCP_FQDN="<lo-que-te-pase-el-equipo>"
export BEARER="<token-plaintext>"
```

No commits, no logs, no Slack. Almacená el token en el secret manager de tu aplicación.

## Paso 2 — Verificar alcance de red

`/health` es público (sin auth). Si esto falla, el problema es de red, no de credenciales.

```bash
curl -sS "https://$MCP_FQDN/health"
# → {"status":"ok","name":"fintech-mcp","version":"0.1.0"}
```

## Paso 3 — Conectar tu cliente

Elegí el flujo según el cliente que uses.

### 3a. Claude Code (CLI)

```bash
claude mcp add --transport http fintech-mcp \
  "https://$MCP_FQDN/mcp" \
  --header "Authorization: Bearer $BEARER"
```

Verificación: `claude mcp list` muestra `fintech-mcp`; dentro de Claude Code, `/mcp` lista las tools.

### 3b. Cursor / Claude Desktop / clientes MCP con archivo de config

Agregá una entrada en el archivo `mcp.json` (o el equivalente del cliente):

```json
{
  "mcpServers": {
    "fintech-mcp": {
      "transport": "http",
      "url": "https://<MCP_FQDN>/mcp",
      "headers": {
        "Authorization": "Bearer <BEARER>"
      }
    }
  }
}
```

Reiniciá el cliente y las tools aparecen disponibles.

### 3c. Cliente programático (SDK MCP / agente custom / LLM externo)

**Node.js con `@modelcontextprotocol/sdk`** — el SDK maneja `initialize`, `notifications/initialized` y el header `Mcp-Session-Id` por vos:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(
  new URL(`https://${process.env.MCP_FQDN}/mcp`),
  {
    requestInit: {
      headers: { Authorization: `Bearer ${process.env.BEARER}` },
    },
  },
);

const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log(tools.tools.map((t) => t.name));

const result = await client.callTool({
  name: "get_market_reference_rates",
  arguments: {},
});
console.log(result);

await client.close();
```

**curl puro** — útil para debugging o lenguajes sin SDK MCP. Tres POSTs y un DELETE; el flow completo está en [docs/CONNECTION.md §7](docs/CONNECTION.md). Resumen:

1. `POST /mcp` con método `initialize` → guardar el header de respuesta `Mcp-Session-Id`.
2. `POST /mcp` con método `notifications/initialized` (sin `id`, reusando el `Mcp-Session-Id`).
3. `POST /mcp` con cualquier método (`tools/list`, `tools/call`, …) reusando el `Mcp-Session-Id`.
4. `DELETE /mcp` con el `Mcp-Session-Id` para cerrar limpio (opcional pero recomendado; el server evicta a los 30 min de inactividad).

> **LLMs externos / agentes custom**: la integración estándar es el SDK MCP de tu lenguaje (Python: `mcp`, TypeScript: `@modelcontextprotocol/sdk`). El LLM no llama HTTP directo — invoca tools mediante el cliente MCP, que se encarga del transporte.

## Paso 4 — Listar tools disponibles

Una vez conectado, `tools/list` devuelve la lista con su JSON-Schema de input/output. En Claude Code: `/mcp`. En SDK: `client.listTools()`. Las descripciones y argumentos esperados vienen en la respuesta — no necesitás documentación adicional para llamarlas.

## Paso 5 — Llamar una tool

Ejemplo mínimo invocando `full_evaluation` (el orquestador que aplica todo el motor de scoring):

```ts
const result = await client.callTool({
  name: "full_evaluation",
  arguments: {
    input: "ejemplo.cl",
    text: "Texto opcional (landing/copy/oferta) para análisis del modelo de negocio",
    situacion: "oferta_inversion_sospechosa",
  },
});
```

La respuesta incluye `totalScore`, `verdict`, `breakdown[]` (etapa por etapa) y un campo top-level **`legalReferences[]`** con las normas exactas que sustentan el resultado:

```jsonc
{
  "totalScore": 30,
  "verdict": "sin_senales_negativas",
  "legalReferences": [
    {
      "id": "CMF-NCG-514-2024",
      "kind": "ncg",
      "titulo": "NCG 514/2024 — Sistema de Finanzas Abiertas (SFA) e inscripción en RPSF/PSBI/PSIP",
      "autoridad": "CMF",
      "vigenciaDesde": "2024-07-03",
      "urlOficial": "https://www.cmfchile.cl/normativa/ncg_514_2024.pdf",
      "localPath": "data/normativas/ncg_514_2024.md",
      "citas": [/* todas las citas del catálogo */],
      "citasInvocadas": [
        {
          "articulo": "Sección I.C.1 — Inscripción voluntaria de Prestadores de Servicios Basados en Información (PSBI)",
          "texto": "Conforme señala el inciso primero del artículo 19 de la Ley Fintec",
          "ubicacion": {
            "localPath": "data/normativas/ncg_514_2024.md",
            "lineaInicio": 318,
            "lineaFin": 318
          }
        }
      ]
    },
    { "id": "CL-LEY-21521-art-5", "...": "..." }
  ]
}
```

**El texto verbatim de cada cita está anclado a un archivo del repo** (`data/normativas/<archivo>.md`). El consumidor puede:
- Mostrar `cita.texto` tal cual (es texto verificable, no generado por LLM).
- Verificar abriendo el archivo en `cita.ubicacion.localPath` líneas `lineaInicio..lineaFin`.
- Pedir más contexto leyendo el `.md` directamente (en este repo) o el `urlOficial` (BCN, CMF, SII).

Modelo de scoring detallado: [SCORING.md](SCORING.md). Catálogo de fuentes y formato de citas: [docs/adr/ADR-002-legal-references-catalog.md](docs/adr/ADR-002-legal-references-catalog.md).

### `Reason.kind` — info reasons vs señales

Cada `Reason` lleva un `kind`:

- `"signal"` (default si está ausente) — corresponde a una regla del motor con `weight ≠ 0`. Suma o resta al `score`.
- `"info"` — `weight: 0`, no afecta el score. Se emite cuando una fuente respondió OK pero ninguna regla matcheó. Sirve para que el output no quede mudo cuando todo es "no se halló nada negativo".

```jsonc
// Ejemplo: check_blacklist sin hits, todas las fuentes OK
{
  "score": 0,
  "reasons": [
    {
      "ruleId": "info.check_blacklist.cmf_alertas_no_match",
      "kind": "info",
      "weight": 0,
      "message": "Sin coincidencias en CMF Alertas Ciudadanas",
      "fundamento": "Se consultaron los 4 listados oficiales. El input no figura en ninguno."
    },
    { "ruleId": "info.check_blacklist.phishtank_no_match", "kind": "info", "weight": 0, "...": "..." }
  ],
  "sources": [/* dataAvailable: true en las 3 */]
}
```

Para una UI compacta, filtrá `reasons.filter(r => r.kind !== "info")` y mostrá las info reasons en una sección colapsable de "qué se verificó". Para auditoría/LLM downstream, conservalas todas — son evidencia de cobertura.

**Confianza basada en sources.** El campo `confianza` del orquestador se calcula como `round((sources.filter(s => s.dataAvailable).length / sources.length) * 100)`. No mide éxito de los handlers, mide qué proporción de las fuentes externas respondió OK.

## Errores comunes

| Síntoma | Causa | Acción |
|---|---|---|
| `401 Authentication required` | Header `Authorization` ausente o vacío | Verificá que `BEARER` esté seteado y se esté enviando |
| `403 Invalid or revoked key` | Token rotado o revocado | Pedí al equipo un token nuevo |
| `-32601 Method not found` en curl | Llamaste un método antes del handshake `initialize` | Hacé `initialize` + `notifications/initialized` primero (los SDKs lo hacen solos) |
| `tools/list` devuelve `[]` | Boot del server falló al registrar tools | Avisar al equipo |
| Timeout / ECONNREFUSED | URL incorrecta o cliente sin salida a internet | Reverificar `MCP_FQDN` con el equipo y probar `/health` |

Tabla completa de troubleshooting (incluye operativos internos): [docs/CONNECTION.md §10](docs/CONNECTION.md).

## Soporte y rotación

- **Token comprometido o filtrado** → pedí rotación inmediata al equipo. No re-uses el token aunque parezca seguir funcionando.
- **Cambio de FQDN** → el equipo lo comunica; actualizá la config del cliente.
- **Cuotas / rate limits** → no hay rate limit declarado al borde hoy, pero respetá tiempos razonables (1 req/s mínimo a `full_evaluation` que internamente consulta múltiples fuentes externas).
- **Tools nuevas** → aparecen automáticamente en `tools/list`; no necesitás reconectar.
