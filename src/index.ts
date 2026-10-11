#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { OrdsClient } from './ordsClient.js';
import { createHttpApp, createServer } from './server.js';

// En modo stdio, stdout es el canal MCP: todo log va a stderr.
async function main(): Promise<void> {
  let cfg;
  try {
    cfg = loadConfig(process.env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const api = new OrdsClient(cfg);
  if (cfg.transport === 'http') {
    createHttpApp(cfg, api).listen(cfg.port, '0.0.0.0', () => {
      console.error(`ofdt-mcp escuchando en http://0.0.0.0:${cfg.port}/mcp`);
    });
  } else {
    await createServer(cfg, api).connect(new StdioServerTransport());
    console.error('ofdt-mcp listo (stdio)');
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
