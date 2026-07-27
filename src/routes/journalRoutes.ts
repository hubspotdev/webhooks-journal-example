import { Router, Request, Response } from 'express';
import axios from 'axios';
import { Queue, Worker } from 'bullmq';
import { prisma } from '../clients';
import { startPolling, stopPolling, isPollingActive, resetCursorToLatest } from '../journal/poller';
import { createContactSubscription, getSubscriptions, updateSubscription } from '../hubspot/subscriptions';
import { createBulkSnapshot, getSnapshotStatus } from '../hubspot/snapshots';
import { populateTestData } from '../hubspot/contacts';
import { createFilter, getFiltersBySubscription, deleteFilter } from '../hubspot/filters';
import { createLogger } from '../utils/logger';

const logger = createLogger('JournalRoutes');

function extractErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    if (data?.message) return data.message;
    if (data?.error) return data.error;
    if (error.response?.status === 400) return `Bad request: ${data?.category || 'invalid parameters'}`;
    if (error.response?.status === 403) return 'Permission denied — check your app scopes';
    if (error.response?.status === 429) return 'Rate limit exceeded — try again shortly';
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

export function createJournalRouter(queue: Queue, worker: Worker): Router {
  const router = Router();

  router.post('/journal/start', async (req: Request, res: Response) => {
    const { portalId } = req.body;

    if (!portalId) {
      res.status(400).json({ error: 'portalId is required' });
      return;
    }

    try {
      await createContactSubscription(Number(portalId));
      startPolling(queue);
      res.json({ status: 'started', portalId });
    } catch (error) {
      logger.error('Failed to start journal processing', error as Error);
      res.status(500).json({ error: extractErrorMessage(error, 'Failed to start journal processing') });
    }
  });

  router.post('/journal/stop', async (_req: Request, res: Response) => {
    stopPolling();
    res.json({ status: 'stopped' });
  });

  router.get('/journal/status', async (_req: Request, res: Response) => {
    res.json({ polling: isPollingActive() });
  });

  router.get('/subscriptions', async (_req: Request, res: Response) => {
    try {
      const subs = await getSubscriptions();
      res.json(subs);
    } catch (error) {
      logger.error('Failed to fetch subscriptions', error as Error);
      res.status(500).json({ error: extractErrorMessage(error, 'Failed to fetch subscriptions') });
    }
  });

  router.post('/snapshot/bulk', async (req: Request, res: Response) => {
    const { portalId } = req.body;

    if (!portalId) {
      res.status(400).json({ error: 'portalId is required' });
      return;
    }

    try {
      const result = await createBulkSnapshot(Number(portalId));
      res.json(result);
    } catch (error) {
      logger.error('Failed to create bulk snapshot', error as Error);
      const status = axios.isAxiosError(error) ? (error.response?.status || 500) : 500;
      res.status(status).json({ error: extractErrorMessage(error, 'Failed to create bulk snapshot') });
    }
  });

  router.get('/snapshot/status/:statusId', async (req: Request<{ statusId: string }>, res: Response) => {
    try {
      const status = await getSnapshotStatus(req.params.statusId);
      if (!status) {
        res.json({ status: 'PENDING' });
        return;
      }
      res.json(status);
    } catch (error) {
      logger.error('Failed to get snapshot status', error as Error);
      res.status(500).json({ error: extractErrorMessage(error, 'Failed to get snapshot status') });
    }
  });

  router.delete('/contacts', async (_req: Request, res: Response) => {
    const wasPolling = isPollingActive();

    try {
      if (wasPolling) {
        stopPolling();
      }

      await worker.pause();
      await queue.drain();

      const result = await prisma.contact.deleteMany();
      await prisma.snapshotJob.deleteMany();

      await resetCursorToLatest();

      worker.resume();

      if (wasPolling) {
        startPolling(queue);
      }

      logger.info(`Cleared ${result.count} contacts, drained queue, reset cursor`);
      res.json({ deleted: result.count });
    } catch (error) {
      try { worker.resume(); } catch { /* best effort */ }
      logger.error('Failed to clear data', error as Error);
      res.status(500).json({ error: extractErrorMessage(error, 'Failed to clear data') });
    }
  });

  router.post('/test-data', async (req: Request, res: Response) => {
    const { portalId } = req.body;

    if (!portalId) {
      res.status(400).json({ error: 'portalId is required' });
      return;
    }

    try {
      const result = await populateTestData(String(portalId));
      res.json(result);
    } catch (error) {
      logger.error('Failed to populate test data', error as Error);
      res.status(500).json({ error: extractErrorMessage(error, 'Failed to populate test data') });
    }
  });

  router.get('/filters/:subscriptionId', async (req: Request<{ subscriptionId: string }>, res: Response) => {
    try {
      const filters = await getFiltersBySubscription(Number(req.params.subscriptionId));
      res.json(filters);
    } catch (error) {
      logger.error('Failed to fetch filters', error as Error);
      res.status(500).json({ error: extractErrorMessage(error, 'Failed to fetch filters') });
    }
  });

  router.post('/filters', async (req: Request, res: Response) => {
    const { subscriptionId, conditions } = req.body;

    if (!subscriptionId || !conditions) {
      res.status(400).json({ error: 'subscriptionId and conditions are required' });
      return;
    }

    try {
      const result = await createFilter(Number(subscriptionId), conditions);
      res.json(result);
    } catch (error) {
      logger.error('Failed to create filter', error as Error);
      res.status(500).json({ error: extractErrorMessage(error, 'Failed to create filter') });
    }
  });

  router.delete('/filters/:filterId', async (req: Request<{ filterId: string }>, res: Response) => {
    try {
      await deleteFilter(Number(req.params.filterId));
      res.json({ deleted: true });
    } catch (error) {
      logger.error('Failed to delete filter', error as Error);
      res.status(500).json({ error: extractErrorMessage(error, 'Failed to delete filter') });
    }
  });

  router.put('/subscriptions', async (req: Request, res: Response) => {
    const { portalId, actions, properties, objectIds } = req.body;

    if (!portalId || !actions) {
      res.status(400).json({ error: 'portalId and actions are required' });
      return;
    }

    try {
      const result = await updateSubscription({
        objectTypeId: '0-1',
        subscriptionType: 'OBJECT',
        portalId: Number(portalId),
        actions,
        properties: properties || [],
        objectIds,
      });
      res.json(result);
    } catch (error) {
      logger.error('Failed to update subscription', error as Error);
      res.status(500).json({ error: extractErrorMessage(error, 'Failed to update subscription') });
    }
  });

  return router;
}
