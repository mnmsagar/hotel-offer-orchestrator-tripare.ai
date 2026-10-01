import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { DefaultLogger, Runtime, Worker } from '@temporalio/worker';
import { ApplicationFailure, WorkflowFailedError } from '@temporalio/client';
import type { HotelActivities } from '../src/temporal/activities';
import { hotelOffersWorkflow } from '../src/temporal/workflows';
import { ALL_SUPPLIERS_UNAVAILABLE } from '../src/domain/errors';
import type { HotelOffer, SupplierHotel } from '../src/domain/types';

const workflowsPath = path.resolve(__dirname, '../src/temporal/workflows/index.ts');

const h = (name: string, price: number, commissionPct = 10): SupplierHotel => ({
  hotelId: name,
  name,
  price,
  city: 'delhi',
  commissionPct,
});

const A = [h('Taj Palace', 6200), h('The Lalit', 5200)];
const B = [h('Taj Palace', 5900), h('Bloomrooms', 2800)];

interface Calls {
  a: number;
  b: number;
  saved: HotelOffer[][];
}

const fail = () => Promise.reject(new Error('supplier down'));

describe('hotelOffersWorkflow', () => {
  let env: TestWorkflowEnvironment;

  beforeAll(async () => {
    // Keep test output readable: only surface SDK errors.
    Runtime.install({ logger: new DefaultLogger('ERROR') });
    // Time-skipping lets retries' backoff timers complete instantly.
    env = await TestWorkflowEnvironment.createTimeSkipping();
  });

  afterAll(async () => {
    await env?.teardown();
  });

  const run = async (overrides: Partial<HotelActivities>) => {
    const calls: Calls = { a: 0, b: 0, saved: [] };
    const activities: HotelActivities = {
      fetchSupplierA: async () => A,
      fetchSupplierB: async () => B,
      saveToRedis: async (_city, offers) => {
        calls.saved.push(offers);
      },
      ...overrides,
    };
    // Wrap to count attempts (proves the retry policy).
    const counted: HotelActivities = {
      ...activities,
      fetchSupplierA: (city) => (calls.a++, activities.fetchSupplierA(city)),
      fetchSupplierB: (city) => (calls.b++, activities.fetchSupplierB(city)),
    };

    // Unique queue per test so workers never pick up each other's tasks.
    const taskQueue = `test-${Math.random()}`;
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowsPath,
      activities: counted,
    });

    const result = worker.runUntil(
      env.client.workflow.execute(hotelOffersWorkflow, {
        taskQueue,
        workflowId: `wf-${Math.random()}`,
        args: [{ city: 'delhi' }],
      }),
    );
    return { result, calls };
  };

  it('merges both suppliers and caches the result', async () => {
    const { result, calls } = await run({});
    const offers = await result;
    expect(offers).toEqual([
      { name: 'Bloomrooms', price: 2800, supplier: 'Supplier B', commissionPct: 10 },
      { name: 'The Lalit', price: 5200, supplier: 'Supplier A', commissionPct: 10 },
      { name: 'Taj Palace', price: 5900, supplier: 'Supplier B', commissionPct: 10 },
    ]);
    expect(calls.saved).toEqual([offers]);
  });

  it('returns a partial result when one supplier fails (after 3 attempts)', async () => {
    const { result, calls } = await run({ fetchSupplierB: fail });
    const offers = await result;
    expect(offers.map((o) => o.supplier)).toEqual(['Supplier A', 'Supplier A']);
    expect(calls.b).toBe(3);
    expect(calls.a).toBe(1);
  });

  it('does not retry non-retryable failures', async () => {
    const { result, calls } = await run({
      fetchSupplierA: () => Promise.reject(ApplicationFailure.nonRetryable('bad request', 'SupplierClientError')),
    });
    await result;
    expect(calls.a).toBe(1);
  });

  it('fails with AllSuppliersUnavailable when both suppliers fail', async () => {
    const { result } = await run({ fetchSupplierA: fail, fetchSupplierB: fail });
    const err = await result.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkflowFailedError);
    const cause = (err as WorkflowFailedError).cause;
    expect(cause).toBeInstanceOf(ApplicationFailure);
    expect((cause as ApplicationFailure).type).toBe(ALL_SUPPLIERS_UNAVAILABLE);
  });

  it('still returns offers when caching fails', async () => {
    const { result } = await run({ saveToRedis: () => Promise.reject(new Error('redis down')) });
    expect(await result).toHaveLength(3);
  });
});
