import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { OrdsClient } from '../ordsClient.js';
import { runTool } from '../result.js';

type Api = Pick<OrdsClient, 'request'>;

const DEP_TYPES = ['TABLE', 'VIEW', 'PACKAGE', 'FUNCTION', 'PROCEDURE', 'SEQUENCE', 'FORM', 'LIBRARY'] as const;

const moduleId = z.number().int().positive().describe('module_id devuelto por list_modules');
const paging = {
  limit: z.number().int().min(1).max(500).optional().describe('Filas por pagina (1-500, default 100)'),
  offset: z.number().int().min(0).optional().describe('Filas a saltar (default 0)'),
};
const readOnly = { readOnlyHint: true, openWorldHint: true } as const;

export function registerQueryTools(server: McpServer, api: Api): void {
  server.registerTool(
    'whoami',
    {
      title: 'Cliente y empresa',
      description: 'Muestra el cliente OAuth2 y la empresa con la que trabaja este servidor. Todas las demas herramientas ven solo datos de esa empresa.',
      annotations: readOnly,
    },
    () => runTool(() => api.request('GET', 'whoami')),
  );

  server.registerTool(
    'list_modules',
    {
      title: 'Listar formularios',
      description: 'Lista los formularios Oracle Forms cargados, con conteos de bloques, triggers, program units y dependencias. Use search para filtrar por nombre (sin distinguir mayusculas). Paginado: si has_more es true, pida la siguiente pagina con offset.',
      inputSchema: {
        search: z.string().min(1).optional().describe('Parte del nombre del formulario, p. ej. "fpv"'),
        ...paging,
      },
      annotations: readOnly,
    },
    ({ search, limit, offset }) =>
      runTool(() => api.request('GET', 'modules', { query: { search, limit, offset } })),
  );

  server.registerTool(
    'get_module',
    {
      title: 'Estructura de un formulario',
      description: 'Devuelve la estructura de un formulario: bloques y su fuente de datos, triggers, program units, LOVs, record groups, librerias, ventanas, canvases y alertas. No incluye codigo fuente.',
      inputSchema: { module_id: moduleId },
      annotations: readOnly,
    },
    ({ module_id }) => runTool(() => api.request('GET', `modules/${module_id}`)),
  );

  server.registerTool(
    'get_module_dependencies',
    {
      title: 'Dependencias de un formulario',
      description: 'Lista las dependencias de un formulario (tablas, vistas, paquetes, funciones, procedimientos, secuencias, formularios, librerias) con el resultado de validacion contra el catalogo. status: FOUND existe en la BD, MISSING no existe, NOT_VALIDATED aun no se valido (use validate_module).',
      inputSchema: {
        module_id: moduleId,
        type: z.enum(DEP_TYPES).optional().describe('Filtra por tipo de objeto'),
        status: z.enum(['FOUND', 'MISSING', 'NOT_VALIDATED']).optional().describe('Filtra por resultado de validacion'),
        ...paging,
      },
      annotations: readOnly,
    },
    ({ module_id, type, status, limit, offset }) =>
      runTool(() =>
        api.request('GET', `modules/${module_id}/dependencies`, {
          query: { type, status, limit, offset },
        }),
      ),
  );

  server.registerTool(
    'find_impact',
    {
      title: 'Analisis de impacto',
      description: 'Antes de modificar o borrar un objeto de base de datos, lista los formularios y triggers que lo usan. Acepta NOMBRE u OWNER.NOMBRE, sin distinguir mayusculas. summary trae el total de usos y de formularios afectados.',
      inputSchema: {
        object: z.string().trim().min(1).describe('Objeto de BD, p. ej. PKG_FACTURACION o VENTAS.PKG_FACTURACION'),
        type: z.enum(DEP_TYPES).optional().describe('Limita a un tipo de objeto'),
        ...paging,
      },
      annotations: readOnly,
    },
    ({ object, type, limit, offset }) =>
      runTool(() => api.request('GET', 'impact', { query: { object, type, limit, offset } })),
  );

  server.registerTool(
    'get_form_calls',
    {
      title: 'Llamadas entre formularios',
      description: 'Muestra a que formularios llama este (CALL_FORM, OPEN_FORM, NEW_FORM, RUN_PRODUCT) y que formularios lo llaman. Devuelve un solo nivel; para recorrer el grafo llame de nuevo con el target_module_id de una llamada saliente.',
      inputSchema: { module_id: moduleId },
      annotations: readOnly,
    },
    ({ module_id }) => runTool(() => api.request('GET', `modules/${module_id}/calls`)),
  );

  server.registerTool(
    'list_servers',
    {
      title: 'Servidores de catalogo',
      description: 'Lista los servidores de catalogo de la empresa (server_id para validate_module, import_catalog_txt y sync_catalog), su origen (ORDS o TXT), numero de objetos y fecha de la ultima sincronizacion.',
      annotations: readOnly,
    },
    () => runTool(() => api.request('GET', 'servers')),
  );
}
