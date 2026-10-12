# Servidor MCP para OFDT - Plan de implementacion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exponer a Claude, via un servidor MCP en Docker, las 5 acciones de la API ORDS `ofdt.api.v1` y 6 endpoints GET nuevos de consulta e impacto.

**Architecture:** Backend: procedimientos nuevos en `OFDT_API` + handlers GET en el modulo ORDS (archivos `runOnChange` de v1.4) + changeset v1.5 de indices. MCP: proyecto TypeScript en `mcp/` que actua como cliente OAuth2 `client_credentials` de la API y registra 11 herramientas; transporte `stdio` o Streamable HTTP.

**Tech Stack:** PL/SQL, ORDS, Liquibase (SQLcl `lb`), Node 22, TypeScript, `@modelcontextprotocol/sdk`, `zod`, `vitest`, Docker.

**Spec:** `docs/superpowers/specs/2026-10-11-mcp-server-design.md`

## Global Constraints

- Rama: `feat/mcp-server`. Commits en espanol con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No editar changesets XML ya ejecutados; los `.sql` referenciados por changesets `runOnChange="true"` (v1.4-002, v1.4-003) si se editan.
- Despliegue y pruebas de backend solo contra DEV (conexion SQLcl de DEV; `set define off` antes de `lb update`). Nunca usar `E2E_TESTER`.
- La empresa siempre sale de `resolve_empresa(p_client)`; ningun endpoint la recibe por parametro. Recurso de otra empresa => `404`.
- Errores JSON `{"error","status","message"}` via `handle_error(<accion>, p_status)`.
- Paginacion: `limit` default 100, maximo 500; `offset` default 0; respuesta `{"items":[...],"limit":n,"offset":n,"has_more":bool}`. `limit` fuera de 1..500 u `offset` < 0 => `400`.
- `GET servers` nunca devuelve `ords_base_url`, `credential_static_id` ni `auth_type`.
- MCP: Node 22, `node:22-alpine`, usuario no root. En `stdio` ningun log a `stdout`. Nunca registrar `OFDT_CLIENT_SECRET` ni el token.
- `upload_module`/`import_catalog_txt`: exactamente uno de `path` o `content`; `path` resuelto (incluye symlinks) debe quedar dentro de `OFDT_DATA_DIR` (default `/data`); maximo 50 MB.
- Timeout HTTP 120 s; token cacheado hasta 60 s antes de `expires_in`; ante `401` renovar una vez y reintentar.
- Si se recompila `OFDT_API`, la primera llamada puede dar `500` con `ORA-04068`; repetir.

## Review Focus

1. `find_impact` con nombre en minusculas o calificado (`ventas.pkg_facturacion`) debe encontrar los usos igual que `PKG_FACTURACION` -> test en Task 3.
2. Modulo/servidor de otra empresa en B, C, E debe dar `404`, no datos vacios con `200` -> test en Task 2 y 3.
3. `path` con `../` o symlink que sale de `/data` debe rechazarse antes de leer el archivo -> test en Task 6.
4. Token expirado a mitad de sesion (ORDS responde `401`) debe recuperarse sin error visible para Claude -> test en Task 5.
5. Respuesta de error no-JSON de ORDS (HTML de 502/503) debe dar un mensaje legible con el codigo HTTP, no un fallo de `JSON.parse` -> test en Task 5.

---

### Task 1: Changeset v1.5 de indices

**Files:**
- Create: `liquibase/changelogs/v1.5/001_api_query_indexes.xml`
- Modify: `liquibase/changelog-master.xml` (include tras v1.4)

**Interfaces:**
- Produces: indices `ix_ofdt_deps_name_type` (`UPPER(dep_name), dep_type`) e `ix_ofdt_deps_module` (`module_id`) sobre `ofdt_dependencies`.

- [ ] **Step 1:** Verificar en DEV que no existan: `SELECT index_name, column_expression FROM user_ind_columns JOIN user_ind_expressions USING (index_name) ...` o simplemente `SELECT index_name FROM user_ind_columns WHERE table_name='OFDT_DEPENDENCIES'`. Si ya hay un indice que cubra `module_id`, omitir ese changeset.
- [ ] **Step 2:** Escribir el changelog con un changeset por indice, cada uno con `<preConditions onFail="MARK_RAN"><not><indexExists indexName="..."/></not></preConditions>` y `<rollback>DROP INDEX ...</rollback>`. Comentario en espanol en el master: `<!-- V1.5: Indices para consultas de la API -->`.
- [ ] **Step 3:** `lb update` en DEV. Esperado: 2 changesets ejecutados (o MARK_RAN), sin errores. Repetir `lb update`: 0 pendientes.
- [ ] **Step 4:** Commit `feat(db): indices para consultas de dependencias e impacto`.

### Task 2: OFDT_API - list_modules, get_module, list_servers

**Files:**
- Modify: `liquibase/sql/packages/ofdt_api_spec.sql`, `liquibase/sql/packages/ofdt_api_body.sql`
- Create: `sql/10_api_query_checks.sql` (script de verificacion manual; agregar a `sql/README.md`)

**Interfaces:**
- Consumes: helpers privados existentes `resolve_empresa`, `get_module_id`, `to_id`, `write_json`, `handle_error`.
- Produces (spec publica):
  - `PROCEDURE list_modules(p_client IN VARCHAR2, p_q IN VARCHAR2, p_limit IN VARCHAR2, p_offset IN VARCHAR2, p_status OUT NUMBER)`
  - `PROCEDURE get_module(p_client IN VARCHAR2, p_module_id IN VARCHAR2, p_status OUT NUMBER)`
  - `PROCEDURE list_servers(p_client IN VARCHAR2, p_status OUT NUMBER)`
  - Helper privado nuevo `PROCEDURE read_paging(p_limit IN VARCHAR2, p_offset IN VARCHAR2, o_limit OUT PLS_INTEGER, o_offset OUT PLS_INTEGER)` que aplica defaults y lanza `c_err_bad_request` fuera de rango; reutilizado en Task 3.

- [ ] **Step 1: Escribir el script de verificacion** `sql/10_api_query_checks.sql`: para cada procedimiento, inicializa OWA (`owa.init_cgi_env`, `htp.init`), lo llama con el `client_name` de un cliente de empresa 1 pasado como sustitucion `&client`, imprime `p_status` y el buffer (`owa.get_page`) con `DBMS_OUTPUT`. Casos:
  - `list_modules(q=>'fpv', limit=>'1')` => `200`, 1 item, `has_more` coherente con el total.
  - `list_modules(limit=>'501')` => `400`.
  - `get_module(<module_id de empresa 1>)` => `200` con claves `blocks`, `triggers`, `program_units`, `lovs`, `record_groups`, `libraries`, `windows`, `canvases`, `alerts`.
  - `get_module(<module_id de otra empresa>)` => `404`; `get_module('abc')` => `400`.
  - `list_servers` => `200` y el texto **no** contiene `ords_base_url`, `credential_static_id`, `auth_type`.
- [ ] **Step 2:** Ejecutar el script en DEV. Esperado: falla con `PLS-00302` (procedimientos no existen).
- [ ] **Step 3: Implementar.** JSON con `JSON_OBJECT`/`JSON_ARRAYAGG ... RETURNING CLOB`, igual que `whoami`. Paginacion con `OFFSET :o ROWS FETCH NEXT :l + 1 ROWS ONLY`; si llegan `l+1` filas, `has_more = true` y se descarta la ultima. `list_modules` une `ofdt_modules` (filtro `empresa_id`, `UPPER(module_name) LIKE '%'||UPPER(p_q)||'%'`, orden `module_name`) con los conteos de `ofdt_v_module_summary` por `module_name`. `get_module` usa `get_module_id` (da el 404) y subconsultas `JSON_ARRAYAGG` por tabla de detalle, solo nombres y atributos clave (bloques: `block_name`, `query_datasource`, `dml_data_target`; triggers: `trigger_name`, `trigger_scope`; program units: `unit_name`, `unit_type`), sin codigo fuente. `list_servers`: `server_id`, `server_name`, `catalog_source`, `is_active`, `last_sync_date`, `object_count` (`COUNT` de `ofdt_db_objects`), filtrando `empresa_id`. Nombres de accion para `handle_error`: `list_modules`, `get_module`, `list_servers`.
- [ ] **Step 4:** `lb update` en DEV (repetir el script si sale `ORA-04068`). Esperado: todos los casos del Step 1 con el status indicado.
- [ ] **Step 5:** Commit `feat(api): consultas de modulos y servidores en OFDT_API`.

### Task 3: OFDT_API - dependencias, impacto y llamadas entre formularios

**Files:**
- Modify: `liquibase/sql/packages/ofdt_api_spec.sql`, `liquibase/sql/packages/ofdt_api_body.sql`, `sql/10_api_query_checks.sql`

**Interfaces:**
- Consumes: `read_paging` (Task 2), `get_module_id`, `resolve_empresa`.
- Produces:
  - `PROCEDURE get_module_dependencies(p_client IN VARCHAR2, p_module_id IN VARCHAR2, p_type IN VARCHAR2, p_dep_status IN VARCHAR2, p_limit IN VARCHAR2, p_offset IN VARCHAR2, p_status OUT NUMBER)`
  - `PROCEDURE get_impact(p_client IN VARCHAR2, p_object IN VARCHAR2, p_type IN VARCHAR2, p_limit IN VARCHAR2, p_offset IN VARCHAR2, p_status OUT NUMBER)`
  - `PROCEDURE get_module_calls(p_client IN VARCHAR2, p_module_id IN VARCHAR2, p_status OUT NUMBER)`

- [ ] **Step 1: Agregar casos al script:**
  - `get_module_dependencies(<id>, p_dep_status=>'MISSING')` => `200`, toda fila con `db_exists = "N"`. `p_dep_status=>'X'` => `400`. `<id otra empresa>` => `404`.
  - `get_impact(p_object=>'<tabla usada por FPV4020 en minusculas>')` y la misma en mayusculas => mismo `summary.total_uses` > 0. Con `'<esquema>.<tabla>'` en minusculas => `200` con usos. `p_object=>NULL` => `400`.
  - `get_impact` nunca devuelve modulos de otra empresa (verificar con un objeto usado por ambas si existe en DEV; si no, documentarlo en el script como caso pendiente de datos).
  - `get_module_calls(<id>)` => `200` con `outgoing` e `incoming` (arreglos, posiblemente vacios).
- [ ] **Step 2:** Ejecutar en DEV. Esperado: `PLS-00302`.
- [ ] **Step 3: Implementar.** C: `ofdt_v_validated_deps` filtrada por `module_id` (ya validado por `get_module_id`), `dep_type = UPPER(p_type)` si viene, y `status` mapeado `FOUND`->`db_exists='Y'`, `MISSING`->`'N'`, `NOT_VALIDATED`->`IS NULL`; orden `dep_type, dep_name`. D: si `p_object` contiene `.`, separar `schema`/`name` con `REGEXP_SUBSTR`; filtro `UPPER(d.dep_name) = UPPER(name)` (usa el indice de Task 1) y, si hay esquema, `(d.dep_schema IS NULL OR UPPER(d.dep_schema) = UPPER(schema))`; join a `ofdt_modules` con `empresa_id`; `summary` = `total_uses` y `module_count` calculados sobre todo el resultado, no solo la pagina. E: `outgoing` = deps `dep_type='FORM'` del modulo, con `LEFT JOIN ofdt_modules` misma empresa por `UPPER(module_name)=UPPER(dep_name)` para `target_module_id`; `incoming` = modulos de la empresa con dep `FORM` cuyo `UPPER(dep_name)` = nombre del modulo, `DISTINCT` por modulo con lista de `source_name`. Acciones: `get_module_dependencies`, `get_impact`, `get_module_calls`.
- [ ] **Step 4:** `lb update` en DEV y script. Esperado: todos los casos pasan.
- [ ] **Step 5:** Commit `feat(api): dependencias, impacto y llamadas entre formularios`.

### Task 4: Handlers ORDS GET y documentacion de la API

**Files:**
- Modify: `liquibase/sql/ords/ofdt_api_v1.sql`, `docs/api-rest.md`

**Interfaces:**
- Consumes: los 6 procedimientos de Tasks 2-3.
- Produces (rutas bajo `/ords/ofdt/api/v1/`): `GET modules`, `GET modules/:module_id`, `GET modules/:module_id/dependencies`, `GET impact`, `GET modules/:module_id/calls`, `GET servers`. Query params ORDS: `search`, `limit`, `offset`, `type`, `status`, `object`.

- [ ] **Step 1: Prueba que falla.** Con un cliente OAuth2 de prueba de DEV (crear con `ofdt_api.create_client` si no existe uno; guardar credenciales en `mcp/.env`, nunca en el repo), `curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/impact?object=x"`. Esperado: `404` o `405` (handler inexistente).
- [ ] **Step 2: Implementar.** `GET` sobre el template `modules` existente (no redefinir el template); templates nuevos `modules/:module_id`, `modules/:module_id/dependencies`, `impact`, `modules/:module_id/calls`, `servers`, cada uno con `ORDS.DEFINE_HANDLER(p_method=>'GET', p_source_type=>ORDS.source_type_plsql)` que solo enlaza binds y `:status_code`, siguiendo el estilo de los existentes. El bind del filtro de estado en C se llama `:status` en la URL y se pasa a `p_dep_status`. Agregar los patrones nuevos a `l_patterns` del privilegio si el privilegio se define por patron.
- [ ] **Step 3:** `lb update` en DEV. Verificar con `curl`: los 6 endpoints `200`; sin token `401`; `GET modules/<id otra empresa>` `404`; `GET modules?limit=501` `400`.
- [ ] **Step 4:** Documentar en `docs/api-rest.md`: filas nuevas en la tabla de endpoints, seccion de paginacion y mapeo de `status`, y un ejemplo `curl` de `impact`.
- [ ] **Step 5:** Commit `feat(api): endpoints GET de consulta en ofdt.api.v1`.

### Task 5: Proyecto MCP - configuracion y cliente ORDS

**Files:**
- Create: `mcp/package.json`, `mcp/tsconfig.json`, `mcp/.gitignore` (`node_modules`, `dist`, `.env`), `mcp/.env.example`, `mcp/src/config.ts`, `mcp/src/ordsClient.ts`
- Test: `mcp/test/config.test.ts`, `mcp/test/ordsClient.test.ts`

**Interfaces:**
- Produces:
  - `config.ts`: `interface Config { baseUrl: string; clientId: string; clientSecret: string; transport: 'stdio' | 'http'; port: number; dataDir: string }`, `function loadConfig(env: NodeJS.ProcessEnv): Config` (lanza `Error` que nombra las variables faltantes, sin valores). `baseUrl` sin `/` final.
  - `ordsClient.ts`: `class ApiError extends Error { status: number; action?: string }`; `class OrdsClient { constructor(cfg: Pick<Config,'baseUrl'|'clientId'|'clientSecret'>, fetchImpl?: typeof fetch, now?: () => number); request<T = unknown>(method: 'GET'|'POST', path: string, opts?: { query?: Record<string, string|number|undefined>; body?: Buffer|string; contentType?: string }): Promise<T> }`. `path` relativo a `${baseUrl}/api/v1/`; token en `${baseUrl}/oauth/token`. Parametros `undefined` se omiten del query string.
- `package.json`: `"type": "module"`, scripts `build` (`tsc`), `test` (`vitest run`), `start` (`node dist/index.js`); deps `@modelcontextprotocol/sdk`, `zod`; devDeps `typescript`, `vitest`, `@types/node`. `engines.node >= 22`.

- [ ] **Step 1: Tests que fallan.**
  - `loadConfig({})` lanza un error que menciona `OFDT_BASE_URL`, `OFDT_CLIENT_ID`, `OFDT_CLIENT_SECRET`; `loadConfig` con las tres => `transport 'stdio'`, `port 3000`, `dataDir '/data'`; `MCP_TRANSPORT=ftp` lanza.
  - `ordsClient`: dos `request` seguidos piden el token **una** vez; con `now` avanzado a `expires_in - 59 s` lo vuelve a pedir; el token se pide con `Authorization: Basic base64(id:secret)` y body `grant_type=client_credentials`.
  - Respuesta `401` seguida de `200` => resuelve con el `200` y se pidieron 2 tokens; dos `401` seguidos => `ApiError` status `401`.
  - Respuesta `409` con `{"error":"load_xml","status":409,"message":"El modulo X pertenece a otra empresa."}` => `ApiError` con `status 409`, `action 'load_xml'`, `message` igual.
  - Respuesta `502` con cuerpo HTML => `ApiError` status `502` y mensaje que contiene `502` (sin lanzar `SyntaxError`).
  - `request('GET','modules',{query:{search:'fpv',limit:undefined}})` llama a `.../api/v1/modules?search=fpv`.
  - Ningun mensaje de error contiene el secreto (`expect(String(err)).not.toContain('s3cret')`).
- [ ] **Step 2:** `cd mcp && npm install && npm test`. Esperado: FAIL (modulos no existen).
- [ ] **Step 3: Implementar** con `fetch` nativo y `AbortSignal.timeout(120_000)`; `config` validado con `zod`.
- [ ] **Step 4:** `npm test` => PASS; `npm run build` sin errores.
- [ ] **Step 5:** Commit `feat(mcp): configuracion y cliente OAuth2 de la API ORDS`.

### Task 6: Resultados de herramientas y entrada de archivos

**Files:**
- Create: `mcp/src/result.ts`, `mcp/src/fileInput.ts`
- Test: `mcp/test/result.test.ts`, `mcp/test/fileInput.test.ts`

**Interfaces:**
- Consumes: `ApiError` (Task 5).
- Produces:
  - `result.ts`: `function ok(data: unknown): CallToolResult` (`content: [{type:'text', text: JSON.stringify(data, null, 2)}]`, `structuredContent: data` cuando es objeto); `function fail(err: unknown): CallToolResult` (`isError: true`; para `ApiError` el texto es exactamente `HTTP ${status} (${action}): ${message}`, o `HTTP ${status}: ${message}` sin accion; otros errores `Error: ${message}`). `async function runTool(fn: () => Promise<unknown>): Promise<CallToolResult>` envuelve con `ok`/`fail`.
  - `fileInput.ts`: `const MAX_FILE_BYTES = 50 * 1024 * 1024`; `async function readInput(args: { path?: string; content?: string }, dataDir: string): Promise<Buffer>`.

- [ ] **Step 1: Tests que fallan** (usar un directorio temporal como `dataDir`):
  - `fail(new ApiError(...409, 'load_xml'...))` => texto `HTTP 409 (load_xml): El modulo X pertenece a otra empresa.` e `isError: true`.
  - `readInput({path:'a.xml'}, dir)` lee `dir/a.xml`; tambien acepta ruta absoluta dentro de `dir`.
  - `readInput({path:'../fuera.xml'}, dir)` y un symlink dentro de `dir` que apunta fuera => rechazados con mensaje que menciona `OFDT_DATA_DIR`, sin leer el archivo.
  - Ambos o ninguno de `path`/`content` => error `Indique exactamente uno de path o content.`
  - Archivo de `MAX_FILE_BYTES + 1` => error que menciona `50 MB` (crear con `truncate`, no escribir 50 MB).
  - Archivo inexistente => error que nombra la ruta relativa.
- [ ] **Step 2:** `npm test` => FAIL.
- [ ] **Step 3: Implementar** con `fs.realpath` sobre `dataDir` y sobre el archivo, comprobando que el resultado empiece por `realDataDir + path.sep`; `fs.stat` para el tamano antes de leer.
- [ ] **Step 4:** `npm test` => PASS.
- [ ] **Step 5:** Commit `feat(mcp): resultados de herramientas y lectura segura de archivos`.

### Task 7: Herramientas de consulta

**Files:**
- Create: `mcp/src/tools/query.ts`
- Test: `mcp/test/tools.query.test.ts`

**Interfaces:**
- Consumes: `OrdsClient.request`, `runTool`.
- Produces: `function registerQueryTools(server: McpServer, client: Pick<OrdsClient,'request'>): void`, que registra con `annotations: { readOnlyHint: true }`:

| Herramienta | Input (zod) | Llamada |
|---|---|---|
| `whoami` | `{}` | `GET whoami` |
| `list_modules` | `search?: string, limit?: int 1-500, offset?: int >= 0` | `GET modules` |
| `get_module` | `module_id: int` | `GET modules/{id}` |
| `get_module_dependencies` | `module_id: int, type?: enum TABLE,VIEW,PACKAGE,FUNCTION,PROCEDURE,SEQUENCE,FORM,LIBRARY, status?: enum FOUND,MISSING,NOT_VALIDATED, limit?, offset?` | `GET modules/{id}/dependencies` |
| `find_impact` | `object: string min 1, type?: (mismo enum), limit?, offset?` | `GET impact` |
| `get_form_calls` | `module_id: int` | `GET modules/{id}/calls` |
| `list_servers` | `{}` | `GET servers` |

  Descripciones en espanol orientadas a cuando usar la herramienta; `find_impact`: "Antes de modificar o borrar un objeto de base de datos, lista los formularios y triggers que lo usan. Acepta NOMBRE u OWNER.NOMBRE." `get_form_calls`: indica que devuelve un nivel y que se puede llamar de nuevo con `target_module_id` para recorrer el grafo.

- [ ] **Step 1: Tests que fallan.** Con un `client` simulado (`vi.fn`) y el servidor MCP conectado a un `Client` del SDK por `InMemoryTransport.createLinkedPair()`:
  - `listTools` devuelve exactamente los 7 nombres, todos con `readOnlyHint: true`.
  - `find_impact {object:'pkg_x', type:'PACKAGE'}` => `request('GET','impact',{query:{object:'pkg_x',type:'PACKAGE',limit:undefined,offset:undefined}})`.
  - `get_module_dependencies {module_id:42, status:'MISSING'}` => ruta `modules/42/dependencies` y `query.status 'MISSING'`.
  - `list_modules {limit:501}` => error de validacion, `request` no llamado.
  - `client.request` rechaza con `ApiError 404` => resultado `isError` con texto `HTTP 404 ...`.
- [ ] **Step 2:** `npm test` => FAIL.
- [ ] **Step 3: Implementar** con `server.registerTool(name, { title, description, inputSchema, annotations }, handler)`.
- [ ] **Step 4:** `npm test` => PASS.
- [ ] **Step 5:** Commit `feat(mcp): herramientas de consulta e impacto`.

### Task 8: Herramientas de accion

**Files:**
- Create: `mcp/src/tools/actions.ts`
- Test: `mcp/test/tools.actions.test.ts`

**Interfaces:**
- Consumes: `OrdsClient.request`, `runTool`, `readInput`.
- Produces: `function registerActionTools(server: McpServer, client: Pick<OrdsClient,'request'>, dataDir: string): void`, con `annotations: { readOnlyHint: false, destructiveHint: <ver tabla>, idempotentHint: false }`:

| Herramienta | Input | Llamada | `destructiveHint` |
|---|---|---|---|
| `upload_module` | `path?`, `content?`, `filename?: string`, `overwrite?: boolean` (default true) | `POST modules?filename=&overwrite=Y\|N`, `application/xml` | true |
| `validate_module` | `module_id: int, server_id: int` | `POST modules/{id}/validate?server_id=` | false |
| `import_catalog_txt` | `server_id: int`, `path?`, `content?` | `POST catalog/{id}/txt`, `text/plain` | false |
| `sync_catalog` | `server_id: int` | `POST catalog/{id}/sync` | false |

  `filename` por defecto: `basename(path)` si hay `path`; si no, `upload.xml`.

- [ ] **Step 1: Tests que fallan** (dataDir temporal con `f.xml`):
  - `upload_module {path:'f.xml'}` => `request('POST','modules',{query:{filename:'f.xml',overwrite:'Y'}, body:<Buffer con el contenido>, contentType:'application/xml'})`.
  - `upload_module {content:'<x/>', overwrite:false}` => `filename 'upload.xml'`, `overwrite 'N'`.
  - `upload_module {path:'../etc/passwd'}` => `isError`, `request` no llamado.
  - `import_catalog_txt {server_id:1, content:'OWNER|...'}` => ruta `catalog/1/txt`, `contentType 'text/plain'`.
  - Las 4 herramientas tienen `readOnlyHint: false`; solo `upload_module` tiene `destructiveHint: true`.
- [ ] **Step 2:** `npm test` => FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm test` => PASS.
- [ ] **Step 5:** Commit `feat(mcp): herramientas de carga, validacion y catalogo`.

### Task 9: Arranque, transportes, Docker y documentacion

**Files:**
- Create: `mcp/src/server.ts`, `mcp/src/index.ts`, `mcp/Dockerfile`, `mcp/.dockerignore`, `mcp/README.md`
- Test: `mcp/test/http.test.ts`
- Modify: `README.md` (seccion corta "Servidor MCP" con enlace a `mcp/README.md`), `CLAUDE.md` (agregar `mcp/` a "Estructura relevante")

**Interfaces:**
- Consumes: `loadConfig`, `OrdsClient`, `registerQueryTools`, `registerActionTools`.
- Produces: `function createServer(cfg: Config, client?: Pick<OrdsClient,'request'>): McpServer` (nombre `ofdt-mcp`, version de `package.json`); `function createHttpApp(cfg: Config, client?): import('node:http').Server` que sirve Streamable HTTP en `POST/GET/DELETE /mcp` y `GET /healthz` => `200 {"status":"ok"}`. `index.ts` elige `StdioServerTransport` o `createHttpApp(...).listen(cfg.port)` segun `cfg.transport`; ante error de configuracion escribe a `stderr` y sale con codigo 1.

- [ ] **Step 1: Test que falla** `http.test.ts`: levanta `createHttpApp` en puerto 0 con un `client` simulado; `GET /healthz` => 200; un `Client` del SDK con `StreamableHTTPClientTransport` hacia `/mcp` lista 11 herramientas.
- [ ] **Step 2:** `npm test` => FAIL.
- [ ] **Step 3: Implementar** con `http` nativo (sin Express) y `StreamableHTTPServerTransport` en modo sin estado (`sessionIdGenerator: undefined`), un servidor por request. Escuchar en `0.0.0.0` dentro del contenedor.
- [ ] **Step 4:** `npm test` => PASS (toda la suite).
- [ ] **Step 5: Dockerfile** multi-stage: `build` (`npm ci`, `npm run build`), final `node:22-alpine` con `npm ci --omit=dev`, `dist/`, `USER node`, `ENV OFDT_DATA_DIR=/data`, `VOLUME /data`, `EXPOSE 3000`, `ENTRYPOINT ["node","dist/index.js"]`. `.dockerignore`: `node_modules`, `dist`, `.env`, `test`.
- [ ] **Step 6: Humo del contenedor contra DEV.**
  - `docker build -t ofdt-mcp mcp` => ok; `docker image ls ofdt-mcp` < 150 MB.
  - `npx @modelcontextprotocol/inspector --cli docker run -i --rm --env-file mcp/.env -v "$PWD/xml:/data:ro" ofdt-mcp --method tools/list` => 11 herramientas.
  - Con el inspector CLI (`--method tools/call --tool-name ...`): `whoami` => empresa 1; `list_modules`; `find_impact` con una tabla usada por FPV4020 => usos > 0; `upload_module {path:'fpv4020_fmb.xml'}` => `module_id`.
  - Modo HTTP: `docker run -d -p 127.0.0.1:3000:3000 -e MCP_TRANSPORT=http --env-file mcp/.env ofdt-mcp`; `curl localhost:3000/healthz` => `{"status":"ok"}`; detener el contenedor.
- [ ] **Step 7: `mcp/README.md`**: variables (tabla de la spec), build, uso `stdio` y `http`, registro en Claude Code:

  ```bash
  claude mcp add ofdt -- docker run -i --rm --env-file /ruta/absoluta/mcp/.env -v /ruta/absoluta/xml:/data:ro ofdt-mcp
  ```

  y el bloque equivalente para `claude_desktop_config.json`; lista de herramientas; advertencia de que el modo HTTP de fase 1 usa una credencial fija y no debe exponerse a internet.
- [ ] **Step 8:** Commit `feat(mcp): transportes stdio/http, imagen Docker y documentacion`.
