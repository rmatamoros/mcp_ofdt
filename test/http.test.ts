import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Config } from '../src/config.js';
import { createHttpApp } from '../src/server.js';
import { fakeClient } from './helpers.js';

const cfg: Config = {
  baseUrl: 'https://host/ords/ofdt',
  clientId: 'id',
  clientSecret: 's3cret',
  transport: 'http',
  port: 0,
  dataDir: '/tmp',
};

let server: ReturnType<typeof createHttpApp>;
let base: string;
const api = fakeClient({ client: 'mcp_dev', empresa_id: 1 });

beforeAll(async () => {
  server = createHttpApp(cfg, api);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('transporte HTTP', () => {
  it('GET /healthz responde ok', async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('ruta desconocida responde 404', async () => {
    expect((await fetch(`${base}/otra`)).status).toBe(404);
  });

  it('un cliente MCP lista las 11 herramientas y llama a whoami', async () => {
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(11);

    const r = (await client.callTool({ name: 'whoami', arguments: {} })) as {
      content: { text: string }[];
    };
    expect(r.content[0].text).toContain('"empresa_id": 1');
    await client.close();
  });
});
