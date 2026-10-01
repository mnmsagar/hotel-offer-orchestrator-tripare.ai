import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Logger } from '../../lib/logger';

declare module 'express-serve-static-core' {
  interface Request {
    id: string;
    log: Logger;
  }
}

const REQUEST_ID_HEADER = 'x-request-id';
const VALID_REQUEST_ID = /^[\w-]{1,128}$/;

/** Assigns a request id (honouring a sane incoming `x-request-id`), a child logger, and logs completion. */
export const requestLogger =
  (logger: Logger): RequestHandler =>
  (req, res, next) => {
    const incoming = req.get(REQUEST_ID_HEADER);
    req.id = incoming && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    req.log = logger.child({ requestId: req.id });
    res.setHeader(REQUEST_ID_HEADER, req.id);

    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      req.log[level](
        { method: req.method, path: req.path, status: res.statusCode, durationMs: Math.round(durationMs) },
        'request completed',
      );
    });
    next();
  };
