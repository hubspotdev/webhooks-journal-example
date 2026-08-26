import { Router, Request, Response } from 'express';
import { Queue, Worker } from 'bullmq';
import { prisma } from '../clients';
import { startPolling, stopPolling, isPollingActive, resetCursorToLatest } from '../journal/poller';
import {
  createContactSubscription,
  getSubscriptions,
  updateSubscription,
  deleteSubscription,
  deletePortalSubscriptions,
} from '../hubspot/subscriptions';
import { createBulkSnapshot, getSnapshotStatus } from '../hubspot/snapshots';
import { populateTestData } from '../hubspot/contacts';
import { createFilter, getFiltersBySubscription, deleteFilter } from '../hubspot/filters';
import { AppError, asyncHandler } from '../utils/error';
import { createLogger } from '../utils/logger';

const logger = createLogger('JournalRoutes');

export function createJournalRouter(queue: Queue, worker: Worker): Router {
  const router = Router();

  router.post(
    '/journal/start',
    asyncHandler(async (req: Request, res: Response) => {
      const { portalId } = req.body;
      if (!portalId) throw new AppError('portalId is required', 400);

      await createContactSubscription(Number(portalId));
      startPolling(queue);
      res.json({ status: 'started', portalId });
    })
  );

  router.post(
    '/journal/stop',
    asyncHandler(async (_req: Request, res: Response) => {
      stopPolling();
      res.json({ status: 'stopped' });
    })
  );

  router.get(
    '/journal/status',
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ polling: isPollingActive() });
    })
  );

  router.get(
    '/subscriptions',
    asyncHandler(async (_req: Request, res: Response) => {
      const subs = await getSubscriptions();
      res.json(subs);
    })
  );

  // Create the default contact subscription for a portal. Useful for
  // re-subscribing after cleaning up subscriptions without restarting the
  // journal.
  router.post(
    '/subscriptions',
    asyncHandler(async (req: Request, res: Response) => {
      const { portalId } = req.body;
      if (!portalId) throw new AppError('portalId is required', 400);

      await createContactSubscription(Number(portalId));
      res.json({ created: true });
    })
  );

  // Delete every subscription for a portal. Registered before the
  // `/subscriptions/:subscriptionId` route so the literal `portals` segment is
  // matched here rather than being treated as a subscription ID.
  router.delete(
    '/subscriptions/portals/:portalId',
    asyncHandler(async (req: Request<{ portalId: string }>, res: Response) => {
      await deletePortalSubscriptions(Number(req.params.portalId));
      res.json({ deleted: true });
    })
  );

  router.delete(
    '/subscriptions/:subscriptionId',
    asyncHandler(async (req: Request<{ subscriptionId: string }>, res: Response) => {
      await deleteSubscription(Number(req.params.subscriptionId));
      res.json({ deleted: true });
    })
  );

  router.post(
    '/snapshot/bulk',
    asyncHandler(async (req: Request, res: Response) => {
      const { portalId } = req.body;
      if (!portalId) throw new AppError('portalId is required', 400);

      const result = await createBulkSnapshot(Number(portalId));
      res.json(result);
    })
  );

  router.get(
    '/snapshot/status/:statusId',
    asyncHandler(async (req: Request<{ statusId: string }>, res: Response) => {
      const status = await getSnapshotStatus(req.params.statusId);
      res.json(status ?? { status: 'PENDING' });
    })
  );

  router.delete(
    '/contacts',
    asyncHandler(async (_req: Request, res: Response) => {
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
        // Best-effort: make sure the worker isn't left paused before surfacing
        // the error to the error-handling middleware.
        try {
          worker.resume();
        } catch {
          /* best effort */
        }
        throw error;
      }
    })
  );

  router.post(
    '/test-data',
    asyncHandler(async (req: Request, res: Response) => {
      const { portalId } = req.body;
      if (!portalId) throw new AppError('portalId is required', 400);

      const result = await populateTestData(String(portalId));
      res.json(result);
    })
  );

  router.get(
    '/filters/:subscriptionId',
    asyncHandler(async (req: Request<{ subscriptionId: string }>, res: Response) => {
      const filters = await getFiltersBySubscription(Number(req.params.subscriptionId));
      res.json(filters);
    })
  );

  router.post(
    '/filters',
    asyncHandler(async (req: Request, res: Response) => {
      const { subscriptionId, conditions } = req.body;
      if (!subscriptionId || !conditions) {
        throw new AppError('subscriptionId and conditions are required', 400);
      }

      const result = await createFilter(Number(subscriptionId), conditions);
      res.json(result);
    })
  );

  router.delete(
    '/filters/:filterId',
    asyncHandler(async (req: Request<{ filterId: string }>, res: Response) => {
      await deleteFilter(Number(req.params.filterId));
      res.json({ deleted: true });
    })
  );

  router.put(
    '/subscriptions',
    asyncHandler(async (req: Request, res: Response) => {
      const { portalId, actions, properties, objectIds } = req.body;
      if (!portalId || !actions) {
        throw new AppError('portalId and actions are required', 400);
      }

      const result = await updateSubscription({
        objectTypeId: '0-1',
        subscriptionType: 'OBJECT',
        portalId: Number(portalId),
        actions,
        properties: properties || [],
        objectIds,
      });
      res.json(result);
    })
  );

  return router;
}
