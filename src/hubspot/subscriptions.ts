import axios from 'axios';
import { getClientCredentialToken } from '../auth';
import { createLogger } from '../utils/logger';
import {
  SUBSCRIPTIONS_API_BASE,
  APP_INSTALL_EVENT_TYPE_ID,
  APP_UNINSTALL_EVENT_TYPE_ID,
} from '../utils/utils';

const logger = createLogger('Subscriptions');

// Creates the app-global APP_LIFECYCLE_EVENT subscriptions (install + uninstall).
// Unlike other subscription types, these are keyed by app + eventTypeId — they
// take no portalId and no actions, so a single pair covers every portal that
// installs or uninstalls the app. Intended to be called once on startup;
// creation is idempotent (an existing subscription returns 409, which we skip).
export async function subscribeToAppLifecycleEvents(): Promise<void> {
  const lifecycleEvents = [
    { name: 'install', eventTypeId: APP_INSTALL_EVENT_TYPE_ID },
    { name: 'uninstall', eventTypeId: APP_UNINSTALL_EVENT_TYPE_ID },
  ].filter((e) => e.eventTypeId);

  if (lifecycleEvents.length === 0) {
    logger.warn(
      'APP_INSTALL_EVENT_TYPE_ID / APP_UNINSTALL_EVENT_TYPE_ID not set — skipping app-lifecycle subscription setup'
    );
    return;
  }

  const token = await getClientCredentialToken();

  for (const { name, eventTypeId } of lifecycleEvents) {
    try {
      const response = await axios.post(
        SUBSCRIPTIONS_API_BASE,
        { subscriptionType: 'APP_LIFECYCLE_EVENT', eventTypeId, properties: [] },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
      logger.info(`App-lifecycle (${name}) subscription created: id=${response.data.id}`);
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        logger.info(`App-lifecycle (${name}) subscription already exists, skipping`);
        continue;
      }
      // Don't block startup if lifecycle subscription setup fails.
      logger.error(`Failed to create app-lifecycle (${name}) subscription`, error as Error);
    }
  }
}

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
      SUBSCRIPTIONS_API_BASE,
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
    SUBSCRIPTIONS_API_BASE,
    data,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return response.data;
}

export async function getSubscriptions(): Promise<unknown[]> {
  const token = await getClientCredentialToken();

  const response = await axios.get(SUBSCRIPTIONS_API_BASE, {
    headers: { Authorization: `Bearer ${token}` },
  });

  return response.data.results || [];
}

// Deletes a single subscription by ID. Use this to clean up individual
// subscriptions your integration no longer needs — the docs recommend removing
// unused subscriptions to keep event delivery efficient.
export async function deleteSubscription(subscriptionId: number): Promise<void> {
  const token = await getClientCredentialToken();

  await axios.delete(`${SUBSCRIPTIONS_API_BASE}/${subscriptionId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  logger.info(`Subscription deleted: id=${subscriptionId}`);
}

// Deletes every subscription for a given portal in one call. Handy when
// uninstalling a portal or resetting an integration's subscription state.
export async function deletePortalSubscriptions(portalId: number): Promise<void> {
  const token = await getClientCredentialToken();

  await axios.delete(`${SUBSCRIPTIONS_API_BASE}/portals/${portalId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  logger.info(`All subscriptions deleted for portal ${portalId}`);
}
