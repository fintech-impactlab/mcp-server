# Escudo Financiero — Extensión Chrome

Extensión de Chrome que detecta fraude financiero digital en Chile analizando el sitio web activo en tiempo real. Conecta directamente al MCP server (sin backend intermediario) para obtener un score 0–100 con veredicto, razones y canales de denuncia oficiales.

## Qué detecta

- **Listas negras CMF** — 4 listados oficiales: plataformas no reguladas, créditos fraudulentos, apps no reguladas, otras entidades
- **PhishTank y URLhaus** — URLs de phishing y malware confirmadas por la comunidad
- **RPSF (whitelist)** — Registro de Prestadores de Servicios Financieros bajo Ley 21.521
- **Dominio y SSL** — Edad de registro WHOIS, estado del certificado TLS, cadena de redirecciones
- **DNS / RDAP** — País del registrante, privacidad proxy
- **SII** — Estado tributario de la entidad (activo / suspendido / sin inicio)
- **Modelo de negocio** — Promesas de rentabilidad irreal, esquemas de referidos, lenguaje vago
- **Canales de denuncia** — CMF, SERNAC, CSIRT, PDI con URLs de formularios

## Inicio rápido

### 1. Cargar la extensión

```
chrome://extensions → Modo desarrollador → Cargar descomprimida
→ seleccionar la carpeta raíz de este repo
```

### 2. Configurar la API key

```
Click derecho en el ícono de escudo → Opciones
→ Completar URL del MCP server y API Key → Guardar
```

### 3. Usar

Navega a cualquier sitio financiero → haz clic en el ícono 🛡️ → **Analizar sitio**.

## Estructura del repo

```
chrome-extension/
├── manifest.json              Manifest V3: permisos, service worker, CSP
├── background/
│   └── service-worker.js      Cliente MCP JSON-RPC 2.0, orquestación, caché
├── content/
│   └── content.js             Escaneo DOM: formularios, scripts, texto visible
├── popup/
│   ├── popup.html             UI del popup (5 estados)
│   ├── popup.js               Renderizado: score, etapas MCP, canales
│   └── popup.css              Estilos dark mode
├── options/
│   ├── options.html           Página de configuración
│   └── options.js             Guarda MCP_URL y API key en chrome.storage.local
├── assets/icons/              Íconos 16 / 48 / 128 px
└── docs/
    ├── ARCHITECTURE.md        Diseño del sistema y flujo de datos
    ├── API.md                 Protocolo MCP y tool full_evaluation
    ├── CONFIGURATION.md       Variables de configuración y almacenamiento
    ├── DEVELOPMENT.md         Guía de desarrollo local y debugging
    └── DEPLOYMENT.md          Empaquetado y distribución
```

## Documentación

| Doc | Contenido |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arquitectura, flujo de datos, decisiones de diseño |
| [API.md](docs/API.md) | Protocolo MCP, tool `full_evaluation`, schema de entrada/salida |
| [CONFIGURATION.md](docs/CONFIGURATION.md) | Opciones, almacenamiento, defaults |
| [DEVELOPMENT.md](docs/DEVELOPMENT.md) | Setup local, debugging, estructura de código |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Empaquetado, distribución, actualización de API key |

## Requisitos

- Chrome 116+ (soporte ESM en service workers)
- MCP server corriendo y accesible (Azure Container Apps o local)
- API key válida generada con `pnpm dev:gen-key` en el MCP server

## Tecnología

| Capa | Tecnología |
|---|---|
| Extensión | Chrome Manifest V3, ESM nativo |
| Protocolo | MCP StreamableHTTP / JSON-RPC 2.0 |
| Auth | Bearer token (API key), sin JWT |
| Storage | `chrome.storage.local` (config + caché), `chrome.storage.session` (resultados por tab) |
| Sin bundler | El service worker importa módulos ESM directamente |
