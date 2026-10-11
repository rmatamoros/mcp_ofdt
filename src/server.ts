import { readFileSync } from 'node:fs';
import { createServer as createNodeServer, type Server } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Config } from './config.js';
import { OrdsClient } from './ordsClient.js';
import { registerActionTools } from './tools/actions.js';
import { registerQueryTools } from './tools/query.js';

type Api = Pick<OrdsClient, 'request'>;

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

export function createServer(cfg: Config, api: Api = new OrdsClient(cfg)): McpServer {
  const server = new McpServer({ name: 'ofdt-mcp', version });
  registerQueryTools(server, api);
  registerActionTools(server, api, cfg.dataDir);
  return server;
}

/**
 * Streamable HTTP sin estado en /mcp: un McpServer y un transporte por
 * request. El cliente OAuth2 se comparte para reutilizar el token.
 */
export function createHttpApp(cfg: Config, api: Api = new OrdsClient(cfg)): Server {
  return createNodeServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;

    if (req.method === 'GET' && path === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"ok"}');
      return;
    }
    if (path !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"not_found"}');
      return;
    }

    const server = createServer(cfg, api);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error('Error atendiendo /mcp:', err instanceof Error ? err.message : err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' }).end('{"error":"internal"}');
      }
    }
  });
}
