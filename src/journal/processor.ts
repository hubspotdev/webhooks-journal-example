import axios from 'axios';
import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { prisma } from '../clients';
import { createLogger } from '../utils/logger';
import { JournalEvent, CrmObjectEvent } from '../types/common';

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

export async function processJournalJob(job: Job): Promise<void> {
  const { url, offset } = job.data;

  logger.debug(`Processing journal entry at offset ${offset}`);

  const journalFile = await downloadJournalFile(url);

  await prisma.$transaction(async (tx) => {
    for (const event of journalFile.journalEvents) {
      await processEvent(event, tx);
    }
  });

  logger.debug(`Processed ${journalFile.journalEvents.length} events from offset ${offset}`);
}
