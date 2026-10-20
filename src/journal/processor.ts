import axios from 'axios';
import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { prisma } from '../clients';
import { registerPortal, unregisterPortal } from '../portals';
import { createContactSubscription } from '../hubspot/subscriptions';
import { createLogger } from '../utils/logger';
import { JournalEvent, JournalEventItem, CrmObjectEvent, AppLifecycleEvent } from '../types/common';

const logger = createLogger('EventProcessor');

async function downloadJournalFile(url: string): Promise<JournalEvent> {
  const response = await axios.get<JournalEvent>(url);
  return response.data;
}

function extractProperties(event: CrmObjectEvent): Record<string, string> {
  return event.propertyChanges || event.properties || {};
}

async function upsertContact(event: CrmObjectEvent, tx: Prisma.TransactionClient): Promise<void> {
  const hsObjectId = String(event.objectId);
  const portalId = String(event.portalId);
  const occurredAt = new Date(event.occurredAt);
  const properties = extractProperties(event);

  if (event.action === 'SNAPSHOT') {
    logger.info(`SNAPSHOT event for contact ${hsObjectId} (portal ${portalId}), properties: ${JSON.stringify(properties)}`);
  }

  const email = 'email' in properties ? properties.email : undefined;
  const firstname = 'firstname' in properties ? properties.firstname : undefined;
  const lastname = 'lastname' in properties ? properties.lastname : undefined;

  // Atomic upsert with last-write-wins: only update if incoming event is newer
  const result = await tx.$executeRaw`
    INSERT INTO "Contact" ("hsObjectId", "portalId", "email", "firstname", "lastname", "lastModifiedDate", "createdAt", "updatedAt")
    VALUES (${hsObjectId}, ${portalId}, ${email ?? null}, ${firstname ?? null}, ${lastname ?? null}, ${occurredAt}, NOW(), NOW())
    ON CONFLICT ("hsObjectId", "portalId") DO UPDATE SET
      "email" = COALESCE(${email ?? null}, "Contact"."email"),
      "firstname" = COALESCE(${firstname ?? null}, "Contact"."firstname"),
      "lastname" = COALESCE(${lastname ?? null}, "Contact"."lastname"),
      "lastModifiedDate" = ${occurredAt},
      "updatedAt" = NOW()
    WHERE "Contact"."lastModifiedDate" IS NULL OR "Contact"."lastModifiedDate" < ${occurredAt}
  `;

  if (result > 0) {
    logger.info(`Upserted contact ${hsObjectId} for portal ${portalId} (action: ${event.action})`);
  } else {
    logger.debug(`Skipping stale event for contact ${hsObjectId} (last-write-wins)`);
  }
}

async function deleteContact(event: CrmObjectEvent, tx: Prisma.TransactionClient): Promise<void> {
  const hsObjectId = String(event.objectId);
  const portalId = String(event.portalId);
  const occurredAt = new Date(event.occurredAt);

  const result = await tx.$executeRaw`
    DELETE FROM "Contact"
    WHERE "hsObjectId" = ${hsObjectId}
    AND "portalId" = ${portalId}
    AND ("lastModifiedDate" IS NULL OR "lastModifiedDate" <= ${occurredAt})
  `;

  if (result > 0) {
    logger.info(`Deleted contact ${hsObjectId} from portal ${portalId}`);
  } else {
    logger.debug(`Contact ${hsObjectId} not found or has newer data, skipping delete`);
  }
}

async function handleMerge(event: CrmObjectEvent, tx: Prisma.TransactionClient): Promise<void> {
  const survivorId = String(event.objectId);
  const portalId = String(event.portalId);
  const mergedIds = event.mergedObjectIds || [];

  for (const mergedId of mergedIds) {
    try {
      await tx.contact.delete({
        where: {
          hsObjectId_portalId: { hsObjectId: String(mergedId), portalId },
        },
      });
      logger.info(`Deleted merged contact ${mergedId} (merged into ${survivorId})`);
    } catch {
      logger.debug(`Merged contact ${mergedId} not found, skipping`);
    }
  }

  await upsertContact(event, tx);
}

async function processEvent(event: CrmObjectEvent, tx: Prisma.TransactionClient): Promise<void> {
  if (event.objectTypeId !== '0-1') {
    logger.debug(`Skipping non-contact event (objectTypeId: ${event.objectTypeId})`);
    return;
  }

  switch (event.action) {
    case 'CREATE':
    case 'UPDATE':
    case 'RESTORE':
    case 'SNAPSHOT':
      await upsertContact(event, tx);
      break;
    case 'DELETE':
      await deleteContact(event, tx);
      break;
    case 'MERGE':
      await handleMerge(event, tx);
      break;
    default:
      logger.warn(`Unknown action: ${event.action}`);
  }
}

function isAppLifecycleEvent(event: JournalEventItem): event is AppLifecycleEvent {
  return event.type === 'appLifecycleEvent';
}

async function handleAppLifecycleEvent(event: AppLifecycleEvent): Promise<void> {
  const portalId = String(event.portalId);

  switch (event.action) {
    case 'APP_INSTALL':
      logger.info(`App installed on portal ${portalId}`);
      await registerPortal(portalId);
      // A portal just installed our app. This is where an integration
      // dynamically provisions the subscriptions a new customer needs — no
      // manual per-portal setup required. Here we create the default contact
      // subscription so contact events start flowing for the portal right away.
      await createContactSubscription(event.portalId);
      break;
    case 'APP_UNINSTALL':
      logger.info(`App uninstalled from portal ${portalId}`);
      // Drop the portal from our registry so it leaves the UI. We intentionally
      // don't delete its subscriptions — the Webhooks Journal service removes an
      // app's subscriptions for a portal automatically on uninstall.
      await unregisterPortal(portalId);
      break;
    default:
      logger.warn(`Unknown app lifecycle action: ${event.action}`);
  }
}

export async function processJournalJob(job: Job): Promise<void> {
  const { url, offset } = job.data;

  logger.debug(`Processing journal entry at offset ${offset}`);

  const journalFile = await downloadJournalFile(url);
  const events = journalFile.journalEvents;
  const lifecycleEvents = events.filter(isAppLifecycleEvent);
  const crmEvents = events.filter((e): e is CrmObjectEvent => !isAppLifecycleEvent(e));

  // CRM events are reconciled together in one DB transaction. Lifecycle events
  // are handled separately since they make HubSpot API calls (subscription
  // provisioning) that shouldn't run inside a DB transaction.
  await prisma.$transaction(async (tx) => {
    for (const event of crmEvents) {
      await processEvent(event, tx);
    }
  });

  for (const event of lifecycleEvents) {
    await handleAppLifecycleEvent(event);
  }

  logger.debug(`Processed ${events.length} events from offset ${offset}`);
}
