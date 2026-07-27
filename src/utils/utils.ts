export const PORT = 3002;

export const HUBSPOT_API_BASE = 'https://api.hubapi.com';

export const JOURNAL_SCOPES = [
  'developer.webhooks_journal.read',
  'developer.webhooks_journal.subscriptions.read',
  'developer.webhooks_journal.subscriptions.write',
  'developer.webhooks_journal.snapshots.write',
];

export const OAUTH_SCOPES = ['crm.objects.contacts.read', 'crm.objects.contacts.write'];

export const JOURNAL_POLL_INTERVAL_MS = 1000;
export const JOURNAL_BATCH_SIZE = 100;
export const SNAPSHOT_POLL_INTERVAL_MS = 1000;
