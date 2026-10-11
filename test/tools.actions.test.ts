import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerActionTools } from '../src/tools/actions.js';
import { call, connect, fakeClient } from './helpers.js';

let dataDir: string;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'ofdt-actions-'));
  await writeFile(join(dataDir, 'f.xml'), '<FormModule Name="F"/>');
});

async function setup() {
  const client = fakeClient();
  const mcp = await connect((s) => registerActionTools(s, client, dataDir));
  return { client, mcp };
}

describe('herramientas de accion', () => {
  it('upload_module con path envia el archivo como XML', async () => {
    const { client, mcp } = await setup();
    const r = await call(mcp, 'upload_module', { path: 'f.xml' });

    expect(r.isError).toBeFalsy();
    const [method, path, opts] = client.request.mock.calls[0] as [string, string, Record<string, any>];
    expect([method, path]).toEqual(['POST', 'modules']);
    expect(opts.query).toEqual({ filename: 'f.xml', overwrite: 'Y' });
    expect(opts.contentType).toBe('application/xml');
    expect(Buffer.isBuffer(opts.body)).toBe(true);
    expect(opts.body.toString()).toBe('<FormModule Name="F"/>');
  });

  it('upload_module con content usa upload.xml y overwrite N', async () => {
    const { client, mcp } = await setup();
    await call(mcp, 'upload_module', { content: '<x/>', overwrite: false });

    const opts = client.request.mock.calls[0][2] as Record<string, any>;
    expect(opts.query).toEqual({ filename: 'upload.xml', overwrite: 'N' });
  });

  it('upload_module respeta filename explicito', async () => {
    const { client, mcp } = await setup();
    await call(mcp, 'upload_module', { path: 'f.xml', filename: 'otro_fmb.xml' });

    expect((client.request.mock.calls[0][2] as Record<string, any>).query.filename).toBe('otro_fmb.xml');
  });

  it('upload_module rechaza rutas fuera de OFDT_DATA_DIR sin llamar a la API', async () => {
    const { client, mcp } = await setup();
    const r = await call(mcp, 'upload_module', { path: '../etc/passwd' });

    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('OFDT_DATA_DIR');
    expect(client.request).not.toHaveBeenCalled();
  });

  it('import_catalog_txt envia text/plain al servidor indicado', async () => {
    const { client, mcp } = await setup();
    await call(mcp, 'import_catalog_txt', { server_id: 1, content: 'OWNER|OBJECT_NAME' });

    const [method, path, opts] = client.request.mock.calls[0] as [string, string, Record<string, any>];
    expect([method, path, opts.contentType]).toEqual(['POST', 'catalog/1/txt', 'text/plain']);
    expect(opts.body.toString()).toBe('OWNER|OBJECT_NAME');
  });

  it('validate_module y sync_catalog usan su ruta', async () => {
    const { client, mcp } = await setup();
    await call(mcp, 'validate_module', { module_id: 42, server_id: 2 });
    await call(mcp, 'sync_catalog', { server_id: 3 });

    expect(client.request.mock.calls).toEqual([
      ['POST', 'modules/42/validate', { query: { server_id: 2 } }],
      ['POST', 'catalog/3/sync'],
    ]);
  });

  it('las 4 herramientas modifican datos; solo upload_module es destructiva', async () => {
    const { mcp } = await setup();
    const { tools } = await mcp.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual(
      ['import_catalog_txt', 'sync_catalog', 'upload_module', 'validate_module'],
    );
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(false);
      expect(tool.annotations?.destructiveHint, tool.name).toBe(tool.name === 'upload_module');
    }
  });
});
