import { Router, Request, Response } from 'express';
import { buildAuthUrl } from '../auth';
import { getKnownPortals } from '../portals';

const router = Router();

router.get('/install', (req: Request, res: Response) => {
  const portalId = req.query.portalId as string | undefined;
  res.json({ authUrl: buildAuthUrl(portalId) });
});

router.get('/auth-status', async (_req: Request, res: Response) => {
  try {
    const { prisma } = await import('../clients');
    const auth = await prisma.authorization.findFirst();
    res.json({ installed: !!auth, portalId: auth?.hsPortalId || null });
  } catch {
    res.json({ installed: false, portalId: null });
  }
});

router.get('/portals', async (_req: Request, res: Response) => {
  try {
    const portals = await getKnownPortals();
    res.json(portals);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch installed portals' });
  }
});

export default router;
