import { describe, expect, it, vi } from 'vitest';
import { ApiError, OrdsClient } from '../src/ordsClient.js';

const cfg = { baseUrl: 'https://host/ords/ofdt', clientId: 'id', clientSecret: 's3cret' };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function tokenResponse(token = 'tok', expiresIn = 3600): Response {
  return json(200, { access_token: token, token_type: 'bearer', expires_in: expiresIn });
}

function isTokenCall(url: unknown): boolean {
  return String(url).endsWith('/oauth/token');
}

describe('OrdsClient', () => {
  it('pide el token una sola vez para varias llamadas', async () => {
    const fetchImpl = vi.fn(async (url: unknown) =>
      isTokenCall(url) ? tokenResponse() : json(200, { ok: true }),
    );
    const client = new OrdsClient(cfg, fetchImpl as typeof fetch);

    await client.request('GET', 'whoami');
    await client.request('GET', 'servers');

    expect(fetchImpl.mock.calls.filter(([u]) => isTokenCall(u))).toHaveLength(1);
  });

  it('pide el token con Basic auth y grant_type=client_credentials', async () => {
    const fetchImpl = vi.fn(async (url: unknown) =>
      isTokenCall(url) ? tokenResponse() : json(200, {}),
    );
    await new OrdsClient(cfg, fetchImpl as typeof fetch).request('GET', 'whoami');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://host/ords/ofdt/oauth/token');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('Authorization')).toBe(
      'Basic ' + Buffer.from('id:s3cret').toString('base64'),
    );
    expect(String(init.body)).toBe('grant_type=client_credentials');
  });

  it('renueva el token 60 s antes de que expire', async () => {
    let now = 0;
    const fetchImpl = vi.fn(async (url: unknown) =>
      isTokenCall(url) ? tokenResponse('tok', 3600) : json(200, {}),
    );
    const client = new OrdsClient(cfg, fetchImpl as typeof fetch, () => now);

    await client.request('GET', 'whoami');
    now = (3600 - 61) * 1000;
    await client.request('GET', 'whoami');
    expect(fetchImpl.mock.calls.filter(([u]) => isTokenCall(u))).toHaveLength(1);

    now = (3600 - 59) * 1000;
    await client.request('GET', 'whoami');
    expect(fetchImpl.mock.calls.filter(([u]) => isTokenCall(u))).toHaveLength(2);
  });

  it('ante 401 renueva el token una vez y reintenta', async () => {
    const api = [json(401, {}), json(200, { ok: 1 })];
    const fetchImpl = vi.fn(async (url: unknown) =>
      isTokenCall(url) ? tokenResponse() : api.shift()!,
    );
    const result = await new OrdsClient(cfg, fetchImpl as typeof fetch).request('GET', 'whoami');

    expect(result).toEqual({ ok: 1 });
    expect(fetchImpl.mock.calls.filter(([u]) => isTokenCall(u))).toHaveLength(2);
  });

  it('dos 401 seguidos terminan en ApiError 401', async () => {
    const fetchImpl = vi.fn(async (url: unknown) =>
      isTokenCall(url) ? tokenResponse() : json(401, {}),
    );
    const err = await new OrdsClient(cfg, fetchImpl as typeof fetch)
      .request('GET', 'whoami')
      .catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
  });

  it('traduce el JSON de error de la API a ApiError', async () => {
    const body = { error: 'load_xml', status: 409, message: 'El modulo X pertenece a otra empresa.' };
    const fetchImpl = vi.fn(async (url: unknown) =>
      isTokenCall(url) ? tokenResponse() : json(409, body),
    );
    const err = await new OrdsClient(cfg, fetchImpl as typeof fetch)
      .request('POST', 'modules')
      .catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.action).toBe('load_xml');
    expect(err.message).toBe('El modulo X pertenece a otra empresa.');
  });

  it('una respuesta de error en HTML da ApiError legible con el codigo', async () => {
    const fetchImpl = vi.fn(async (url: unknown) =>
      isTokenCall(url)
        ? tokenResponse()
        : new Response('<html><body>Bad Gateway</body></html>', {
            status: 502,
            headers: { 'Content-Type': 'text/html' },
          }),
    );
    const err = await new OrdsClient(cfg, fetchImpl as typeof fetch)
      .request('GET', 'servers')
      .catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.message).toContain('502');
  });

  it('arma la URL de la API omitiendo parametros undefined', async () => {
    const fetchImpl = vi.fn(async (url: unknown) =>
      isTokenCall(url) ? tokenResponse() : json(200, {}),
    );
    await new OrdsClient(cfg, fetchImpl as typeof fetch).request('GET', 'modules', {
      query: { search: 'fpv', limit: undefined },
    });

    expect(String(fetchImpl.mock.calls[1][0])).toBe('https://host/ords/ofdt/api/v1/modules?search=fpv');
  });

  it('envia body, Content-Type y Bearer en un POST', async () => {
    const fetchImpl = vi.fn(async (url: unknown) =>
      isTokenCall(url) ? tokenResponse('abc') : json(201, { module_id: 1 }),
    );
    await new OrdsClient(cfg, fetchImpl as typeof fetch).request('POST', 'modules', {
      body: '<x/>',
      contentType: 'application/xml',
    });

    const init = fetchImpl.mock.calls[1][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(init.method).toBe('POST');
    expect(init.body).toBe('<x/>');
    expect(headers.get('Content-Type')).toBe('application/xml');
    expect(headers.get('Authorization')).toBe('Bearer abc');
  });

  it('ningun error expone el secreto', async () => {
    const fetchImpl = vi.fn(async () => json(401, { error: 'invalid_client' }));
    const err = await new OrdsClient(cfg, fetchImpl as typeof fetch)
      .request('GET', 'whoami')
      .catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(String(err)).not.toContain('s3cret');
    expect(JSON.stringify(err)).not.toContain('s3cret');
  });
});
