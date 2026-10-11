import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { vi } from 'vitest';

export function fakeClient(result: unknown = { ok: true }) {
  return { request: vi.fn(async (..._args: unknown[]) => result) };
}

/** Conecta un Client MCP en memoria a un servidor con las herramientas registradas. */
export async function connect(register: (server: McpServer) => void): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  register(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

/** callTool que convierte un error de protocolo en { isError: true }. */
export async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  try {
    return (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { type: string; text: string }[];
    };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: String(err) }] };
  }
}
