import { Request, Response, NextFunction } from 'express';
import { createLogger } from './logger';

const logger = createLogger('ErrorHandler');

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  logger.error('Unhandled error', err);

  if ('statusCode' in err) {
    const statusCode = (err as Error & { statusCode: number }).statusCode;
    res.status(statusCode).json({ error: err.message });
    return;
  }

  res.status(500).json({ error: 'Internal server error' });
}

export class AppError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
  }
}
