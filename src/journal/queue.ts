import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { createLogger } from '../utils/logger';

const logger = createLogger('Queue');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let connection: IORedis;

export function getRedisConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
    connection.on('error', (err) => logger.error('Redis connection error', err));
    connection.on('connect', () => logger.info('Connected to Redis'));
  }
  return connection;
}

export const JOURNAL_QUEUE_NAME = 'journal-entries';

export function createJournalQueue(): Queue {
  const queue = new Queue(JOURNAL_QUEUE_NAME, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 500 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    },
  });

  logger.info('Journal entry queue created');
  return queue;
}

export function createJournalWorker(
  processor: (job: Job) => Promise<void>,
  concurrency: number = 5
): Worker {
  // Concurrency > 1 means journal entries may be processed out of order. This is safe
  // because the processor uses occurredAt-based last-write-wins — a stale event never
  // overwrites a newer one regardless of processing order.
  const worker = new Worker(JOURNAL_QUEUE_NAME, processor, {
    connection: getRedisConnection(),
    concurrency,
  });

  worker.on('completed', (job) => {
    logger.debug(`Job ${job.id} completed for offset ${job.data.offset}`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Job ${job?.id} failed`, err);
  });

  worker.on('error', (err) => {
    logger.error('Worker error', err);
  });

  logger.info(`Journal worker started with concurrency=${concurrency}`);
  return worker;
}

export async function closeQueue(queue: Queue): Promise<void> {
  await queue.close();
  logger.info('Queue closed');
}
