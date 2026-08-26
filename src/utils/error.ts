import { Request, Response, NextFunction, RequestHandler } from 'express';
import axios from 'axios';
import { createLogger } from './logger';

const logger = createLogger('ErrorHandler');

/**
 * Application-level error carrying an HTTP status code. Throw this from routes
 * or services when you want a specific status/message returned to the client;
 * the `errorHandler` middleware below translates it into a JSON response.
 */
export class AppError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
  }
}

/**
 * Normalizes any thrown value into a { statusCode, message } pair. Handles our
 * own AppError as well as axios errors bubbling up from the HubSpot API so the
 * upstream status/message is surfaced instead of a generic 500.
 */
function toHttpError(err: unknown): { statusCode: number; message: string } {
  if (err instanceof AppError) {
    return { statusCode: err.statusCode, message: err.message };
  }

  if (axios.isAxiosError(err)) {
    const status = err.response?.status ?? 500;
    const data = err.response?.data as
      | { message?: string; error?: string; category?: string }
      | undefined;
    const message =
      data?.message ||
      data?.error ||
      (status === 400 ? `Bad request: ${data?.category || 'invalid parameters'}` : '') ||
      (status === 403 ? 'Permission denied — check your app scopes' : '') ||
      (status === 429 ? 'Rate limit exceeded — try again shortly' : '') ||
      err.message;
    return { statusCode: status, message };
  }

  if (err instanceof Error) {
    return { statusCode: 500, message: err.message };
  }

  return { statusCode: 500, message: 'Internal server error' };
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const { statusCode, message } = toHttpError(err);

  if (statusCode >= 500) {
    logger.error('Unhandled error', err);
  } else {
    logger.warn(`Request failed (${statusCode}): ${message}`);
  }

  res.status(statusCode).json({ error: message });
}

/**
 * Wraps an async route handler so rejected promises (including thrown
 * AppErrors) are forwarded to Express's error middleware. Without this, thrown
 * errors in async handlers become unhandled rejections in Express 4 rather than
 * reaching `errorHandler`.
 */
export function asyncHandler<P = Record<string, string>>(
  fn: (req: Request<P>, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler<P> {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
