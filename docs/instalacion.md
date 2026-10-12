# Instalacion del servidor MCP de OFDT

Guia para usar Oracle Forms Dependency Tracker desde Claude (Claude Code o
Claude Desktop) con el servidor MCP `ofdt-mcp`.

El servidor es un cliente de la API REST `ofdt.api.v1`: no se conecta a la
base de datos. Cada instalacion usa un cliente OAuth2 que pertenece a una
empresa, y Claude solo ve los formularios y catalogos de esa empresa.

Detalle tecnico (variables, herramientas, modo HTTP, desarrollo):
[`README.md`](../README.md).

## 1. Requisitos

- Docker Desktop (macOS o Windows) o Docker Engine (Linux).
- Claude Code o Claude Desktop.
- Una cuenta de GitHub con acceso al repositorio
  `rmatamoros/OracleFormsDependencyTracker` (la imagen es privada).
- Un cliente OAuth2 de la API (paso 2).

## 2. Pedir el cliente OAuth2

Un administrador de OFDT crea el cliente como owner del esquema de OFDT, con
la empresa que le corresponde (ver `docs/api-rest.md` en
[OracleFormsDependencyTracker](https://github.com/rmatamoros/OracleFormsDependencyTracker)):

```sql
SET SERVEROUTPUT ON
DECLARE
    l_client_id     VARCHAR2(400);
    l_client_secret VARCHAR2(400);
BEGIN
    ofdt_api.create_client(
        p_client_name   => 'mcp_<usuario>',
        p_empresa_id    => <empresa_id>,
        p_support_email => '<correo>',
        p_client_id     => l_client_id,
        p_client_secret => l_client_secret
    );
    DBMS_OUTPUT.PUT_LINE('client_id     = ' || l_client_id);
    DBMS_OUTPUT.PUT_LINE('client_secret = ' || l_client_secret);
END;
/
```

El secreto se muestra una sola vez y no queda guardado en la base: entreguelo
por un canal seguro. Use un cliente por persona o equipo, para poder revocarlo
sin afectar a los demas (`EXEC ofdt_api.drop_client('mcp_<usuario>')`).

## 3. Descargar la imagen

La imagen se publica en GitHub Container Registry para `amd64` y `arm64`:

| Etiqueta | Contenido |
|---|---|
| `latest` | Ultimo release en `main` |
| `0.1.0`, `0.1` | Version fija |
| `sha-<commit>` | Un commit concreto de `main` |

Cree un token de GitHub *classic* con el permiso `read:packages`
(GitHub → Settings → Developer settings → Personal access tokens →
Tokens (classic)). Los tokens *fine-grained* no sirven para GHCR.

```bash
echo "<token>" | docker login ghcr.io -u <usuario-github> --password-stdin
docker pull ghcr.io/rmatamoros/ofdt-mcp:0.1.0
```

## 4. Archivo de configuracion

Cree una carpeta para el servidor, por ejemplo `~/ofdt-mcp`, con un archivo
`.env`:

```bash
# Raiz ORDS del esquema (produccion)
OFDT_BASE_URL=https://<host>/ords/ofdt
OFDT_CLIENT_ID=<client_id>
OFDT_CLIENT_SECRET=<client_secret>
```

- Proteja el archivo: `chmod 600 ~/ofdt-mcp/.env`. No lo suba a git ni lo
  comparta.
- Cree tambien la carpeta de archivos, por ejemplo `~/ofdt-mcp/data`. Es la
  unica carpeta desde la que Claude puede leer XML de Forms y catalogos TXT
  para cargarlos.

Compruebe que la configuracion es correcta. Debe responder `{"status":"ok"}`:

```bash
docker run -d --rm --name ofdt-mcp-check -p 127.0.0.1:3000:3000 \
  -e MCP_TRANSPORT=http --env-file ~/ofdt-mcp/.env \
  ghcr.io/rmatamoros/ofdt-mcp:0.1.0
curl http://127.0.0.1:3000/healthz
docker stop ofdt-mcp-check
```

`/healthz` solo prueba que el servidor arranca; las credenciales se validan en
el paso 6.

## 5. Registrar el servidor en Claude

Docker requiere rutas absolutas. En los ejemplos, reemplace `/Users/ana` por su
carpeta personal (`echo $HOME`; en Windows, `C:\Users\ana`).

### Claude Code

```bash
claude mcp add ofdt --scope user -- docker run -i --rm \
  --env-file /Users/ana/ofdt-mcp/.env \
  -v /Users/ana/ofdt-mcp/data:/data:ro \
  ghcr.io/rmatamoros/ofdt-mcp:0.1.0
```

`--scope user` lo deja disponible en todos sus proyectos. Verifique con:

```bash
claude mcp list
```

### Claude Desktop

Edite `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

(o desde Claude Desktop: Settings → Developer → Edit Config)

```json
{
  "mcpServers": {
    "ofdt": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "--env-file", "/Users/ana/ofdt-mcp/.env",
        "-v", "/Users/ana/ofdt-mcp/data:/data:ro",
        "ghcr.io/rmatamoros/ofdt-mcp:0.1.0"
      ]
    }
  }
}
```

En Windows use rutas como `C:\\Users\\ana\\ofdt-mcp\\.env` (con la barra
invertida doble del JSON). Reinicie Claude Desktop despues de guardar.

## 6. Probar

Pidale a Claude:

> Usa la herramienta whoami de ofdt.

Debe responder con su cliente y su empresa. Despues, por ejemplo:

- "Lista los formularios cargados en OFDT."
- "Que formularios usan la tabla PVVENDEDORES?"
- "Muestra las dependencias no encontradas de FPV4020."
- "Carga el archivo fpv4020_fmb.xml." (el archivo debe estar en
  `~/ofdt-mcp/data`)

Las herramientas `upload_module`, `validate_module`, `import_catalog_txt` y
`sync_catalog` modifican datos de su empresa; Claude pide confirmacion antes de
usarlas segun la configuracion de permisos del cliente.

## 7. Actualizar

```bash
docker pull ghcr.io/rmatamoros/ofdt-mcp:<nueva-version>
```

Cambie la etiqueta en el registro de Claude (paso 5) y reinicie Claude. Si
usa `latest`, basta con el `docker pull`.

## Problemas comunes

| Sintoma | Causa probable | Solucion |
|---|---|---|
| `docker pull` → `denied` o `unauthorized` | Sin sesion en GHCR, token sin `read:packages` o sin acceso al repo | Repetir el paso 3 con un token *classic* y pedir acceso al repositorio |
| Claude no muestra las herramientas de `ofdt` | Docker no esta corriendo o la ruta del `.env` no es absoluta | Abrir Docker Desktop; revisar las rutas; ver `claude mcp list` |
| El servidor termina con `Configuracion invalida` | Falta `OFDT_BASE_URL`, `OFDT_CLIENT_ID` u `OFDT_CLIENT_SECRET` en el `.env` | Completar el archivo del paso 4 |
| `whoami` devuelve 401 | `client_id` o `client_secret` incorrectos, o cliente revocado | Pedir un cliente nuevo (paso 2) |
| La carga dice `No existe el archivo ... en OFDT_DATA_DIR` o `queda fuera de OFDT_DATA_DIR` | El archivo no esta en la carpeta montada en `/data` | Copiarlo a `~/ofdt-mcp/data` y pedirlo por su nombre |
| Primera llamada despues de un despliegue → `ORA-04068` | El paquete `OFDT_API` se recompilo | Repetir la peticion |

## Seguridad

- El `.env` contiene el secreto de su cliente: quien lo tenga ve y modifica los
  datos de su empresa en OFDT.
- Monte `/data` como solo lectura (`:ro`) y solo con los archivos que quiere
  cargar.
- El modo HTTP (`MCP_TRANSPORT=http`) no autentica a quien se conecta: no lo
  exponga fuera de `127.0.0.1` ni de una red privada. Para Claude Code y Claude
  Desktop use el modo por defecto (`stdio`), como en esta guia.
