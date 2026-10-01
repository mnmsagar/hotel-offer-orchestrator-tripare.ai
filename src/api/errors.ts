/** An error that maps directly to an HTTP status and a client-safe message. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'HttpError';
  }
}
