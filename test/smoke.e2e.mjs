// Prueba de humo contra un ambiente real (no corre con npm test).
// Uso: node test/smoke.e2e.mjs <comando> [args...]   p. ej.
//   node test/smoke.e2e.mjs node dist/index.js
//   node test/smoke.e2e.mjs docker run -i --rm --env-file .env -v "$PWD/../xml:/data:ro" ofdt-mcp
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [command, ...args] = process.argv.slice(2);
const client = new Client({ name: 'ofdt-smoke', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command, args, env: process.env, stderr: 'inherit' }));

let failures = 0;
async function step(label, name, args, check) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? '';
  const data = r.isError ? undefined : JSON.parse(text);
  const okCheck = !r.isError && check(data);
  if (!okCheck) failures++;
  console.log(`${okCheck ? 'PASS' : 'FAIL'} ${label}${okCheck ? '' : `: ${text.slice(0, 300)}`}`);
  return data;
}

const { tools } = await client.listTools();
console.log(`${tools.length === 11 ? 'PASS' : 'FAIL'} tools/list -> ${tools.length} herramientas`);
if (tools.length !== 11) failures++;

await step('whoami', 'whoami', {}, (d) => d.empresa_id > 0);
const mods = await step('list_modules', 'list_modules', { search: 'fpv' }, (d) => d.items.length > 0);
const id = mods?.items?.[0]?.module_id;
await step('get_module', 'get_module', { module_id: id }, (d) => Array.isArray(d.triggers));
await step('get_module_dependencies', 'get_module_dependencies', { module_id: id, type: 'TABLE', limit: 3 }, (d) => d.items.length === 3);
await step('find_impact', 'find_impact', { object: 'pvvendedores' }, (d) => d.summary.total_uses > 0);
await step('get_form_calls', 'get_form_calls', { module_id: id }, (d) => Array.isArray(d.incoming));
await step('list_servers', 'list_servers', {}, (d) => Array.isArray(d.items));
await step('upload_module', 'upload_module', { path: 'fpv4020_fmb.xml' }, (d) => d.module_id > 0);

const bad = await client.callTool({ name: 'upload_module', arguments: { path: '../README.md' } });
console.log(`${bad.isError ? 'PASS' : 'FAIL'} upload_module fuera de OFDT_DATA_DIR rechazado`);
if (!bad.isError) failures++;

await client.close();
console.log(`RESUMEN: ${failures === 0 ? 'OK' : `${failures} FAIL`}`);
process.exit(failures === 0 ? 0 : 1);
