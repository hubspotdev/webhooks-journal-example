export interface JournalEntry {
  url: string;
  expiresAt: string;
  currentOffset: string;
}

export interface JournalBatchResponse {
  status: string;
  startedAt: string;
  completedAt: string;
  results: JournalEntry[];
  numErrors?: number;
  errors?: JournalBatchError[];
}

export interface JournalBatchError {
  status: string;
  category: string;
  message: string;
  context: { offset: string[] };
  errors: unknown[];
  links: Record<string, string>;
}

export interface JournalEvent {
  offset: string;
  journalEvents: JournalEventItem[];
  publishedAt: string;
}

export type JournalEventItem = CrmObjectEvent | AppLifecycleEvent;

// App-lifecycle events are app-global (delivered for every portal that installs
// or uninstalls the app) and carry the affected portal in `portalId`.
export interface AppLifecycleEvent {
  type: 'appLifecycleEvent';
  portalId: number;
  occurredAt: string;
  appId: number;
  eventTypeId: string;
  action: 'APP_INSTALL' | 'APP_UNINSTALL';
  properties?: Record<string, string>;
}

export interface CrmObjectEvent {
  type: string;
  portalId: number;
  occurredAt: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'MERGE' | 'RESTORE' | 'SNAPSHOT';
  objectTypeId: string;
  objectId: number;
  propertyChanges?: Record<string, string>;
  properties?: Record<string, string>;
  mergedObjectIds?: number[];
}

export interface SubscriptionRequest {
  objectTypeId: string;
  subscriptionType: string;
  portalId: number;
  actions: string[];
  properties?: string[];
}

export interface SnapshotStatusResponse {
  id: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILED' | 'EXPIRED';
  errorCode?: string;
  message?: string;
  initiatedAt: number;
  completedAt?: number;
}

export interface BulkSnapshotResponse {
  id: string;
  objectTypeId: string;
  installPortalId: number;
  links: Record<string, string>;
}

export interface ContactData {
  id: number;
  hsObjectId: string;
  email: string | null;
  firstname: string | null;
  lastname: string | null;
  lastModifiedDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
