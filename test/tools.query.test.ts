import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/ordsClient.js';
import { registerQueryTools } from '../src/tools/query.js';
import { call, connect, fakeClient } from './helpers.js';

const QUERY_TOOLS = [
  'whoami',
  'list_modules',
  'get_module',
  'get_module_dependencies',
  'find_impact',
  'get_form_calls',
  'list_servers',
];

describe('herramientas de consulta', () => {
  it('registra las 7 herramientas como solo lectura', async () => {
    const mcp = await connect((s) => registerQueryTools(s, fakeClient()));
    const { tools } = await mcp.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual([...QUERY_TOOLS].sort());
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.description, tool.name).toBeTruthy();
    }
  });

  it('find_impact llama a GET impact con object y type', async () => {
    const client = fakeClient();
    const mcp = await connect((s) => registerQueryTools(s, client));
    const r = await call(mcp, 'find_impact', { object: 'pkg_x', type: 'PACKAGE' });

    expect(r.isError).toBeFalsy();
    expect(client.request).toHaveBeenCalledWith('GET', 'impact', {
      query: { object: 'pkg_x', type: 'PACKAGE', limit: undefined, offset: undefined },
    });
  });

  it('get_module_dependencies arma la ruta y el filtro status', async () => {
    const client = fakeClient();
    const mcp = await connect((s) => registerQueryTools(s, client));
    await call(mcp, 'get_module_dependencies', { module_id: 42, status: 'MISSING' });

    const [method, path, opts] = client.request.mock.calls[0] as [string, string, { query: Record<string, unknown> }];
    expect(method).toBe('GET');
    expect(path).toBe('modules/42/dependencies');
    expect(opts.query.status).toBe('MISSING');
  });

  it('list_modules usa search, limit y offset', async () => {
    const client = fakeClient();
    const mcp = await connect((s) => registerQueryTools(s, client));
    await call(mcp, 'list_modules', { search: 'fpv', limit: 10, offset: 20 });

    expect(client.request).toHaveBeenCalledWith('GET', 'modules', {
      query: { search: 'fpv', limit: 10, offset: 20 },
    });
  });

  it('get_module, get_form_calls, list_servers y whoami usan su ruta', async () => {
    const client = fakeClient();
    const mcp = await connect((s) => registerQueryTools(s, client));
    await call(mcp, 'get_module', { module_id: 7 });
    await call(mcp, 'get_form_calls', { module_id: 7 });
    await call(mcp, 'list_servers');
    await call(mcp, 'whoami');

    expect(client.request.mock.calls.map((c) => `${c[0]} ${c[1]}`)).toEqual([
      'GET modules/7',
      'GET modules/7/calls',
      'GET servers',
      'GET whoami',
    ]);
  });

  it('rechaza limit fuera de rango sin llamar a la API', async () => {
    const client = fakeClient();
    const mcp = await connect((s) => registerQueryTools(s, client));
    const r = await call(mcp, 'list_modules', { limit: 501 });

    expect(r.isError).toBe(true);
    expect(client.request).not.toHaveBeenCalled();
  });

  it('un ApiError de la API se devuelve como isError', async () => {
    const client = fakeClient();
    client.request.mockRejectedValueOnce(new ApiError(404, 'Modulo 9 no encontrado.', 'get_module'));
    const mcp = await connect((s) => registerQueryTools(s, client));
    const r = await call(mcp, 'get_module', { module_id: 9 });

    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe('HTTP 404 (get_module): Modulo 9 no encontrado.');
  });
});
