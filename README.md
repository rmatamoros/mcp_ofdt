# ofdt-mcp

Servidor MCP que expone a Claude la API REST de OFDT (`/ords/ofdt/api/v1/`):
consultar formularios y dependencias, analizar impacto, cargar XML de Forms,
importar o sincronizar catalogos y validar dependencias.

Es un cliente delgado de la API: no se conecta a la base de datos. La empresa
sale del cliente OAuth2 configurado; todas las herramientas ven solo sus datos.

## Herramientas

| Herramienta | Que hace | Modifica datos |
|---|---|---|
| `whoami` | Cliente y empresa del token | no |
| `list_modules` | Formularios cargados, con filtro `search` y paginacion | no |
| `get_module` | Estructura de un formulario (bloques, triggers, program units, LOVs...) | no |
| `get_module_dependencies` | Dependencias con resultado de validacion (`FOUND`, `MISSING`, `NOT_VALIDATED`) | no |
| `find_impact` | Formularios y triggers que usan un objeto de BD (`NOMBRE` u `OWNER.NOMBRE`) | no |
| `get_form_calls` | Formularios que llama y que lo llaman (un nivel) | no |
| `list_servers` | Servidores de catalogo de la empresa | no |
| `upload_module` | Carga un XML de Forms (reemplaza si `overwrite`) | si |
| `validate_module` | Valida dependencias contra un catalogo | si |
| `import_catalog_txt` | Importa un catalogo TXT pipe-delimited | si |
| `sync_catalog` | Sincroniza un catalogo desde su ORDS remoto | si |

`upload_module` e `import_catalog_txt` reciben `path` (archivo dentro de
`OFDT_DATA_DIR`, maximo 50 MB) o `content` (texto en linea).

## Configuracion

| Variable | Obligatoria | Uso |
|---|---|---|
| `OFDT_BASE_URL` | si | Raiz ORDS del esquema, p. ej. `https://<host>/ords/ofdt` |
| `OFDT_CLIENT_ID` | si | Cliente OAuth2 creado con `OFDT_API.CREATE_CLIENT` ([docs/api-rest.md](../docs/api-rest.md)) |
| `OFDT_CLIENT_SECRET` | si | Secreto del cliente |
| `MCP_TRANSPORT` | no | `stdio` (default) o `http` |
| `PORT` | no | Puerto HTTP, default `3000` |
| `HOST` | no | Interfaz de escucha HTTP: `127.0.0.1` por defecto, `0.0.0.0` en la imagen Docker |
| `MCP_ALLOWED_ORIGINS` | no | `Origin` de navegador aceptados en `/mcp`, separados por coma; por defecto ninguno (403) |
| `OFDT_DATA_DIR` | no | Unico directorio desde el que se leen archivos, default `/data` |

Copie `.env.example` a `.env` (ignorado por git) y complete los valores.

## Imagen Docker

```bash
docker build -t ofdt-mcp mcp
```

### Imagen publicada (GHCR)

El workflow `.github/workflows/mcp-image.yml` publica la imagen para
`linux/amd64` y `linux/arm64` en `ghcr.io/rmatamoros/ofdt-mcp`:

- push a `main` que toque `mcp/`: `latest` y `sha-<commit>`
- tag `mcp-vX.Y.Z`: `X.Y.Z` y `X.Y`; el tag debe coincidir con la version de
  `mcp/package.json`

En los PR solo se construye y se prueba. El paquete hereda la visibilidad del
repositorio (privado), asi que para descargarlo hace falta un token de GitHub
con `read:packages`:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u <usuario> --password-stdin
docker pull ghcr.io/rmatamoros/ofdt-mcp:latest
docker tag ghcr.io/rmatamoros/ofdt-mcp:latest ofdt-mcp
```

Con el `docker tag` los ejemplos siguientes funcionan sin cambios; tambien se
puede usar el nombre completo de la imagen en lugar de `ofdt-mcp`.

## Uso con Claude Code

```bash
claude mcp add ofdt -- docker run -i --rm --env-file /ruta/absoluta/mcp/.env -v /ruta/absoluta/xml:/data:ro ofdt-mcp
```

El volumen `/data` es la carpeta con los XML o TXT que Claude podra cargar;
use `:ro` si solo se leen.

## Uso con Claude Desktop

En `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ofdt": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "--env-file", "/ruta/absoluta/mcp/.env",
        "-v", "/ruta/absoluta/xml:/data:ro",
        "ofdt-mcp"
      ]
    }
  }
}
```

## Modo HTTP

```bash
docker run -d --name ofdt-mcp -p 127.0.0.1:3000:3000 \
  -e MCP_TRANSPORT=http --env-file mcp/.env ofdt-mcp
curl http://127.0.0.1:3000/healthz
```

Endpoint MCP: `http://127.0.0.1:3000/mcp` (Streamable HTTP, sin estado).

> `/mcp` rechaza con 403 cualquier peticion con un `Origin` que no este en
> `MCP_ALLOWED_ORIGINS` (proteccion contra DNS rebinding); los clientes MCP no
> envian `Origin`.
>
> En esta fase el modo HTTP usa la credencial fija del contenedor y **no
> autentica a quien llama**: cualquiera que alcance el puerto actua como la
> empresa del cliente OAuth2. Publiquelo solo en `127.0.0.1` o en una red
> privada. La autenticacion por usuario queda para cuando se defina el
> despliegue.

## Desarrollo

```bash
cd mcp
npm install
npm test
npm run build
```

Prueba de humo contra un ambiente real (lista herramientas, ejecuta las
consultas y carga `xml/fpv4020_fmb.xml`; **modifica datos**, usar solo en DEV):

```bash
cd mcp && set -a && . ./.env && set +a
OFDT_DATA_DIR="$PWD/../xml" node test/smoke.e2e.mjs node dist/index.js
node test/smoke.e2e.mjs docker run -i --rm --env-file .env -v "$PWD/../xml:/data:ro" ofdt-mcp
```

`scripts/docker-smoke.sh` hace todo lo anterior con la imagen: build, usuario
no root, humo por stdio y, en modo HTTP, `/healthz`, `whoami` y rechazo de
`Origin` ajeno (403).
