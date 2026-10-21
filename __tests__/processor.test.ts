import { Server } from 'http';
import express from 'express';
import { prisma } from '../src/clients';
import { processEvent } from '../src/journal/processor';
import contactRoutes from '../src/routes/contactRoutes';
import { CrmObjectEvent } from '../src/types/common';

jest.mock('../src/portals', () => ({
  registerPortal: jest.fn(),
  unregisterPortal: jest.fn(),
}));

jest.mock('../src/hubspot/subscriptions', () => ({
  createContactSubscription: jest.fn(),
}));

const PORTAL_ID = 111;
const OBJECT_ID = 222;
const T0 = '2025-12-31T00:00:00.000Z';
const T1 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-01-02T00:00:00.000Z';
const T3 = '2026-01-03T00:00:00.000Z';

const hasTestDatabase = (process.env.DATABASE_URL ?? '').includes('_test');
const describeWithDb = hasTestDatabase ? describe : describe.skip;

function crmEvent(
  action: CrmObjectEvent['action'],
  occurredAt: string,
  propertyChanges?: Record<string, string>,
): CrmObjectEvent {
  return {
    type: 'crmObjectEvent',
    portalId: PORTAL_ID,
    occurredAt,
    action,
    objectTypeId: '0-1',
    objectId: OBJECT_ID,
    propertyChanges,
  };
}

async function processAll(events: CrmObjectEvent[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const event of events) {
      await processEvent(event, tx);
    }
  });
}

async function findContact() {
  return prisma.contact.findUnique({
    where: { hsObjectId_portalId: { hsObjectId: String(OBJECT_ID), portalId: String(PORTAL_ID) } },
  });
}

describeWithDb('contact soft delete reconciliation', () => {
  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "Contact" RESTART IDENTITY`;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('soft-deletes on DELETE and keeps the contact data', async () => {
    await processAll([
      crmEvent('CREATE', T1, { email: 'a@example.com', firstname: 'Ada', lastname: 'Lovelace' }),
      crmEvent('DELETE', T2),
    ]);

    const contact = await findContact();
    expect(contact?.deletedAt).not.toBeNull();
    expect(contact?.deletedAt).toEqual(contact?.lastModifiedDate);
    expect(contact?.email).toBe('a@example.com');
    expect(contact?.firstname).toBe('Ada');
    expect(contact?.lastname).toBe('Lovelace');
  });

  it('brings the original data back on RESTORE without any properties', async () => {
    await processAll([
      crmEvent('CREATE', T1, { email: 'a@example.com', firstname: 'Ada', lastname: 'Lovelace' }),
      crmEvent('DELETE', T2),
      crmEvent('RESTORE', T3),
    ]);

    const contact = await findContact();
    expect(contact?.deletedAt).toBeNull();
    expect(contact?.email).toBe('a@example.com');
    expect(contact?.firstname).toBe('Ada');
    expect(contact?.lastname).toBe('Lovelace');
  });

  it('keeps a contact deleted when an older UPDATE is processed after the DELETE', async () => {
    await processAll([
      crmEvent('CREATE', T0, { email: 'a@example.com' }),
      crmEvent('DELETE', T2),
    ]);
    const deleted = await findContact();

    await processAll([crmEvent('UPDATE', T1, { email: 'stale@example.com' })]);

    const contact = await findContact();
    expect(contact?.deletedAt).not.toBeNull();
    expect(contact?.deletedAt).toEqual(deleted?.deletedAt);
    expect(contact?.lastModifiedDate).toEqual(deleted?.lastModifiedDate);
    expect(contact?.email).toBe('a@example.com');
  });

  it('writes a tombstone for an unknown contact so an older CREATE cannot resurrect it', async () => {
    await processAll([crmEvent('DELETE', T2)]);

    const tombstone = await findContact();
    expect(tombstone?.deletedAt).not.toBeNull();
    expect(tombstone?.email).toBeNull();

    await processAll([crmEvent('CREATE', T1, { email: 'a@example.com' })]);

    const contact = await findContact();
    expect(contact?.deletedAt).toEqual(tombstone?.deletedAt);
    expect(contact?.email).toBeNull();
  });

  it('un-deletes when a newer UPDATE arrives after the DELETE', async () => {
    await processAll([
      crmEvent('CREATE', T1, { email: 'a@example.com' }),
      crmEvent('DELETE', T2),
      crmEvent('UPDATE', T3, { firstname: 'Ada' }),
    ]);

    const contact = await findContact();
    expect(contact?.deletedAt).toBeNull();
    expect(contact?.email).toBe('a@example.com');
    expect(contact?.firstname).toBe('Ada');
  });

  it('un-deletes when a newer SNAPSHOT arrives after the DELETE', async () => {
    await processAll([
      crmEvent('CREATE', T1, { email: 'a@example.com' }),
      crmEvent('DELETE', T2),
    ]);
    await processAll([
      {
        ...crmEvent('SNAPSHOT', T3),
        propertyChanges: undefined,
        properties: { email: 'a@example.com', firstname: 'Ada', lastname: 'Lovelace' },
      },
    ]);

    const contact = await findContact();
    expect(contact?.deletedAt).toBeNull();
    expect(contact?.lastname).toBe('Lovelace');
  });

  it('hard-deletes merged contacts', async () => {
    await processAll([crmEvent('CREATE', T1, { email: 'merged@example.com' })]);

    await processAll([
      {
        ...crmEvent('MERGE', T2, { email: 'survivor@example.com' }),
        objectId: OBJECT_ID + 1,
        mergedObjectIds: [OBJECT_ID],
      },
    ]);

    expect(await findContact()).toBeNull();
    const survivor = await prisma.contact.findUnique({
      where: { hsObjectId_portalId: { hsObjectId: String(OBJECT_ID + 1), portalId: String(PORTAL_ID) } },
    });
    expect(survivor?.email).toBe('survivor@example.com');
  });

  describe('GET /api/contacts', () => {
    let server: Server;
    let baseUrl: string;

    beforeAll(async () => {
      const app = express();
      app.use('/api', contactRoutes);
      await new Promise<void>((resolve) => {
        server = app.listen(0, () => resolve());
      });
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Test server did not bind to a port');
      }
      baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('excludes soft-deleted contacts from the list and the total', async () => {
      await processAll([
        crmEvent('CREATE', T1, { email: 'gone@example.com' }),
        crmEvent('DELETE', T2),
        { ...crmEvent('CREATE', T1, { email: 'kept@example.com' }), objectId: OBJECT_ID + 1 },
      ]);

      const response = await fetch(`${baseUrl}/api/contacts`);
      const body: unknown = await response.json();

      expect(body).toMatchObject({ total: 1, contacts: [{ email: 'kept@example.com' }] });
      expect(body).toHaveProperty('contacts.length', 1);
    });
  });
});
