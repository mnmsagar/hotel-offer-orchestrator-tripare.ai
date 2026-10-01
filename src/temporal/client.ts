import { randomUUID } from 'node:crypto';
import { Client, Connection, WorkflowFailedError } from '@temporalio/client';
import { HttpError } from '../api/errors';
import type { HotelOffer } from '../domain/types';
import { config } from '../lib/config';
import { logger } from '../lib/logger';
// Type-only: the API never loads workflow code, it just references it by name.
import type { hotelOffersWorkflow } from './workflows';

interface Temporal {
  connection: Connection;
  client: Client;
}

const CONNECT_TIMEOUT = '3s';
const START_DEADLINE_MS = 5_000;
const RESULT_DEADLINE_MARGIN_MS = 5_000;

let temporalPromise: Promise<Temporal> | undefined;

/** Lazily connects once and reuses the connection. A failed connect is retried on the next call. */
const getTemporal = (): Promise<Temporal> => {
  temporalPromise ??= Connection.connect({ address: config.TEMPORAL_ADDRESS, connectTimeout: CONNECT_TIMEOUT })
    .then((connection) => ({ connection, client: new Client({ connection, namespace: config.TEMPORAL_NAMESPACE }) }))
    .catch((err: unknown) => {
      temporalPromise = undefined;
      throw err;
    });
  return temporalPromise;
};

export const getTemporalClient = async (): Promise<Client> => (await getTemporal()).client;

/** Calls Temporal's gRPC health service; rejects if the frontend is unreachable or unhealthy. */
export const pingTemporal = async (): Promise<void> => {
  const { connection } = await getTemporal();
  await connection.healthService.check({});
};

export const closeTemporalClient = async (): Promise<void> => {
  if (!temporalPromise) return;
  const pending = temporalPromise;
  temporalPromise = undefined;
  await pending.then((t) => t.connection.close()).catch(() => undefined);
};

const workflowIdFor = (city: string): string =>
  `hotel-offers-${city.replace(/[^a-z0-9]+/g, '-')}-${randomUUID()}`;

/**
 * Starts hotelOffersWorkflow and waits for its result.
 * `workflowExecutionTimeout` makes Temporal itself time the run out (→ 504), e.g. if no worker is polling.
 */
export const runHotelOffersWorkflow = async (city: string, requestId: string): Promise<HotelOffer[]> => {
  const workflowId = workflowIdFor(city);
  const log = logger.child({ requestId, city, workflowId });

  let client: Client;
  let handle;
  try {
    client = await getTemporalClient();
    // The SDK retries gRPC calls while Temporal is unreachable; a deadline turns that into a fast 503.
    handle = await client.withDeadline(Date.now() + START_DEADLINE_MS, () =>
      client.workflow.start<typeof hotelOffersWorkflow>('hotelOffersWorkflow', {
        taskQueue: config.TEMPORAL_TASK_QUEUE,
        workflowId,
        args: [{ city }],
        workflowExecutionTimeout: config.WORKFLOW_TIMEOUT_MS,
        memo: { requestId },
      }),
    );
  } catch (err) {
    log.error({ err }, 'failed to start workflow');
    throw new HttpError(503, 'Workflow service unavailable', { cause: err });
  }

  log.info('workflow started');
  try {
    // Temporal times the run out at WORKFLOW_TIMEOUT_MS (→ WorkflowFailedError → 504); the extra
    // margin only matters if Temporal itself becomes unreachable while we wait.
    const result = await client.withDeadline(Date.now() + config.WORKFLOW_TIMEOUT_MS + RESULT_DEADLINE_MARGIN_MS, () =>
      handle.result(),
    );
    log.info({ count: result.length }, 'workflow completed');
    return result;
  } catch (err) {
    log.error({ err: (err as Error).message, cause: (err as Error).cause }, 'workflow failed');
    if (err instanceof WorkflowFailedError) throw err; // mapped to 502/504 by the error middleware
    throw new HttpError(503, 'Workflow service unavailable', { cause: err });
  }
};
