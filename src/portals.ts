import { prisma } from './clients';
import { createLogger } from './utils/logger';

const logger = createLogger('Portals');

/**
 * Tracks which portals this app currently knows about. The portal dropdown in
 * the UI reads from this registry. Entries are added when a portal installs the
 * app (either via the OAuth flow or an APP_LIFECYCLE install event) and removed
 * on uninstall.
 */
export async function registerPortal(portalId: string): Promise<void> {
  await prisma.portal.upsert({
    where: { portalId },
    update: {},
    create: { portalId },
  });
  logger.info(`Registered portal ${portalId}`);
}

export async function unregisterPortal(portalId: string): Promise<void> {
  const { count } = await prisma.portal.deleteMany({ where: { portalId } });
  if (count > 0) {
    logger.info(`Unregistered portal ${portalId}`);
  }
}

export async function getKnownPortals(): Promise<string[]> {
  const portals = await prisma.portal.findMany({
    orderBy: { installedAt: 'asc' },
    select: { portalId: true },
  });
  return portals.map((p) => p.portalId);
}

// One-time backfill so portals that installed via OAuth before this registry
// existed still show up in the dropdown.
export async function backfillPortalsFromAuthorizations(): Promise<void> {
  const auths = await prisma.authorization.findMany({
    select: { hsPortalId: true },
    distinct: ['hsPortalId'],
  });
  for (const auth of auths) {
    await registerPortal(auth.hsPortalId);
  }
}
