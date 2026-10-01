import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ApplicationFailure, TimeoutFailure, WorkflowFailedError } from '@temporalio/client';
import { ALL_SUPPLIERS_UNAVAILABLE, ALL_SUPPLIERS_UNAVAILABLE_MESSAGE } from '../../domain/errors';
import { HttpError } from '../errors';

interface Mapped {
  status: number;
  message: string;
}

const mapError = (err: unknown): Mapped => {
  if (err instanceof HttpError) return { status: err.status, message: err.message };

  if (err instanceof WorkflowFailedError) {
    const cause = err.cause;
    if (cause instanceof ApplicationFailure && cause.type === ALL_SUPPLIERS_UNAVAILABLE) {
      return { status: 502, message: ALL_SUPPLIERS_UNAVAILABLE_MESSAGE };
    }
    if (cause instanceof TimeoutFailure) return { status: 504, message: 'Upstream timeout' };
  }

  // express.json() parse errors carry a 4xx `status` and `type: 'entity.parse.failed'`.
  if (typeof err === 'object' && err !== null && 'type' in err && err.type === 'entity.parse.failed') {
    return { status: 400, message: 'Malformed JSON body' };
  }

  return { status: 500, message: 'Internal server error' };
};

/** Central error middleware: maps known errors to status codes and never leaks stack traces. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const { status, message } = mapError(err);
  const log = req.log;
  if (status >= 500) log.error({ err, status }, message);
  else log.warn({ status, err: (err as Error).message }, message);

  if (res.headersSent) return;
  res.status(status).json({ error: message });
};

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Not found' });
};
