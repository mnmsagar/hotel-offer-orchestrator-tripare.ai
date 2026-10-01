import type { z } from 'zod';
import { HttpError } from '../errors';

/** Parses `input` with `schema`, throwing a 400 HttpError with the first issue's message on failure. */
export const parseOrThrow = <S extends z.ZodType>(schema: S, input: unknown): z.output<S> => {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    throw new HttpError(400, `${field}${issue?.message ?? 'Invalid request'}`);
  }
  return result.data;
};
