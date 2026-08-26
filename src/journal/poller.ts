import axios from 'axios';
import { Queue } from 'bullmq';
import { prisma } from '../clients';
import { getClientCredentialToken } from '../auth';
import { createLogger } from '../utils/logger';
import { requestWithRetry } from '../utils/retry';
import { HUBSPOT_API_BASE, JOURNAL_POLL_INTERVAL_MS, JOURNAL_BATCH_SIZE } from '../utils/utils';
import { JournalEntry, JournalBatchResponse } from '../types/common';

const logger = createLogger('JournalPoller');

let pollingInterval: ReturnType<typeof setInterval> | null = null;
let isPolling = false;

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getClientCredentialToken();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

const ALL_PORTALS_KEY = 'all';

async function fetchLatestEntry(): Promise<JournalEntry | null> {
  try {
    const headers = await getAuthHeaders();
    const response = await requestWithRetry(() =>
      axios.get(`${HUBSPOT_API_BASE}/webhooks/v4/journal/latest`, { headers })
    );
    return response.data;
  } catch (error: unknown) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

// Poll all portals — the journal is app-scoped. Each event carries a portalId field
// that the processor uses to store contacts per-portal. Filtering is done at the API
// layer when returning contacts to the frontend.
async function fetchBatchNext(
  offset: string,
  count: number
): Promise<JournalBatchResponse> {
  const headers = await getAuthHeaders();
  const response = await requestWithRetry(() =>
    axios.get(`${HUBSPOT_API_BASE}/webhooks/v4/journal/batch/${offset}/next/${count}`, { headers })
  );
  return response.data;
}

async function retryFailedOffsets(offsets: string[]): Promise<JournalBatchResponse> {
  const headers = await getAuthHeaders();
  const response = await requestWithRetry(() =>
    axios.post(`${HUBSPOT_API_BASE}/webhooks/v4/journal/batch/read`, { inputs: offsets }, { headers })
  );
  return response.data;
}

async function pollOnce(queue: Queue): Promise<void> {
  if (isPolling) return;
  isPolling = true;

  try {
    let cursor = await prisma.journalCursor.findUnique({
      where: { portalId: ALL_PORTALS_KEY },
    });

    if (!cursor) {
      logger.info('No cursor found, fetching latest journal entry to initialize...');
      const latest = await fetchLatestEntry();
      if (!latest) {
        logger.info('No journal entries available yet');
        return;
      }

      cursor = await prisma.journalCursor.create({
        data: { portalId: ALL_PORTALS_KEY, currentOffset: latest.currentOffset },
      });

      await queue.add('process-entry', {
        url: latest.url,
        offset: latest.currentOffset,
        expiresAt: latest.expiresAt,
      });

      logger.info(`Initialized cursor at offset ${latest.currentOffset}`);
      return;
    }

    if (!cursor.currentOffset) {
      logger.info('Cursor has no offset, waiting for journal entries...');
      return;
    }

    // The batch endpoint returns entries in a deterministic order. The offset UUIDs may
    // not be in monotonically increasing order, but the array position IS the correct
    // sequence. Treat offsets as opaque pagination cursors, not sortable identifiers.
    const batch = await fetchBatchNext(cursor.currentOffset, JOURNAL_BATCH_SIZE);

    // TODO(2027-03-beta migration): once we move to the 2027-03-beta journal
    // endpoints, `batch/next` returns 404 on an invalid/aged-out offset (handled
    // in the catch below), so no client-side stale-cursor recovery is needed.
    if (batch.results.length === 0 && batch.numErrors === 0) {
      logger.debug('No new journal entries');
      return;
    }

    logger.info(`Fetched ${batch.results.length} journal entries`);

    // Enqueue successful entries
    if (batch.results.length > 0) {
      await queue.addBulk(
        batch.results.map((entry) => ({
          name: 'process-entry',
          data: {
            url: entry.url,
            offset: entry.currentOffset,
            expiresAt: entry.expiresAt,
          },
        }))
      );
    }

    // Retry failed offsets
    if (batch.numErrors > 0) {
      const failedOffsets = batch.errors
        .map((e) => e.context?.offset?.[0])
        .filter((o): o is string => !!o);

      if (failedOffsets.length > 0) {
        logger.warn(`Retrying ${failedOffsets.length} failed offsets`);
        try {
          const retryResponse = await retryFailedOffsets(failedOffsets);
          if (retryResponse.results.length > 0) {
            await queue.addBulk(
              retryResponse.results.map((entry) => ({
                name: 'process-entry',
                data: {
                  url: entry.url,
                  offset: entry.currentOffset,
                  expiresAt: entry.expiresAt,
                },
              }))
            );
          }
          if (retryResponse.numErrors > 0) {
            const stillFailed = retryResponse.errors.map((e) => e.context?.offset?.[0]).filter(Boolean);
            logger.error(`${stillFailed.length} offsets failed after retry: ${stillFailed.join(', ')}`);
          }
        } catch (error) {
          logger.error(`Failed to retry offsets: ${failedOffsets.join(', ')}`, error as Error);
        }
      }
    }

    // Advance cursor to the last entry in the batch. This is always the correct cursor
    // for the next poll — the next batch will start immediately after this offset with
    // no overlap or gaps. If the last entries in the batch failed presigning, the cursor
    // stays at the last successful entry and the failed entries will be re-fetched on
    // the next poll (the processor's occurredAt guard handles any duplicates safely).
    const lastOffset = batch.results[batch.results.length - 1]?.currentOffset;
    if (lastOffset) {
      await prisma.journalCursor.update({
        where: { portalId: ALL_PORTALS_KEY },
        data: { currentOffset: lastOffset },
      });
      logger.debug(`Updated cursor to offset ${lastOffset}`);
    }
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status === 401 || status === 403) {
        logger.warn('Auth error during polling, token may need refresh');
      } else if (status === 429) {
        logger.warn('Still rate limited after backoff retries, will retry next cycle');
      } else if (status === 404) {
        logger.debug('No entries found at current offset');
      } else {
        logger.error('API error during polling', error);
      }
    } else {
      logger.error('Unexpected error during polling', error as Error);
    }
  } finally {
    isPolling = false;
  }
}

export function startPolling(queue: Queue): void {
  if (pollingInterval) {
    logger.warn('Polling already running');
    return;
  }

  logger.info(`Starting journal polling for all portals every ${JOURNAL_POLL_INTERVAL_MS}ms`);

  pollOnce(queue);
  pollingInterval = setInterval(() => pollOnce(queue), JOURNAL_POLL_INTERVAL_MS);
}

export function stopPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    logger.info('Journal polling stopped');
  }
}

export function isPollingActive(): boolean {
  return pollingInterval !== null;
}

export async function resetCursorToLatest(): Promise<void> {
  const latest = await fetchLatestEntry();
  if (latest) {
    await prisma.journalCursor.upsert({
      where: { portalId: ALL_PORTALS_KEY },
      update: { currentOffset: latest.currentOffset },
      create: { portalId: ALL_PORTALS_KEY, currentOffset: latest.currentOffset },
    });
    logger.info(`Reset cursor to latest offset ${latest.currentOffset}`);
  } else {
    await prisma.journalCursor.deleteMany({ where: { portalId: ALL_PORTALS_KEY } });
    logger.info('No journal entries available, cleared cursor');
  }
}
