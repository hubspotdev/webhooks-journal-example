import axios from 'axios';
import { faker } from '@faker-js/faker';
import { authenticateHubspotClientForPortal } from '../auth';
import { createLogger } from '../utils/logger';

const logger = createLogger('TestData');

export async function populateTestData(portalId: string): Promise<{ created: number; skipped: number }> {
  const client = await authenticateHubspotClientForPortal(portalId);
  let created = 0;
  let skipped = 0;

  for (let i = 0; i < 10; i++) {
    const firstname = faker.person.firstName();
    const lastname = faker.person.lastName();
    const email = faker.internet.email({ firstName: firstname, lastName: lastname });

    try {
      await client.crm.contacts.basicApi.create({
        properties: { email, firstname, lastname },
        associations: [],
      });
      logger.info(`Created test contact: ${firstname} ${lastname}`);
      created++;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        skipped++;
        logger.debug(`Skipped duplicate contact ${email}`);
      } else {
        logger.error(`Failed to create contact ${email}`, error as Error);
      }
    }
  }

  logger.info(`Test data population complete: ${created} created`);
  return { created, skipped };
}
