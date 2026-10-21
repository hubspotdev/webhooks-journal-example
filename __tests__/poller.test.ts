import axios from 'axios';
import { prisma } from '../src/clients';
import { fetchBatchNext, resetCursorToLatest } from '../src/journal/poller';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    isAxiosError: (error: unknown) =>
      typeof error === 'object' && error !== null && 'isAxiosError' in error,
  },
}));

jest.mock('../src/clients', () => ({
  prisma: {
    journalCursor: { upsert: jest.fn(), deleteMany: jest.fn() },
  },
}));

jest.mock('../src/auth', () => ({
  getClientCredentialToken: jest.fn(async () => 'test-token'),
}));

const mockedGet = jest.mocked(axios.get);
const mockedCursor = jest.mocked(prisma.journalCursor);

describe('resetCursorToLatest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('clears the cursor when the journal returns 204 No Content', async () => {
    mockedGet.mockResolvedValueOnce({ status: 204, data: '' });

    await resetCursorToLatest();

    expect(mockedGet).toHaveBeenCalledWith(
      expect.stringMatching(/\/latest$/),
      expect.anything()
    );
    expect(mockedCursor.deleteMany).toHaveBeenCalledWith({ where: { portalId: 'all' } });
    expect(mockedCursor.upsert).not.toHaveBeenCalled();
  });

  it('surfaces a 404 instead of treating it as an empty journal', async () => {
    const notFound = { isAxiosError: true, message: 'Not Found', response: { status: 404 } };
    mockedGet.mockRejectedValueOnce(notFound);

    await expect(resetCursorToLatest()).rejects.toBe(notFound);
    expect(mockedCursor.deleteMany).not.toHaveBeenCalled();
    expect(mockedCursor.upsert).not.toHaveBeenCalled();
  });

  it('moves the cursor to the latest offset when an entry is returned', async () => {
    mockedGet.mockResolvedValueOnce({
      status: 200,
      data: { url: 'https://example.com/entry', expiresAt: '2026-10-21T00:00:00Z', currentOffset: 'offset-1' },
    });

    await resetCursorToLatest();

    expect(mockedCursor.upsert).toHaveBeenCalledWith({
      where: { portalId: 'all' },
      update: { currentOffset: 'offset-1' },
      create: { portalId: 'all', currentOffset: 'offset-1' },
    });
    expect(mockedCursor.deleteMany).not.toHaveBeenCalled();
  });
});

describe('fetchBatchNext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when the offset is not in the journal (JOURNAL_NOT_FOUND)', async () => {
    mockedGet.mockRejectedValueOnce({
      isAxiosError: true,
      message: 'Not Found',
      response: {
        status: 404,
        data: {
          status: 'error',
          category: 'OBJECT_NOT_FOUND',
          subCategory: 'WebhooksJournalErrorType.JOURNAL_NOT_FOUND',
        },
      },
    });

    await expect(fetchBatchNext('expired-offset', 100)).resolves.toBeNull();
  });

  it('surfaces a 404 that is not JOURNAL_NOT_FOUND, such as a retired API version', async () => {
    const routeNotFound = {
      isAxiosError: true,
      message: 'Not Found',
      response: { status: 404, data: '<html><h2>HTTP ERROR 404</h2></html>' },
    };
    mockedGet.mockRejectedValueOnce(routeNotFound);

    await expect(fetchBatchNext('some-offset', 100)).rejects.toBe(routeNotFound);
  });

  it('returns the batch when entries are available', async () => {
    const batch = { status: 'COMPLETE', startedAt: '', completedAt: '', results: [] };
    mockedGet.mockResolvedValueOnce({ status: 200, data: batch });

    await expect(fetchBatchNext('some-offset', 100)).resolves.toEqual(batch);
  });
});
