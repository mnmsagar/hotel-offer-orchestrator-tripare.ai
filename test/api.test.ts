import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { ApplicationFailure, TimeoutFailure, WorkflowFailedError } from '@temporalio/client';
import { RetryState, TimeoutType } from '@temporalio/common';
import { ALL_SUPPLIERS_UNAVAILABLE } from '../src/domain/errors';
import type { HotelOffer } from '../src/domain/types';
import { buildTestApp, okHealth } from './helpers';

const offers: HotelOffer[] = [
  { name: 'Bloomrooms', price: 2800, supplier: 'Supplier B', commissionPct: 7 },
  { name: 'Taj Palace', price: 5900, supplier: 'Supplier B', commissionPct: 10 },
];

describe('GET /api/hotels — validation', () => {
  const { app } = buildTestApp();

  it.each([
    ['missing city', '/api/hotels'],
    ['blank city', '/api/hotels?city=%20%20'],
    ['repeated city', '/api/hotels?city=delhi&city=mumbai'],
    ['non-numeric minPrice', '/api/hotels?city=delhi&minPrice=abc'],
    ['negative maxPrice', '/api/hotels?city=delhi&maxPrice=-5'],
    ['empty minPrice', '/api/hotels?city=delhi&minPrice='],
    ['minPrice > maxPrice', '/api/hotels?city=delhi&minPrice=6000&maxPrice=5000'],
  ])('400 for %s', async (_label, url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
  });
});

describe('GET /api/hotels — flow', () => {
  it('runs the workflow with a normalized city when no price filter is given', async () => {
    const runWorkflow = vi.fn(async () => offers);
    const readCache = vi.fn(async () => null);
    const { app } = buildTestApp({ runWorkflow, readCache });

    const res = await request(app).get('/api/hotels?city=%20DeLhi%20');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(offers);
    expect(runWorkflow).toHaveBeenCalledWith('delhi', expect.any(String));
    expect(readCache).not.toHaveBeenCalled();
  });

  it('returns 200 [] for an unknown city', async () => {
    const { app } = buildTestApp({ runWorkflow: async () => [] });
    const res = await request(app).get('/api/hotels?city=atlantis');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('serves filtered results straight from the cache when the city is cached', async () => {
    const runWorkflow = vi.fn(async () => offers);
    const readCache = vi.fn(async () => [offers[1]!]);
    const { app } = buildTestApp({ runWorkflow, readCache });

    const res = await request(app).get('/api/hotels?city=delhi&minPrice=5000&maxPrice=6000');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([offers[1]]);
    expect(readCache).toHaveBeenCalledWith('delhi', { minPrice: 5000, maxPrice: 6000 });
    expect(runWorkflow).not.toHaveBeenCalled();
  });

  it('accepts a single bound', async () => {
    const readCache = vi.fn(async () => []);
    const { app } = buildTestApp({ readCache });
    await request(app).get('/api/hotels?city=delhi&maxPrice=3000').expect(200);
    expect(readCache).toHaveBeenCalledWith('delhi', { minPrice: undefined, maxPrice: 3000 });
  });

  it('on a cache miss, runs the workflow and then filters from the cache', async () => {
    const runWorkflow = vi.fn(async () => offers);
    const readCache = vi.fn<() => Promise<HotelOffer[] | null>>().mockResolvedValueOnce(null).mockResolvedValueOnce([]);
    const { app } = buildTestApp({ runWorkflow, readCache });

    const res = await request(app).get('/api/hotels?city=delhi&minPrice=10000');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(runWorkflow).toHaveBeenCalledOnce();
    expect(readCache).toHaveBeenCalledTimes(2);
  });
});

describe('GET /api/hotels — error mapping', () => {
  const failWith = (err: Error) => buildTestApp({ runWorkflow: () => Promise.reject(err) }).app;

  it('502 when all suppliers are unavailable', async () => {
    const cause = ApplicationFailure.create({ message: 'All suppliers unavailable', type: ALL_SUPPLIERS_UNAVAILABLE });
    const app = failWith(new WorkflowFailedError('Workflow execution failed', cause, RetryState.NON_RETRYABLE_FAILURE));
    const res = await request(app).get('/api/hotels?city=delhi');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'All suppliers unavailable' });
  });

  it('504 when the workflow times out', async () => {
    const cause = new TimeoutFailure('Workflow execution timed out', undefined, TimeoutType.START_TO_CLOSE);
    const app = failWith(new WorkflowFailedError('timed out', cause, RetryState.TIMEOUT));
    expect((await request(app).get('/api/hotels?city=delhi')).status).toBe(504);
  });

  it('500 for unexpected errors, without leaking details', async () => {
    const app = failWith(new Error('secret internal detail'));
    const res = await request(app).get('/api/hotels?city=delhi');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('echoes a request id header', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/hotels?city=delhi').set('x-request-id', 'abc-123');
    expect(res.headers['x-request-id']).toBe('abc-123');
  });

  it('404 JSON for unknown routes', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});

describe('mock suppliers and admin toggle', () => {
  it('filters supplier data by city (case-insensitive)', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/supplierA/hotels?city=DELHI');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((h: { city: string }) => h.city === 'delhi')).toBe(true);
  });

  it('returns all hotels without a city filter', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/supplierB/hotels');
    expect(new Set(res.body.map((h: { city: string }) => h.city)).size).toBeGreaterThan(1);
  });

  it('toggles a supplier down (503) and back up', async () => {
    const { app } = buildTestApp();
    await request(app).post('/admin/suppliers/supplierB/status').send({ down: true }).expect(200);
    await request(app).get('/supplierB/hotels').expect(503);
    await request(app).get('/supplierA/hotels').expect(200);
    await request(app).post('/admin/suppliers/supplierB/status').send({ down: false }).expect(200);
    await request(app).get('/supplierB/hotels').expect(200);
  });

  it('validates admin input', async () => {
    const { app } = buildTestApp();
    await request(app).post('/admin/suppliers/supplierC/status').send({ down: true }).expect(400);
    await request(app).post('/admin/suppliers/supplierA/status').send({ down: 'yes' }).expect(400);
    await request(app)
      .post('/admin/suppliers/supplierA/status')
      .set('content-type', 'application/json')
      .send('{bad json')
      .expect(400);
  });

  it('does not mount admin routes when disabled (production)', async () => {
    const { app } = buildTestApp({}, { enableAdmin: false });
    await request(app).post('/admin/suppliers/supplierA/status').send({ down: true }).expect(404);
  });
});

describe('GET /health', () => {
  it('200 for ok and degraded', async () => {
    for (const status of ['ok', 'degraded'] as const) {
      const { app } = buildTestApp({}, { checkHealth: async () => ({ ...okHealth, status }) });
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(status);
    }
  });

  it('liveness is 200 even when dependencies are down', async () => {
    const { app } = buildTestApp({}, { checkHealth: async () => ({ ...okHealth, status: 'down' }) });
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('503 for down', async () => {
    const { app } = buildTestApp({}, { checkHealth: async () => ({ ...okHealth, status: 'down' }) });
    expect((await request(app).get('/health')).status).toBe(503);
  });
});
