import { PrismaClient } from '@prisma/client';
import * as hubspot from '@hubspot/api-client';

export const prisma = new PrismaClient();

export const LIMITER_OPTIONS = {
  minTime: 1000 / 9,
  maxConcurrent: 6,
  id: 'hubspot-client-limiter',
};

export const hubspotClient = new hubspot.Client({
  limiterOptions: LIMITER_OPTIONS,
});
