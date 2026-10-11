import type { Config } from './config.js';

const TIMEOUT_MS = 120_000;
const TOKEN_MARGIN_MS = 60_000;

/** Error HTTP de la API, con el codigo y la accion que informa OFDT_API. */
export class ApiError extends Error {
  readonly status: number;
  readonly action?: string;

  constructor(status: number, message: string, action?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.action = action;
  }
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: Buffer | string;
  contentType?: string;
}

type Credentials = Pick<Config, 'baseUrl' | 'clientId' | 'clientSecret'>;

/** Cliente OAuth2 client_credentials de la API ORDS ofdt.api.v1. */
export class OrdsClient {
  private token?: { value: string; expiresAt: number };

  constructor(
    private readonly cfg: Credentials,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async request<T = unknown>(
    method: 'GET' | 'POST',
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const url = new URL(`${this.cfg.baseUrl}/api/v1/${path}`);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let response = await this.send(method, url, opts, await this.getToken());
    if (response.status === 401) {
      this.token = undefined;
      response = await this.send(method, url, opts, await this.getToken());
    }
    return (await readBody(response)) as T;
  }

  private async send(method: string, url: URL, opts: RequestOptions, token: string) {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (opts.contentType) headers['Content-Type'] = opts.contentType;
    return this.fetchImpl(url.toString(), {
      method,
      headers,
      body: typeof opts.body === 'string' || opts.body === undefined ? opts.body : new Uint8Array(opts.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  private async getToken(): Promise<string> {
    if (this.token && this.now() < this.token.expiresAt - TOKEN_MARGIN_MS) {
      return this.token.value;
    }
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64');
    const response = await this.fetchImpl(`${this.cfg.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new ApiError(
        response.status,
        `No se pudo obtener el token OAuth2 (HTTP ${response.status}); revise OFDT_CLIENT_ID y OFDT_CLIENT_SECRET.`,
        'oauth_token',
      );
    }
    const data = (await response.json()) as { access_token: string; expires_in?: number };
    this.token = {
      value: data.access_token,
      expiresAt: this.now() + (data.expires_in ?? 3600) * 1000,
    };
    return this.token.value;
  }
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = undefined;
  }

  if (response.ok) {
    if (data === undefined) {
      throw new ApiError(response.status, `Respuesta no JSON de la API (HTTP ${response.status}).`);
    }
    return data;
  }

  const body = (data ?? {}) as { error?: unknown; message?: unknown };
  if (typeof body.message === 'string' && body.message) {
    const action = typeof body.error === 'string' ? body.error : undefined;
    throw new ApiError(response.status, body.message, action);
  }
  const snippet = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  throw new ApiError(
    response.status,
    `HTTP ${response.status} ${response.statusText}${snippet ? `: ${snippet}` : ''}`.trim(),
  );
}
