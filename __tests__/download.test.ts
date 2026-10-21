import axios from 'axios';
import { downloadJournalFile } from '../src/journal/processor';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    isAxiosError: (error: unknown) =>
      typeof error === 'object' && error !== null && 'isAxiosError' in error,
  },
}));

jest.mock('../src/clients', () => ({ prisma: {} }));
jest.mock('../src/portals', () => ({ registerPortal: jest.fn(), unregisterPortal: jest.fn() }));
jest.mock('../src/hubspot/subscriptions', () => ({ createContactSubscription: jest.fn() }));

const mockedGet = jest.mocked(axios.get);

const PRESIGNED_URL =
  'https://bucket.s3.amazonaws.com/journal/file.json?X-Amz-Credential=AKIA123&X-Amz-Signature=deadbeef';

describe('downloadJournalFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the downloaded journal file', async () => {
    mockedGet.mockResolvedValue({ data: { journalEvents: [] } });
    await expect(downloadJournalFile(PRESIGNED_URL)).resolves.toEqual({ journalEvents: [] });
  });

  it('reports the status and path but not the presigned query on HTTP failure', async () => {
    mockedGet.mockRejectedValue({
      isAxiosError: true,
      message: `Request failed with status code 403 for ${PRESIGNED_URL}`,
      response: { status: 403 },
    });

    const error = await downloadJournalFile(PRESIGNED_URL).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    const message = error instanceof Error ? error.message : '';
    expect(message).toBe(
      'Journal file download failed (403) for https://bucket.s3.amazonaws.com/journal/file.json?<redacted>'
    );
    expect(message).not.toContain('deadbeef');
    expect(message).not.toContain('X-Amz');
  });

  it('reports a network error when there is no response', async () => {
    mockedGet.mockRejectedValue(new Error('socket hang up'));

    await expect(downloadJournalFile(PRESIGNED_URL)).rejects.toThrow(
      'Journal file download failed (network error) for https://bucket.s3.amazonaws.com/journal/file.json?<redacted>'
    );
  });
});
