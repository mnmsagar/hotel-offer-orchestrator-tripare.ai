import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import { ApplicationFailure } from '@temporalio/activity';
import { createSupplierActivities } from '../src/temporal/activities/suppliers.activities';
import { createHealthChecker } from '../src/api/services/health.service';
import { SUPPLIER_CLIENT_ERROR } from '../src/domain/errors';
import { buildTestApp, silentLogger } from './helpers';

const listen = (app: express.Express): Promise<{ server: Server; url: string }> =>
  new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });

describe('supplier activities and health checker against the mock API', () => {
  const { app, supplierStatus } = buildTestApp();
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    ({ server, url: baseUrl } = await listen(app));
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(() => {
    supplierStatus.setDown('supplierA', false);
    supplierStatus.setDown('supplierB', false);
  });

  const activities = () =>
    createSupplierActivities({ supplierBaseUrl: baseUrl, supplierTimeoutMs: 2000, logger: silentLogger });

  it('fetches and validates a supplier’s hotels for a city', async () => {
    const hotels = await activities().fetchSupplierA('delhi');
    expect(hotels.length).toBeGreaterThan(0);
    expect(hotels.every((h) => h.city === 'delhi')).toBe(true);
  });

  it('throws a retryable error on 5xx', async () => {
    supplierStatus.setDown('supplierB', true);
    const err = await activities()
      .fetchSupplierB('delhi')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ApplicationFailure);
  });

  it('throws a retryable error when the supplier is unreachable', async () => {
    const unreachable = createSupplierActivities({
      supplierBaseUrl: 'http://127.0.0.1:1',
      supplierTimeoutMs: 500,
      logger: silentLogger,
    });
    const err = await unreachable.fetchSupplierA('delhi').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ApplicationFailure);
  });

  it('throws a non-retryable ApplicationFailure on 4xx', async () => {
    const badRequestApp = express().use((_req, res) => {
      res.status(400).json({ error: 'bad' });
    });
    const { server: s, url } = await listen(badRequestApp);
    try {
      const err = await createSupplierActivities({ supplierBaseUrl: url, supplierTimeoutMs: 2000, logger: silentLogger })
        .fetchSupplierA('delhi')
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApplicationFailure);
      expect((err as ApplicationFailure).nonRetryable).toBe(true);
      expect((err as ApplicationFailure).type).toBe(SUPPLIER_CLIENT_ERROR);
    } finally {
      s.close();
    }
  });

  describe('health checker', () => {
    const checker = (redisUp = true, temporalUp = true) =>
      createHealthChecker({
        supplierBaseUrl: baseUrl,
        pingRedis: async () => {
          if (!redisUp) throw new Error('down');
        },
        pingTemporal: async () => {
          if (!temporalUp) throw new Error('down');
        },
        timeoutMs: 1000,
      });

    it('ok when everything is up', async () => {
      expect(await checker()()).toEqual({
        status: 'ok',
        suppliers: { supplierA: 'up', supplierB: 'up' },
        redis: 'up',
        temporal: 'up',
      });
    });

    it('degraded when one supplier is down', async () => {
      supplierStatus.setDown('supplierB', true);
      const report = await checker()();
      expect(report.status).toBe('degraded');
      expect(report.suppliers.supplierB).toBe('down');
    });

    it('down when both suppliers are down', async () => {
      supplierStatus.setDown('supplierA', true);
      supplierStatus.setDown('supplierB', true);
      expect((await checker()()).status).toBe('down');
    });

    it('down when Redis or Temporal is down', async () => {
      expect((await checker(false, true)()).status).toBe('down');
      expect((await checker(true, false)()).status).toBe('down');
    });

    it('treats a hanging dependency as down after the timeout', async () => {
      const hanging = createHealthChecker({
        supplierBaseUrl: baseUrl,
        pingRedis: () => new Promise(() => undefined),
        pingTemporal: async () => undefined,
        timeoutMs: 200,
      });
      expect((await hanging()).redis).toBe('down');
    });
  });
});
