import {
  PORT,
  JOURNAL_SCOPES,
  OAUTH_SCOPES,
  JOURNAL_POLL_INTERVAL_MS,
  JOURNAL_BATCH_SIZE,
} from '../src/utils/utils';

describe('utils constants', () => {
  it('should export expected port', () => {
    expect(PORT).toBe(3002);
  });

  it('should include required journal scopes', () => {
    expect(JOURNAL_SCOPES).toContain('developer.webhooks_journal.read');
    expect(JOURNAL_SCOPES).toContain(
      'developer.webhooks_journal.subscriptions.read'
    );
    expect(JOURNAL_SCOPES).toContain(
      'developer.webhooks_journal.subscriptions.write'
    );
    expect(JOURNAL_SCOPES).toContain(
      'developer.webhooks_journal.snapshots.write'
    );
  });

  it('should include required oauth scopes', () => {
    expect(OAUTH_SCOPES).toContain('crm.objects.contacts.read');
    expect(OAUTH_SCOPES).toContain('crm.objects.contacts.write');
  });

  it('should have positive polling interval and batch size', () => {
    expect(JOURNAL_POLL_INTERVAL_MS).toBeGreaterThan(0);
    expect(JOURNAL_BATCH_SIZE).toBeGreaterThan(0);
  });
});
