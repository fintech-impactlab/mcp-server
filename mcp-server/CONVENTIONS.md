# Conventions — `mcp-server`

Convenciones internas de implementación. Para el contrato externo (tools, transport), ver [SPEC.md](../SPEC.md).

---

## Authentication

Toda llamada a `POST /mcp` requiere `Authorization: Bearer <plaintext>` válido. `/health` y `GET /mcp` (que retorna 405) están excluidos.

### Formato de key

- **Plaintext:** string ≥32 bytes random URL-safe.
  ```ts
  import { randomBytes } from "node:crypto";
  const plaintext = randomBytes(32).toString("base64url");
  ```
  Genera ~43 caracteres URL-safe (`[A-Za-z0-9_-]`). Suficiente entropía para descartar brute-force práctico.

- **Hash en KV:** sha256 del plaintext, base64url, también sin padding.
  ```ts
  import { createHash } from "node:crypto";
  const keyHash = createHash("sha256").update(plaintext).digest("base64url");
  ```

- **Comparación:** `crypto.timingSafeEqual` sobre los buffers de los hashes (no sobre los plaintexts). Ver [`src/server/auth/keys.ts`](src/server/auth/keys.ts).

### Estructura del secret KV

El secret `mcp-api-keys` (en `kv-fintech-${env}-*`) es un JSON array de entries:

```json
[
  {
    "clientId": "web",
    "keyId": "k-2026-05-01",
    "keyHash": "<sha256-base64url>",
    "createdAt": "2026-05-01T00:00:00.000Z",
    "revokedAt": null
  },
  {
    "clientId": "dev",
    "keyId": "k-2026-05-01-dev",
    "keyHash": "<sha256-base64url>",
    "createdAt": "2026-05-01T00:00:00.000Z",
    "revokedAt": null
  }
]
```

Campos:

| Campo | Tipo | Descripción |
|---|---|---|
| `clientId` | string | Identificador del cliente. Convención: minúsculas, snake_case. Ej: `web`, `dev`, `extension`, `sms_bot`. |
| `keyId` | string | Identificador único de la key. Convención: `k-<YYYY-MM-DD>[-<sufijo>]`. Permite múltiples keys activas por cliente durante rotación. |
| `keyHash` | string | sha256 del plaintext, base64url sin padding. |
| `createdAt` | ISO 8601 | Timestamp UTC de creación. |
| `revokedAt` | ISO 8601 \| null | Si está seteado, la key se rechaza aunque el hash matchee. |

### Reglas duras

- **Plaintext nunca persiste** en KV, en código, en tests, en fixtures, en logs ni en mensajes de error. Solo se entrega al cliente una vez en el momento de creación (vía script `bootstrap-mcp-api-keys` o `rotate-key`).
- **Plaintext nunca se loguea**, ni siquiera hasheado con `hashInput`. Si un fallo de auth necesita correlación, se usa `hashInput(authHeaderRecibido)` (sha256:8) y `clientId` (cuando ya se sabe), pero nunca el header completo.
- **Comparación timing-safe** obligatoria. No usar `===` ni `==` sobre hashes.
- **Header excluido de logs por default.** Nunca emitir el contenido de `Authorization` aunque sea para debug. Si se necesita debuggear un fallo, capturar solo `inputHash` y `reason`.

### Modo dev local

Para correr el server sin Azure Key Vault, setear la env var `MCP_API_KEYS_LOCAL_JSON` con el mismo JSON shape que el secret KV. El `KeyStore` la usa en lugar de hacer fetch a KV.

```bash
# Generar y exportar (ver scripts/dev-gen-key.mjs)
pnpm dev:gen-key
# Output: línea con MCP_API_KEYS_LOCAL_JSON='...' y plaintext correspondiente
```

Convención: el `.env.local` está en `.gitignore`. Nunca committear plaintexts.

### Rotación

Procedimiento documentado en [`docs/KEY_ROTATION.md`](docs/KEY_ROTATION.md) (a crear en Slice A4.3). Resumen: agregar key nueva al JSON sin marcar la vieja → propagar (60s cache TTL o restart de revisión) → update env var del cliente → revocar la vieja agregando `revokedAt`.
