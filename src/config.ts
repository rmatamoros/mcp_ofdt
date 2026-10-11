import { z } from 'zod';

export interface Config {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  transport: 'stdio' | 'http';
  port: number;
  dataDir: string;
}

const required = (name: string) =>
  z.string({ error: `${name} es obligatoria` }).trim().min(1, `${name} es obligatoria`);

const schema = z.object({
  OFDT_BASE_URL: required('OFDT_BASE_URL').pipe(z.url({ error: 'OFDT_BASE_URL debe ser una URL' })),
  OFDT_CLIENT_ID: required('OFDT_CLIENT_ID'),
  OFDT_CLIENT_SECRET: required('OFDT_CLIENT_SECRET'),
  MCP_TRANSPORT: z.enum(['stdio', 'http'], { error: 'MCP_TRANSPORT debe ser stdio o http' }).default('stdio'),
  PORT: z.coerce
    .number({ error: 'PORT debe ser un numero' })
    .int('PORT debe ser un entero')
    .min(1, 'PORT fuera de rango')
    .max(65535, 'PORT fuera de rango')
    .default(3000),
  OFDT_DATA_DIR: z.string().trim().min(1).default('/data'),
});

/** Lee la configuracion de variables de entorno. Los errores nunca incluyen valores. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `- ${issue.message}`);
    throw new Error(`Configuracion invalida:\n${problems.join('\n')}`);
  }
  const e = parsed.data;
  return {
    baseUrl: e.OFDT_BASE_URL.replace(/\/+$/, ''),
    clientId: e.OFDT_CLIENT_ID,
    clientSecret: e.OFDT_CLIENT_SECRET,
    transport: e.MCP_TRANSPORT,
    port: e.PORT,
    dataDir: e.OFDT_DATA_DIR,
  };
}
