import { mkdtemp, mkdir, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, readInput } from '../src/fileInput.js';

let root: string;
let dataDir: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'ofdt-mcp-'));
  dataDir = join(root, 'data');
  await mkdir(join(dataDir, 'sub'), { recursive: true });
  await writeFile(join(dataDir, 'a.xml'), '<a/>');
  await writeFile(join(dataDir, 'sub', 'b.txt'), 'B');
  await writeFile(join(root, 'fuera.xml'), 'secreto');
  await symlink(join(root, 'fuera.xml'), join(dataDir, 'link.xml'));
  await writeFile(join(dataDir, 'grande.xml'), '');
  await truncate(join(dataDir, 'grande.xml'), MAX_FILE_BYTES + 1);
});

describe('readInput', () => {
  it('lee una ruta relativa dentro de dataDir', async () => {
    expect((await readInput({ path: 'a.xml' }, dataDir)).toString()).toBe('<a/>');
    expect((await readInput({ path: 'sub/b.txt' }, dataDir)).toString()).toBe('B');
  });

  it('acepta una ruta absoluta dentro de dataDir', async () => {
    expect((await readInput({ path: join(dataDir, 'a.xml') }, dataDir)).toString()).toBe('<a/>');
  });

  it('devuelve content como Buffer', async () => {
    expect((await readInput({ content: 'X|Y' }, dataDir)).toString()).toBe('X|Y');
  });

  it('rechaza rutas con .. que salen de dataDir', async () => {
    await expect(readInput({ path: '../fuera.xml' }, dataDir)).rejects.toThrow(/OFDT_DATA_DIR/);
  });

  it('rechaza un symlink que apunta fuera de dataDir', async () => {
    await expect(readInput({ path: 'link.xml' }, dataDir)).rejects.toThrow(/OFDT_DATA_DIR/);
  });

  it('exige exactamente uno de path o content', async () => {
    await expect(readInput({}, dataDir)).rejects.toThrow('Indique exactamente uno de path o content.');
    await expect(readInput({ path: 'a.xml', content: 'x' }, dataDir)).rejects.toThrow(
      'Indique exactamente uno de path o content.',
    );
  });

  it('rechaza archivos de mas de 50 MB', async () => {
    await expect(readInput({ path: 'grande.xml' }, dataDir)).rejects.toThrow(/50 MB/);
  });

  it('nombra el archivo inexistente', async () => {
    await expect(readInput({ path: 'nada.xml' }, dataDir)).rejects.toThrow(/nada\.xml/);
  });
});
