import axios from 'axios';
import { getClientCredentialToken } from '../auth';
import { createLogger } from '../utils/logger';
import { HUBSPOT_API_BASE } from '../utils/utils';

const logger = createLogger('Subscriptions');

export async function createContactSubscription(portalId: number): Promise<void> {
  const token = await getClientCredentialToken();

  const subscriptionData = {
    objectTypeId: '0-1',
    subscriptionType: 'OBJECT',
    portalId,
    actions: ['CREATE', 'UPDATE', 'DELETE', 'MERGE', 'RESTORE'],
    properties: ['firstname', 'lastname', 'email'],
  };

  try {
    const response = await axios.post(
      `${HUBSPOT_API_BASE}/webhooks/v4/subscriptions`,
      subscriptionData,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    logger.info(`Subscription created: id=${response.data.id} for portal ${portalId}`);
  } catch (error: unknown) {
    if (axios.isAxiosError(error) && error.response?.status === 409) {
      logger.info('Subscription already exists, skipping creation');
      return;
    }
    logger.error('Failed to create subscription', error as Error);
    throw error;
  }
}

export async function updateSubscription(data: {
  objectTypeId: string;
  subscriptionType: string;
  portalId: number;
  actions: string[];
  properties: string[];
  objectIds?: number[];
}): Promise<unknown> {
  const token = await getClientCredentialToken();
  const response = await axios.post(
    `${HUBSPOT_API_BASE}/webhooks/v4/subscriptions`,
    data,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return response.data;
}

export async function getSubscriptions(): Promise<unknown[]> {
  const token = await getClientCredentialToken();

  const response = await axios.get(`${HUBSPOT_API_BASE}/webhooks/v4/subscriptions`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  return response.data.results || [];
}
