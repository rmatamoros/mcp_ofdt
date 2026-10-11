import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ApiError } from './ordsClient.js';

export function ok(data: unknown): CallToolResult {
  const result: CallToolResult = {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    result.structuredContent = data as Record<string, unknown>;
  }
  return result;
}

export function fail(err: unknown): CallToolResult {
  let text: string;
  if (err instanceof ApiError) {
    text = `HTTP ${err.status}${err.action ? ` (${err.action})` : ''}: ${err.message}`;
  } else {
    text = `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
  return { content: [{ type: 'text', text }], isError: true };
}

export async function runTool(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}
