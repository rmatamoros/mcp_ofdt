import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = {
  OFDT_BASE_URL: 'https://host/ords/ofdt/',
  OFDT_CLIENT_ID: 'id',
  OFDT_CLIENT_SECRET: 's3cret',
};

describe('loadConfig', () => {
  it('nombra todas las variables obligatorias que faltan', () => {
    expect(() => loadConfig({})).toThrow(/OFDT_BASE_URL[\s\S]*OFDT_CLIENT_ID[\s\S]*OFDT_CLIENT_SECRET/);
  });

  it('aplica valores por defecto y quita la barra final de la URL', () => {
    expect(loadConfig(base)).toEqual({
      baseUrl: 'https://host/ords/ofdt',
      clientId: 'id',
      clientSecret: 's3cret',
      transport: 'stdio',
      port: 3000,
      dataDir: '/data',
    });
  });

  it('rechaza un transporte desconocido', () => {
    expect(() => loadConfig({ ...base, MCP_TRANSPORT: 'ftp' })).toThrow(/MCP_TRANSPORT/);
  });

  it('no incluye el secreto en el mensaje de error', () => {
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow(/PORT/);
    try {
      loadConfig({ ...base, PORT: 'abc' });
    } catch (err) {
      expect(String(err)).not.toContain('s3cret');
    }
  });
});
