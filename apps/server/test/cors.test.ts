import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestServer } from './helpers/test-server';

const origin = 'http://127.0.0.1:5173';
const alias = 'http://localhost:5173';
const managementRoutes = ['/providers', '/ai-characters', '/tasks'];

describe('CORS and origin checks in the assembled server', () => {
  let server: Awaited<ReturnType<typeof createTestServer>>;
  beforeAll(async () => {
    server = await createTestServer({ origin });
  });
  afterAll(async () => {
    await server?.close();
  });

  it.each(managementRoutes)(
    'rejects foreign preflights and actual requests at %s',
    async (path) => {
      for (const method of ['OPTIONS', 'POST']) {
        const response = await fetch(server.httpUrl + path, {
          method,
          headers: { Origin: 'https://foreign.example' },
        });
        expect(response.status).toBe(403);
        expect(response.headers.get('access-control-allow-origin')).toBeNull();
        expect(await response.json()).toEqual({ error: expect.any(String) });
      }
    },
  );

  it.each(managementRoutes)(
    'keeps management preflight ahead of bearer authentication at %s',
    async (path) => {
      for (const requestOrigin of [origin, undefined]) {
        const headers = new Headers(
          requestOrigin ? { Origin: requestOrigin } : {},
        );
        const response = await fetch(server.httpUrl + path, {
          method: 'OPTIONS',
          headers,
        });
        expect(response.status).toBe(204);
        expect(response.headers.get('access-control-allow-headers')).toBe(
          'Content-Type, Authorization, Idempotency-Key',
        );
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect((await fetch(server.httpUrl + path, { headers })).status).toBe(
          401,
        );
      }
      // Management has an exact allowlist; the public page's loopback alias rule must not widen it.
      expect(
        (
          await fetch(server.httpUrl + path, {
            method: 'OPTIONS',
            headers: { Origin: alias },
          })
        ).status,
      ).toBe(403);
    },
  );

  it('keeps public requests accessible without granting foreign CORS access', async () => {
    for (const requestOrigin of [origin, alias, 'https://foreign.example']) {
      const response = await fetch(server.httpUrl + '/health', {
        headers: { Origin: requestOrigin },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe(
        requestOrigin === 'https://foreign.example' ? null : requestOrigin,
      );
    }
    const options = await fetch(server.httpUrl + '/health', {
      method: 'OPTIONS',
      headers: { Origin: origin },
    });
    expect(options.status).toBe(200); // Express's existing automatic OPTIONS response.
    expect(options.headers.get('access-control-allow-methods')).toBeNull();
  });

  it('retains the presence endpoint plain-text 403 response', async () => {
    const response = await fetch(server.httpUrl + '/world/presence', {
      headers: { Origin: 'https://foreign.example' },
    });
    expect(response.status).toBe(403);
    expect(await response.text()).toBe('Forbidden');
  });
});
