import {
  PORT,
  JOURNAL_SCOPES,
  OAUTH_SCOPES,
  JOURNAL_POLL_INTERVAL_MS,
  JOURNAL_BATCH_SIZE,
  redactPresignedUrl,
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

describe('redactPresignedUrl', () => {
  it('strips the query string from a presigned S3 URL', () => {
    const url =
      'https://bucket.s3.amazonaws.com/journal/2027/file.json?X-Amz-Credential=AKIA%2F20270101%2Fus-east-1&X-Amz-Signature=deadbeef';
    const redacted = redactPresignedUrl(url);
    expect(redacted).toBe('https://bucket.s3.amazonaws.com/journal/2027/file.json?<redacted>');
    expect(redacted).not.toContain('deadbeef');
    expect(redacted).not.toContain('AKIA');
  });

  it('leaves a URL without a query string unchanged', () => {
    expect(redactPresignedUrl('https://example.com/a/b.json')).toBe('https://example.com/a/b.json');
  });

  it('returns a placeholder for invalid input', () => {
    expect(redactPresignedUrl('not a url')).toBe('<invalid url>');
  });
});
