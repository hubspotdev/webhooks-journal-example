export const PORT = 3002;

export const HUBSPOT_API_BASE = 'https://api.hubapi.com';

export const WEBHOOKS_JOURNAL_API_VERSION = '2027-03-beta';
export const JOURNAL_API_BASE = `${HUBSPOT_API_BASE}/webhooks-journal/journal/${WEBHOOKS_JOURNAL_API_VERSION}`;
export const SUBSCRIPTIONS_API_BASE = `${HUBSPOT_API_BASE}/webhooks-journal/subscriptions/${WEBHOOKS_JOURNAL_API_VERSION}`;
export const SNAPSHOTS_API_BASE = `${HUBSPOT_API_BASE}/webhooks-journal/snapshots/${WEBHOOKS_JOURNAL_API_VERSION}`;

export const JOURNAL_SCOPES = [
  'developer.webhooks_journal.read',
  'developer.webhooks_journal.subscriptions.read',
  'developer.webhooks_journal.subscriptions.write',
  'developer.webhooks_journal.snapshots.write',
];

export const OAUTH_SCOPES = ['crm.objects.contacts.read', 'crm.objects.contacts.write'];

// Object type IDs for the app-lifecycle event types (not portal-scoped). These
// are the published identifiers for the app install / uninstall events; see
// https://developers.hubspot.com/docs/api-reference/latest/webhooks-journal/subscriptions/guide#create-an-app-install-or-uninstall-event-subscription
// Overridable via env if they ever differ for your environment.
export const APP_INSTALL_EVENT_TYPE_ID = process.env.APP_INSTALL_EVENT_TYPE_ID || '4-1909196';
export const APP_UNINSTALL_EVENT_TYPE_ID = process.env.APP_UNINSTALL_EVENT_TYPE_ID || '4-1916193';

export const JOURNAL_POLL_INTERVAL_MS = 1000;
export const JOURNAL_BATCH_SIZE = 100;
export const SNAPSHOT_POLL_INTERVAL_MS = 1000;
