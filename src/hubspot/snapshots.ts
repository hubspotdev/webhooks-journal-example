import axios from 'axios';
import { getClientCredentialToken } from '../auth';
import { prisma } from '../clients';
import { createLogger } from '../utils/logger';
import { SNAPSHOTS_API_BASE, JOURNAL_API_BASE } from '../utils/utils';
import { BulkSnapshotResponse, SnapshotStatusResponse } from '../types/common';

const logger = createLogger('Snapshots');

export async function createBulkSnapshot(
  portalId: number
): Promise<{ snapshotStatusId: string }> {
  const token = await getClientCredentialToken();

  const response = await axios.post<BulkSnapshotResponse>(
    `${SNAPSHOTS_API_BASE}/crm-bulk`,
    {
      installPortalId: portalId,
      objectTypeId: '0-1',
      propertyNameFilter: ['email', 'firstname', 'lastname'],
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  await prisma.snapshotJob.create({
    data: {
      snapshotStatusId: response.data.id,
      status: 'PENDING',
      portalId: String(portalId),
    },
  });

  logger.info(`Bulk snapshot initiated: statusId=${response.data.id}`);
  return { snapshotStatusId: response.data.id };
}

export async function getSnapshotStatus(
  statusId: string
): Promise<SnapshotStatusResponse | null> {
  const token = await getClientCredentialToken();

  try {
    const response = await axios.get<SnapshotStatusResponse>(
      `${JOURNAL_API_BASE}/status/${statusId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    await prisma.snapshotJob.update({
      where: { snapshotStatusId: statusId },
      data: { status: response.data.status },
    });

    return response.data;
  } catch (error: unknown) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return null;
    }
    throw error;
  }
}
