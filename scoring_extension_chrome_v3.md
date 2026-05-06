# Scoring Extension Chrome v3

## Instrucciones

**Simulador de scoring — Extensión Chrome**

| Concepto | Detalle |
|---|---|
| Tipo de empresa | Cada sitio se clasifica en `CMF: Sí` (debería estar regulada) o `CMF: No` (no requiere regulación financiera). Esto cambia qué reglas aplican y qué escala de niveles se usa. |
| Empresas CMF: Sí | Aplican TODAS las reglas (28). Usa la escala `CMF` en la hoja Niveles. |
| Empresas CMF: No | Aplican solo las reglas marcadas como `aplica_no_cmf = TRUE` en la hoja Reglas (señales generales: phishing, malware, SSL, dominio, SII, lenguaje vago, etc.). Usa la escala `No-CMF`. |

### Hojas del archivo

| Hoja | Propósito |
|---|---|
| 1. Reglas | Catálogo de reglas. Edita `Peso` (azul) y `Aplica a no-CMF` (azul) para ajustar qué reglas se incluyen para empresas no-CMF. |
| 2. Niveles | Dos escalas independientes (CMF y No-CMF). Edita los umbrales (azul) para cada una. |
| 3. Simulador | Compara hasta 10 sitios. Define el tipo (CMF Sí/No), marca las reglas activas y revisa score y nivel de cada uno. |
| 4. Dashboard | Vista detallada del Sitio 1 + comparativa de los 10. |

### Convenciones de color

| Color | Significado |
|---|---|
| Azul | Celdas editables (inputs). |
| Verde texto | Referencias entre hojas. |
| Gris | Regla no aplicable al tipo del sitio (no aporta al score). |
| Rojo / Verde fondo | Aportes negativos / positivos. |

### Flujo sugerido

1. En `Reglas` ajusta pesos y la columna `Aplica a no-CMF`.
2. En `Niveles` ajusta los umbrales para cada escala.
3. En `Simulador` define tipo CMF de cada sitio (fila 4) y marca reglas activas.
4. Revisa Dashboard para análisis del Sitio 1 y comparativa.

---

## Reglas

Catálogo de reglas y pesos. Edita `Peso` para probar ponderaciones. Edita `Aplica a no-CMF` para definir qué reglas se evalúan en empresas que no requieren regulación CMF. Las reglas con `FALSE` en esa columna serán ignoradas para sitios marcados como `CMF: No` en el Simulador.

| Categoría | ID Regla | Peso | Aplica a no-CMF | Descripción | Signo |
|---|---|---:|:---:|---|:---:|
| blacklist | blacklist.cmf_plataformas_no_reguladas | -70 | False | Aparece en CMF — Plataformas de Inversión No Reguladas | − |
| blacklist | blacklist.cmf_creditos_fraudulentos | -70 | False | Aparece en CMF — Créditos Fraudulentos | − |
| blacklist | blacklist.phishtank | -40 | True | URL reportada en PhishTank | − |
| blacklist | blacklist.cmf_apps_creditos_no_reguladas | -70 | False | Aparece en CMF — Apps de Créditos No Reguladas | − |
| blacklist | blacklist.cmf_otras_entidades_no_reguladas | -70 | False | Aparece en CMF — Otras Entidades No Reguladas | − |
| blacklist | blacklist.urlhaus | -30 | True | URL reportada en URLhaus | − |
| business_model | bm.promesa_rentabilidad_irreal | -30 | False | Promesas de rentabilidad incompatibles con el mercado regulado | − |
| business_model | bm.estructura_referidos | -25 | False | Modelo de ingresos basado en referidos / multinivel | − |
| business_model | bm.lenguaje_vago | -10 | True | Comunicación con lenguaje aspiracional vago, urgencia artificial | − |
| business_model | bm.ausencia_info_legal | -15 | True | Sitio sin RUT, razón social ni dirección física | − |
| dns | dns.registrant_pais_chile | 5 | True | Registrante público con país declarado CL | + |
| dns | dns.registrant_anonimo | -15 | True | Registrante WHOIS/RDAP anonimizado vía privacy proxy | − |
| domain | domain.young_lt7d | -40 | True | Dominio registrado hace menos de 7 días | − |
| domain | domain.young_lt30d | -25 | True | Dominio registrado hace menos de 30 días (≥7) | − |
| domain | domain.ssl_lets_encrypt_recent | -10 | True | Certificado SSL emitido por Let's Encrypt sobre dominio reciente | − |
| domain | domain.ssl_self_signed | -30 | True | Certificado SSL autofirmado | − |
| domain | domain.ssl_invalid | -40 | True | Certificado SSL inválido o expirado | − |
| domain | domain.ssl_missing | -40 | True | Sitio sin certificado SSL | − |
| domain | domain.too_many_redirects | -15 | True | Cadena de redirecciones >3 hops | − |
| entity | entity.sii_activo | 10 | True | Inicio de actividades vigente en el SII | + |
| entity | entity.sii_suspendido | -20 | True | Estado `suspendido` en el SII | − |
| entity | entity.sii_sin_inicio | -40 | True | Sin inicio de actividades en el SII | − |
| entity | entity.antiguedad_lt6m | -10 | True | Empresa con menos de 6 meses desde inicio de actividades | − |
| regulator | regulator.rpsf_autorizada_y_giro_consistente | 25 | False | Autorizada en RPSF con giro tributario consistente con la categoría | + |
| regulator | regulator.fintech_no_registrada | -30 | False | Operación que se presenta como fintech sin estar inscrita en RPSF | − |
| whitelist | whitelist.rpsf_autorizada | 50 | False | Entidad autorizada en RPSF (Registro de Prestadores de Servicios Financieros) | + |
| whitelist | whitelist.rpsf_en_revision | 10 | False | Solicitud presente en RPSF, en revisión por CMF | + |
| whitelist | whitelist.fintechile_miembro | 15 | False | Miembro activo de FinteChile | + |

### Total por categoría

| Categoría | Peso CMF | Peso No-CMF |
|---|---:|---:|
| blacklist | -350 | -70 |
| business_model | -80 | -25 |
| dns | -10 | -10 |
| domain | -200 | -200 |
| entity | -60 | -60 |
| regulator | -5 | 0 |
| whitelist | 75 | 0 |
| **Suma total de pesos** | **-630** | **-365** |
| Score MÍN posible (todas las negativas gatillan) | -745 | -380 |
| Score MÁX posible (todas las positivas gatillan) | 115 | 15 |

---

## Niveles

Escalas de niveles de confianza (semáforo). Hay dos escalas independientes según si la empresa debería ser regulada por la CMF. Cada escala tiene su propio rango porque el conjunto de reglas aplicables es distinto.

### Escala CMF (empresas que SÍ deben ser reguladas)

| Nivel | Etiqueta | Umbral mínimo (≥) | Color | Descripción |
|:---:|---|---:|:---:|---|
| 5 | Muy confiable | 40 | ● | Sitio con señales fuertes de legitimidad (RPSF autorizado, SII activo, etc.) |
| 4 | Confiable | 0 | ● | Sin señales negativas relevantes; señales positivas modestas o neutras |
| 3 | Neutro | -25 | ● | Algunas señales negativas menores (dominio joven, lenguaje vago, etc.) |
| 2 | Riesgoso | -50 | ● | Señales negativas significativas o entrada en alguna lista de la CMF |
| 1 | Crítico | -9999 | ● | Múltiples señales graves o combinaciones que indican fraude muy probable |

### Escala No-CMF (empresas que NO requieren regulación CMF)

| Nivel | Etiqueta | Umbral mínimo (≥) | Color | Descripción |
|:---:|---|---:|:---:|---|
| 5 | Muy confiable | 15 | ● | SII activo + DNS público chileno, sin señales negativas |
| 4 | Confiable | 5 | ● | Sin señales negativas; algunas señales positivas modestas |
| 3 | Neutro | -10 | ● | Algunas señales negativas menores (dominio joven, lenguaje vago, SSL Let's Encrypt reciente) |
| 2 | Riesgoso | -50 | ● | Señales negativas múltiples o significativas (SSL inválido, dominio muy joven, anonimización) |
| 1 | Crítico | -9999 | ● | Phishing/malware confirmado o combinación de varias señales graves |

> Nota: el nivel 1 (Crítico) absorbe todo lo que esté por debajo del umbral del nivel 2 en cada escala. Su umbral está en −9999 como sentinela.

---

## Simulador

Comparación de hasta 10 sitios. Para cada sitio se define si DEBE ser regulado por la CMF. Las reglas marcadas como `Aplica a no-CMF = FALSE` se ignoran para sitios marcados `No`. Se marca con `TRUE` las reglas activas. El nivel se calcula con la escala correspondiente.

### Cabecera de sitios

| # | URL / Sitio | ¿Debe ser regulada CMF? | Notas |
|---|---|:---:|---|
| Sitio 1 | Banchile | Sí | Banco regulado |
| Sitio 2 | Fraccional | Sí | Fintech |
| Sitio 3 | Fintech con fallas | Sí | Fintech |
| Sitio 4 | Fintech nueva | Sí | No detectada por la CMF |
| Sitio 5 | Fintech nueva - peor | Sí | No detectada por la CMF |
| Sitio 6 | Fintech en lista negra | Sí | — |
| Sitio 7 | Jumbo | No | Supermercado |
| Sitio 8 | rockford | No | E-commerce ropa |
| Sitio 9 | — | No | Restaurante con problemas |
| Sitio 10 | — | No | Ecommerce malísimo |

### Aportes por regla y sitio

Valores: `Aporte` (numérico). `0` significa que la regla no gatilló o no aplica. Solo se listan filas donde al menos un sitio tiene aporte distinto de cero.

| ID Regla | Peso | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 | S10 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| blacklist.cmf_creditos_fraudulentos | -70 | 0 | 0 | 0 | 0 | 0 | -70 | 0 | 0 | 0 | 0 |
| bm.promesa_rentabilidad_irreal | -30 | 0 | 0 | 0 | -30 | -30 | 0 | 0 | 0 | 0 | 0 |
| bm.estructura_referidos | -25 | 0 | 0 | 0 | 0 | -25 | 0 | 0 | 0 | 0 | 0 |
| bm.lenguaje_vago | -10 | 0 | 0 | 0 | 0 | -10 | 0 | 0 | 0 | 0 | 0 |
| bm.ausencia_info_legal | -15 | 0 | 0 | 0 | -15 | -15 | 0 | 0 | 0 | 0 | 0 |
| dns.registrant_pais_chile | 5 | 0 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 0 |
| dns.registrant_anonimo | -15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | -15 |
| domain.ssl_invalid | -40 | 0 | 0 | -40 | 0 | 0 | 0 | 0 | 0 | -40 | 0 |
| domain.ssl_missing | -40 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | -40 |
| entity.sii_activo | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 0 |
| entity.sii_suspendido | -20 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | -20 |
| entity.antiguedad_lt6m | -10 | 0 | 0 | 0 | -10 | -10 | 0 | 0 | 0 | 0 | 0 |
| whitelist.rpsf_autorizada | 50 | 50 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| whitelist.fintechile_miembro | 15 | 0 | 15 | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Resultados

| Métrica | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 | S10 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| SCORE TOTAL | 60 | 30 | -10 | -40 | -75 | -55 | 15 | 15 | -25 | -75 |
| NIVEL DE CONFIANZA | 5 | 4 | 3 | 2 | 1 | 1 | 5 | 5 | 2 | 1 |
| ETIQUETA | Muy confiable | Confiable | Neutro | Riesgoso | Crítico | Crítico | Muy confiable | Muy confiable | Riesgoso | Crítico |
| Reglas activas | 2 | 3 | 4 | 5 | 7 | 3 | 2 | 2 | 3 | 3 |

---

## Dashboard

Resumen del Sitio 1 + comparativa de los 10 sitios.

**URL evaluada:** Banchile  **Tipo CMF:** Sí
**SCORE TOTAL:** 60  **NIVEL DE CONFIANZA:** 5 — Muy confiable

### Aporte al score por categoría (Sitio 1)

| Categoría | Reglas activas | Aporte | Mín posible | Máx posible |
|---|---:|---:|---:|---:|
| blacklist | 0 | 0 | -350 | 0 |
| business_model | 0 | 0 | -80 | 0 |
| dns | 0 | 0 | -15 | 5 |
| domain | 0 | 0 | -200 | 0 |
| entity | 1 | 10 | -70 | 10 |
| regulator | 0 | 0 | -30 | 25 |
| whitelist | 1 | 50 | 0 | 75 |
| **TOTAL** | **2** | **60** | **-745** | **115** |

### Comparativa de los 10 sitios

| Sitio | URL | CMF | Score | Nivel | Etiqueta |
|---|---|:---:|---:|:---:|---|
| Sitio 1 | Banchile | Sí | 60 | 5 | Muy confiable |
| Sitio 2 | Fraccional | Sí | 30 | 4 | Confiable |
| Sitio 3 | Fintech con fallas | Sí | -10 | 3 | Neutro |
| Sitio 4 | Fintech nueva | Sí | -40 | 2 | Riesgoso |
| Sitio 5 | Fintech nueva - peor | Sí | -75 | 1 | Crítico |
| Sitio 6 | Fintech en lista negra | Sí | -55 | 1 | Crítico |
| Sitio 7 | Jumbo | No | 15 | 5 | Muy confiable |
| Sitio 8 | rockford | No | 15 | 5 | Muy confiable |
| Sitio 9 | — | No | -25 | 2 | Riesgoso |
| Sitio 10 | — | No | -75 | 1 | Crítico |
