import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/**
 * Devuelve el contenido a enviar a la API: el texto en linea o un archivo
 * dentro de dataDir (OFDT_DATA_DIR). Los symlinks se resuelven antes de
 * comprobar que el archivo no sale de dataDir.
 */
export async function readInput(
  args: { path?: string; content?: string },
  dataDir: string,
): Promise<Buffer> {
  const hasPath = args.path !== undefined && args.path !== '';
  const hasContent = args.content !== undefined;
  if (hasPath === hasContent) {
    throw new Error('Indique exactamente uno de path o content.');
  }
  if (!hasPath) {
    return Buffer.from(args.content!, 'utf8');
  }

  const root = await realpath(dataDir);
  const requested = isAbsolute(args.path!) ? args.path! : resolve(root, args.path!);
  let real: string;
  try {
    real = await realpath(requested);
  } catch {
    throw new Error(`No existe el archivo ${args.path} en OFDT_DATA_DIR (${dataDir}).`);
  }
  if (!real.startsWith(root + sep)) {
    throw new Error(`La ruta ${args.path} queda fuera de OFDT_DATA_DIR (${dataDir}).`);
  }

  const info = await stat(real);
  if (!info.isFile()) {
    throw new Error(`${args.path} no es un archivo.`);
  }
  if (info.size > MAX_FILE_BYTES) {
    throw new Error(`${args.path} supera el maximo de 50 MB.`);
  }
  return readFile(real);
}
