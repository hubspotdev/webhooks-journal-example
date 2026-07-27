import axios from 'axios';
import { getClientCredentialToken } from '../auth';
import { createLogger } from '../utils/logger';
import { HUBSPOT_API_BASE } from '../utils/utils';

const logger = createLogger('Filters');

export interface FilterCondition {
  filterType: string;
  property: string;
  operator: string;
  value?: string;
}

export interface FilterResponse {
  id: number;
  filter: { conditions: FilterCondition[] };
  createdAt: number;
}

export async function createFilter(
  subscriptionId: number,
  conditions: FilterCondition[]
): Promise<{ filterId: number }> {
  const token = await getClientCredentialToken();

  const sanitizedConditions = conditions.map((c) => {
    const condition: FilterCondition = {
      filterType: c.filterType,
      property: c.property,
      operator: c.operator,
    };
    if (c.operator !== 'IS_EMPTY' && c.operator !== 'IS_NOT_EMPTY' && c.value !== undefined) {
      condition.value = c.value;
    }
    return condition;
  });

  const response = await axios.post(
    `${HUBSPOT_API_BASE}/webhooks/v4/subscriptions/filters`,
    { subscriptionId, filter: { conditions: sanitizedConditions } },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  logger.info(`Filter created: filterId=${response.data.filterId} for subscription ${subscriptionId}`);
  return { filterId: response.data.filterId };
}

export async function getFiltersBySubscription(
  subscriptionId: number
): Promise<FilterResponse[]> {
  const token = await getClientCredentialToken();

  const response = await axios.get(
    `${HUBSPOT_API_BASE}/webhooks/v4/subscriptions/filters/subscription/${subscriptionId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  return response.data.results || response.data || [];
}

export async function deleteFilter(filterId: number): Promise<void> {
  const token = await getClientCredentialToken();

  await axios.delete(
    `${HUBSPOT_API_BASE}/webhooks/v4/subscriptions/filters/${filterId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  logger.info(`Filter deleted: id=${filterId}`);
}
