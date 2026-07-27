import { Router, Request, Response } from 'express';
import { prisma } from '../clients';
import { createLogger } from '../utils/logger';

const logger = createLogger('ContactRoutes');
const router = Router();

router.get('/contacts', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const portalId = req.query.portalId as string | undefined;

    const where = portalId && portalId !== 'all' ? { portalId } : {};

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.contact.count({ where }),
    ]);

    res.json({ contacts, total });
  } catch (error) {
    logger.error('Failed to fetch contacts', error as Error);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// DELETE /contacts is handled in journalRoutes (needs access to the queue)

export default router;
