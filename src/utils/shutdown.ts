import { Server } from 'http';
import { PrismaClient } from '@prisma/client';
import { createLogger } from './logger';

const logger = createLogger('Shutdown');

export function setupGracefulShutdown(server: Server, prisma: PrismaClient, onShutdown?: () => Promise<void>): void {
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    server.close(async () => {
      logger.info('HTTP server closed');
      await onShutdown?.();
      await prisma.$disconnect();
      logger.info('Database connection closed');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
