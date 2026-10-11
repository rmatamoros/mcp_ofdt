import { basename } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readInput } from '../fileInput.js';
import type { OrdsClient } from '../ordsClient.js';
import { runTool } from '../result.js';

type Api = Pick<OrdsClient, 'request'>;

const serverId = z.number().int().positive().describe('server_id devuelto por list_servers');
const fileArgs = {
  path: z
    .string()
    .min(1)
    .optional()
    .describe('Ruta del archivo dentro de OFDT_DATA_DIR (relativa o absoluta). Use path o content, no ambos.'),
  content: z.string().optional().describe('Contenido en linea, solo para archivos pequenos.'),
};
const writes = { readOnlyHint: false, idempotentHint: false, openWorldHint: true } as const;

export function registerActionTools(server: McpServer, api: Api, dataDir: string): void {
  server.registerTool(
    'upload_module',
    {
      title: 'Cargar formulario XML',
      description: 'Carga un formulario Oracle Forms exportado a XML, extrae su estructura y dependencias y devuelve module_id. Con overwrite=true (default) reemplaza un formulario existente con el mismo nombre de esta empresa.',
      inputSchema: {
        ...fileArgs,
        filename: z.string().min(1).optional().describe('Nombre de archivo a registrar (default: nombre del path o upload.xml)'),
        overwrite: z.boolean().optional().describe('Reemplazar si ya existe (default true)'),
      },
      annotations: { ...writes, destructiveHint: true },
    },
    ({ path, content, filename, overwrite }) =>
      runTool(async () => {
        const body = await readInput({ path, content }, dataDir);
        return api.request('POST', 'modules', {
          query: {
            filename: filename ?? (path ? basename(path) : 'upload.xml'),
            overwrite: overwrite === false ? 'N' : 'Y',
          },
          body,
          contentType: 'application/xml',
        });
      }),
  );

  server.registerTool(
    'validate_module',
    {
      title: 'Validar dependencias',
      description: 'Valida las dependencias de un formulario contra el catalogo de un servidor y devuelve cuantas se encontraron y cuantas faltan. Luego use get_module_dependencies con status=MISSING para ver el detalle.',
      inputSchema: {
        module_id: z.number().int().positive().describe('module_id devuelto por list_modules o upload_module'),
        server_id: serverId,
      },
      annotations: { ...writes, destructiveHint: false },
    },
    ({ module_id, server_id }) =>
      runTool(() => api.request('POST', `modules/${module_id}/validate`, { query: { server_id } })),
  );

  server.registerTool(
    'import_catalog_txt',
    {
      title: 'Importar catalogo TXT',
      description: 'Importa el catalogo de objetos de BD de un servidor de tipo TXT. Formato pipe-delimited con encabezado: OWNER|OBJECT_NAME|OBJECT_TYPE|STATUS|LAST_DDL_TIME.',
      inputSchema: { server_id: serverId, ...fileArgs },
      annotations: { ...writes, destructiveHint: false },
    },
    ({ server_id, path, content }) =>
      runTool(async () => {
        const body = await readInput({ path, content }, dataDir);
        return api.request('POST', `catalog/${server_id}/txt`, { body, contentType: 'text/plain' });
      }),
  );

  server.registerTool(
    'sync_catalog',
    {
      title: 'Sincronizar catalogo ORDS',
      description: 'Sincroniza el catalogo de objetos de BD desde el endpoint ORDS remoto de un servidor de tipo ORDS.',
      inputSchema: { server_id: serverId },
      annotations: { ...writes, destructiveHint: false },
    },
    ({ server_id }) => runTool(() => api.request('POST', `catalog/${server_id}/sync`)),
  );
}
