import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/ordsClient.js';
import { fail, ok, runTool } from '../src/result.js';

const text = (r: { content: unknown[] }) => (r.content[0] as { text: string }).text;

describe('result', () => {
  it('ok devuelve JSON formateado y structuredContent', () => {
    const r = ok({ module_id: 1 });
    expect(text(r)).toBe('{\n  "module_id": 1\n}');
    expect(r.structuredContent).toEqual({ module_id: 1 });
    expect(r.isError).toBeUndefined();
  });

  it('fail con ApiError incluye status y accion', () => {
    const r = fail(new ApiError(409, 'El modulo X pertenece a otra empresa.', 'load_xml'));
    expect(r.isError).toBe(true);
    expect(text(r)).toBe('HTTP 409 (load_xml): El modulo X pertenece a otra empresa.');
  });

  it('fail con ApiError sin accion', () => {
    expect(text(fail(new ApiError(502, 'Bad Gateway')))).toBe('HTTP 502: Bad Gateway');
  });

  it('fail con otro error', () => {
    expect(text(fail(new Error('sin red')))).toBe('Error: sin red');
  });

  it('runTool convierte excepciones en isError', async () => {
    const r = await runTool(async () => {
      throw new ApiError(404, 'Modulo 9 no encontrado.', 'get_module');
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('HTTP 404');
  });
});
