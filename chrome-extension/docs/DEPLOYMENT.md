# Despliegue y distribución

## Opciones de distribución

| Método | Para quién | Complejidad |
|---|---|---|
| Carga descomprimida | Desarrollo / uso interno | Mínima |
| Archivo ZIP | Distribución manual entre usuarios conocidos | Baja |
| Chrome Web Store | Distribución pública | Alta (requiere cuenta de desarrollador) |
| Group Policy (empresa) | Despliegue corporativo | Media |

## Carga descomprimida (desarrollo / interno)

El método más simple. No requiere empaquetar ni publicar.

```
chrome://extensions → Modo desarrollador → Cargar descomprimida
→ seleccionar carpeta raíz del repo
```

**Limitación:** Requiere que el modo desarrollador esté activado en Chrome. Muestra un banner amarillo de advertencia al iniciar Chrome.

**Actualizar:** Cada vez que se modifiquen archivos, click en ↺ en `chrome://extensions`.

## Empaquetado como ZIP

Para distribuir entre usuarios sin publicar en el Web Store:

```bash
cd /Users/dage/projects
zip -r escudo-financiero-extension.zip chrome-extension/ \
  --exclude "chrome-extension/.git/*" \
  --exclude "chrome-extension/.gitignore" \
  --exclude "chrome-extension/docs/*"
```

El destinatario:
1. Descomprime el ZIP
2. Carga en `chrome://extensions → Cargar descomprimida`
3. Configura URL y API key en la página de opciones

## Empaquetado como .crx (distribución fuera del Web Store)

```
chrome://extensions → Empaquetar extensión
→ Directorio raíz: /ruta/al/chrome-extension
→ Archivo de clave privada: (dejar vacío para generar nueva clave)
→ Empaquetar extensión
```

Chrome genera dos archivos:
- `chrome-extension.crx` — la extensión empaquetada
- `chrome-extension.pem` — la clave privada (guardar en lugar seguro para actualizaciones futuras)

**Nota:** Chrome 73+ bloquea la instalación de .crx que no vengan del Web Store. Para instalar: arrastrar el .crx a `chrome://extensions` con el modo desarrollador activo.

## Publicación en Chrome Web Store

### Prerrequisitos

1. Cuenta de desarrollador en [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   - Tarifa única: USD 5
2. El MCP server debe ser accesible públicamente (URL no localhost)
3. La API key no debe estar embebida en el código (ya cumplido — va en options)

### Preparación

Revisar `manifest.json` antes de publicar:

```json
{
  "version": "2.0.0",          // incrementar en cada release
  "description": "...",        // max 132 caracteres
}
```

Crear ZIP para subir (sin archivos de desarrollo):

```bash
cd /Users/dage/projects/chrome-extension
zip -r ../escudo-financiero-v2.0.0.zip . \
  --exclude ".git/*" \
  --exclude ".gitignore" \
  --exclude "docs/*"
```

### Publicar

1. Ir al Developer Dashboard
2. Crear nuevo item → subir el ZIP
3. Completar la ficha: descripción, capturas de pantalla, categoría ("Productividad")
4. Enviar para revisión (proceso: 1–7 días hábiles)

### Actualizaciones

1. Incrementar `version` en `manifest.json`
2. Generar nuevo ZIP
3. En el Dashboard: subir nueva versión → publicar
4. Chrome actualiza automáticamente las instalaciones existentes

## Actualizar la API key en producción

La API key no está en el código — la configura cada usuario en la página de opciones. Para distribuir una nueva key:

**Opción 1 (manual):** Comunicar la nueva key a los usuarios. Ellos la actualizan en Opciones.

**Opción 2 (script centralizado):** Si los usuarios están en un entorno corporativo con acceso a DevTools, ejecutar via consola del service worker:

```javascript
chrome.storage.local.set({ mcpApiKey: 'nueva-key-aqui' });
```

**Opción 3 (página de opciones con fetch):** Se puede extender `options.js` para obtener la key desde un endpoint interno autenticado, eliminando la necesidad de distribución manual.

## Variables a cambiar entre entornos

| Variable | Dev | Producción |
|---|---|---|
| `mcpUrl` | `http://localhost:3002/mcp` | URL de Azure Container Apps |
| `mcpApiKey` | Key generada con `dev:gen-key` | Key de producción |
| `manifest.json → version` | `2.0.0-dev` | `2.0.0` |
| `host_permissions` | Incluye `http://localhost:3002/*` | Solo URLs de producción |

Para un entorno de producción estricto, se puede quitar `http://localhost:*` de `host_permissions` en `manifest.json`.

## Verificar instalación

Después de instalar y configurar, verificar:

```
1. Navegar a https://www.bancoestado.cl
2. Click en el ícono 🛡️ → "Analizar sitio"
3. Esperar ≤ 10 segundos
4. El popup debe mostrar un resultado con score y veredicto (amarillo o verde)
```

> El score exacto varía según los datos en tiempo real del MCP (WHOIS, SSL, texto de la página).
> Un resultado sin error de red confirma que la integración funciona correctamente.

Si aparece "MCP no disponible":
- Verificar que el MCP server esté accesible: `curl https://<mcp-url>/health`
- Verificar que la URL en opciones no tenga trailing slash incorrecto
- Verificar que la API key sea válida (probar con curl)

```bash
# El header Accept es obligatorio — sin él el servidor devuelve 406
curl -X POST https://<mcp-url>/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer <api-key>" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}'
```

Una respuesta `200` con una línea `data:` que contiene `"protocolVersion"` confirma que la key es válida.

## Seguridad en producción

- La API key se almacena en `chrome.storage.local`, cifrado por Chrome con las credenciales del perfil
- El código fuente no contiene ningún secret
- La CSP de la extensión (`script-src 'self'`) previene inyección de scripts externos
- Las llamadas al MCP van siempre por HTTPS en producción
- El `host_permissions` limita los dominios a los que el service worker puede hacer fetch
