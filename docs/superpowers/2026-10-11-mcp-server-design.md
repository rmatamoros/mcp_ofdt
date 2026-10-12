# Servidor MCP para la API REST de OFDT

Fecha: 2026-10-11
Estado: borrador para revision

## Objetivo

Usar desde Claude (Claude Code, Claude Desktop y, mas adelante, conector
remoto) las funciones principales de OFDT: cargar formularios, importar y
sincronizar catalogos, validar dependencias y, sobre todo, **consultar
dependencias y analizar impacto** ("que formularios se rompen si cambio
`PKG_FACTURACION`").

El servidor MCP es un cliente delgado de la API ORDS `ofdt.api.v1`. No se
conecta a la base de datos. La empresa siempre sale del token OAuth2.

## Decisiones acordadas

| Tema | Decision |
|---|---|
| Alcance | 5 endpoints de accion existentes + 6 endpoints GET nuevos de consulta (A-F) |
| Usuarios | Fase 1: un usuario local con credencial fija. Codigo listo para HTTP remoto despues |
| Transporte | `stdio` y Streamable HTTP en el mismo binario, elegido por `MCP_TRANSPORT` |
| Stack | TypeScript + `@modelcontextprotocol/sdk` + `zod`, Node 22 |
| Empaquetado | Imagen Docker multi-stage `node:22-alpine` |
| Despliegue final | Fuera de alcance; se decide despues (OCI Container Instances, Cloud Run, etc.) |

## Arquitectura

```
Claude --MCP (stdio | HTTP)--> ofdt-mcp (Docker) --HTTPS + Bearer--> ORDS /ords/ofdt/api/v1 --> OFDT_API (PL/SQL)
```

Dos piezas, en este orden:

1. **Backend (Liquibase):** nuevos endpoints GET en el modulo ORDS y su logica
   en `OFDT_API`.
2. **Servidor MCP (`mcp/`):** expone los 11 endpoints como herramientas.

## Parte 1 - Endpoints GET de consulta

Todos usan el mismo privilegio `ofdt.api.v1` (rol `OFDT_API_CLIENT`), resuelven
la empresa con el mecanismo actual de `OFDT_API` y devuelven `404` si el
recurso es de otra empresa. Respuestas JSON escritas con `APEX_JSON`/HTP como
los handlers existentes; errores con el mismo formato
`{"error","status","message"}`.

Listas paginadas: `limit` (default 100, maximo 500) y `offset` (default 0).
Toda lista responde `{"items":[...],"limit":n,"offset":n,"has_more":bool}`.

| Id | Metodo y ruta | Parametros | Respuesta (`items` o objeto) |
|---|---|---|---|
| A | `GET modules` | `search` (filtro `LIKE` sin mayusculas sobre `module_name`; `q` esta reservado por ORDS), `limit`, `offset` | `module_id`, `module_name`, `filename`, `loaded_date`, y conteos de `OFDT_V_MODULE_SUMMARY` (`block_count`, `trigger_count`, `program_unit_count`, `lov_count`, `library_count`, `table_dep_count`, `code_dep_count`, `form_dep_count`) |
| B | `GET modules/{module_id}` | - | Cabecera del modulo + arreglos `blocks` (nombre, fuente de datos), `triggers` (nombre, nivel, owner), `program_units` (nombre, tipo), `lovs`, `record_groups`, `libraries`, `windows`, `canvases`, `alerts`. Solo nombres y atributos clave, sin codigo fuente |
| C | `GET modules/{module_id}/dependencies` | `type` (TABLE, VIEW, PACKAGE, ...), `status` (`FOUND`, `MISSING`, `NOT_VALIDATED`), `limit`, `offset` | Filas de `OFDT_V_VALIDATED_DEPS`: `dep_type`, `dep_name`, `detected_schema`, `dep_operation`, `source_type`, `source_name`, `confidence`, `db_exists`, `db_obj_status`, `db_obj_owner`, `db_server_name`, `db_validated_at` |
| D | `GET impact` | `object` (obligatorio, nombre exacto sin mayusculas; acepta `OWNER.NOMBRE`), `type` (opcional), `limit`, `offset` | Por cada uso: `module_id`, `module_name`, `source_type`, `source_name`, `dep_type`, `dep_operation`, `confidence`. Tambien `summary`: total de usos y de modulos distintos |
| E | `GET modules/{module_id}/calls` | - | `outgoing`: formularios que llama este modulo (`dep_type = 'FORM'`), con `module_id` si el destino esta cargado en la empresa. `incoming`: modulos de la empresa que llaman a este. Un solo nivel (Claude puede recorrer el grafo llamando varias veces) |
| F | `GET servers` | - | `server_id`, `server_name`, `catalog_source`, `is_active`, `last_sync_date` y numero de objetos en `OFDT_DB_OBJECTS`. Nunca expone URL, credenciales ni `credential_static_id` |

Mapeo de `status` en C: `FOUND` = `db_exists = 'Y'`, `MISSING` =
`db_exists = 'N'`, `NOT_VALIDATED` = `db_exists IS NULL`.

En D, `object` con punto se divide en esquema y nombre; el esquema filtra por
`dep_schema` solo cuando la dependencia lo tiene detectado.

### Archivos

- `liquibase/sql/packages/ofdt_api_spec.sql` y `ofdt_api_body.sql`: nuevos
  procedimientos `list_modules`, `get_module`, `get_module_dependencies`,
  `get_impact`, `get_module_calls`, `list_servers`, con la misma firma de los
  existentes (`p_client`, parametros, `p_status OUT`). Los changesets v1.4 son
  `runOnChange`, asi que se redespliegan al cambiar el archivo.
- `liquibase/sql/ords/ofdt_api_v1.sql`: 6 templates/handlers GET nuevos (el
  script es idempotente y `runOnChange`). `modules` ya existe como template;
  se le agrega el handler GET.
- `liquibase/changelogs/v1.5/001_api_query_indexes.xml` (nuevo): indice
  `ix_ofdt_deps_name_type ON ofdt_dependencies(UPPER(dep_name), dep_type)` para
  el analisis de impacto, y `ofdt_dependencies(module_id)` si no existe. Con
  `preConditions` para no fallar si ya existen.
- `docs/api-rest.md`: documentar los endpoints nuevos.

## Parte 2 - Servidor MCP

### Estructura

```
mcp/
|-- src/
|   |-- index.ts          # arranque: lee config, elige transporte
|   |-- config.ts         # variables de entorno validadas con zod
|   |-- ordsClient.ts     # token OAuth2 + fetch con reintento
|   |-- result.ts         # convierte respuestas/errores a CallToolResult
|   `-- tools/
|       |-- query.ts      # A-F + whoami
|       `-- actions.ts    # upload, validate, import_txt, sync
|-- test/                 # vitest
|-- Dockerfile
|-- package.json
|-- tsconfig.json
`-- README.md
```

### Configuracion (variables de entorno)

| Variable | Obligatoria | Uso |
|---|---|---|
| `OFDT_BASE_URL` | si | p. ej. `https://<host>/ords/ofdt` (el token esta en `/oauth/token`, la API en `/api/v1/`) |
| `OFDT_CLIENT_ID` | si | cliente OAuth2 creado con `OFDT_API.CREATE_CLIENT` |
| `OFDT_CLIENT_SECRET` | si | secreto del cliente |
| `MCP_TRANSPORT` | no | `stdio` (default) o `http` |
| `PORT` | no | puerto HTTP, default `3000` |
| `OFDT_DATA_DIR` | no | directorio permitido para leer archivos, default `/data` |

Los secretos nunca se registran en logs. En modo `stdio` todo log va a
`stderr`.

### Cliente ORDS

- Pide el token con `client_credentials` (Basic auth) y lo guarda en memoria
  hasta 60 s antes de `expires_in`.
- Ante `401`, renueva el token una vez y repite la llamada.
- Timeout de 120 s por llamada (las cargas de XML grandes tardan).
- Respuesta no-2xx: intenta leer el JSON de error de la API; si no es JSON, usa
  el texto y el codigo HTTP.

### Herramientas

| Herramienta | Endpoint | `readOnlyHint` |
|---|---|---|
| `whoami` | `GET whoami` | true |
| `list_modules` | A | true |
| `get_module` | B | true |
| `get_module_dependencies` | C | true |
| `find_impact` | D | true |
| `get_form_calls` | E | true |
| `list_servers` | F | true |
| `upload_module` | `POST modules` | false |
| `validate_module` | `POST modules/{id}/validate` | false |
| `import_catalog_txt` | `POST catalog/{id}/txt` | false |
| `sync_catalog` | `POST catalog/{id}/sync` | false |

Cada herramienta tiene una descripcion en espanol orientada a cuando usarla
(p. ej. `find_impact`: "Antes de modificar o borrar un objeto de base de datos,
lista los formularios y triggers que lo usan").

`upload_module` e `import_catalog_txt` aceptan **uno** de:

- `path`: ruta de archivo dentro de `OFDT_DATA_DIR` (se rechaza cualquier ruta
  que salga de ese directorio tras resolver `..` y enlaces simbolicos).
- `content`: el texto en linea, para archivos pequenos.

Tamano maximo de archivo: 50 MB.

### Resultados y errores

- Exito: `content` con el JSON de la API formateado como texto, mas
  `structuredContent` con el mismo objeto.
- Error de la API: `isError: true` y un mensaje como
  `HTTP 409 (load_xml): El modulo FPV4020 pertenece a otra empresa.`
- Error de configuracion o de red: `isError: true` con la causa, sin el
  secreto.

### Docker

- Multi-stage: etapa `build` compila TypeScript; etapa final `node:22-alpine`
  con solo `dist/` y dependencias de produccion, usuario no root.
- `stdio`: `docker run -i --rm --env-file mcp/.env -v "$PWD/xml:/data:ro" ofdt-mcp`.
- `http`: `docker run -p 3000:3000 -e MCP_TRANSPORT=http ...`, endpoint `/mcp`.
- `mcp/.env.example` con las variables; `mcp/.env` en `.gitignore`.
- Registro en Claude Code con `claude mcp add` (documentado en `mcp/README.md`).

### Modo HTTP en fase 1

Usa la misma credencial fija del contenedor, asi que **no debe exponerse a
internet**: solo `localhost` o una red privada. La autenticacion por usuario
(cada cliente con su propio token OAuth2) queda para cuando se decida el
despliegue.

## Pruebas

- **Unitarias (vitest):** `ordsClient` con `fetch` simulado (cache del token,
  renovacion ante `401`, mapeo de errores), validacion de `path` fuera de
  `OFDT_DATA_DIR`, y que cada herramienta arme bien metodo, ruta y query.
- **Backend:** con SQLcl contra DEV, llamar cada endpoint GET
  con `curl` y un cliente de prueba de empresa 1; comprobar `404` con un
  `module_id` de otra empresa y paginacion con `has_more`.
- **Humo del contenedor:** `npx @modelcontextprotocol/inspector` contra la
  imagen en `stdio`; listar herramientas, ejecutar `whoami`, `list_modules`,
  `find_impact` y un `upload_module` con `xml/fpv4020_fmb.xml`.

## Fuera de alcance

- Autenticacion por usuario y despliegue remoto.
- Herramientas de administracion (alta de clientes, empresas, servidores).
- Devolver codigo fuente de triggers o program units.
- Recorrido recursivo del grafo de llamadas en el servidor.
