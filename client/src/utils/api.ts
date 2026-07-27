const API_BASE = '/api';

export interface Contact {
  id: number;
  hsObjectId: string;
  portalId: string;
  email: string | null;
  firstname: string | null;
  lastname: string | null;
  lastModifiedDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SnapshotStatus {
  id?: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILED' | 'EXPIRED';
  errorCode?: string;
  message?: string;
}

export interface AuthStatus {
  installed: boolean;
  portalId: string | null;
}

export interface Subscription {
  id: number;
  appId: number;
  subscriptionType: string;
  objectTypeId?: string;
  portalId: number;
  actions: string[];
  properties?: string[];
  objectIds?: number[];
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || 'Request failed');
  }
  return response.json();
}

export function getContacts(limit = 50, offset = 0, portalId?: string): Promise<{ contacts: Contact[]; total: number }> {
  let path = `/contacts?limit=${limit}&offset=${offset}`;
  if (portalId && portalId !== 'all') {
    path += `&portalId=${portalId}`;
  }
  return request<{ contacts: Contact[]; total: number }>(path);
}

export function clearContacts(): Promise<{ deleted: number }> {
  return request('/contacts', { method: 'DELETE' });
}

export function getAuthStatus(): Promise<AuthStatus> {
  return request<AuthStatus>('/auth-status');
}

export function getInstallUrl(portalId?: string): Promise<{ authUrl: string }> {
  const params = portalId ? `?portalId=${encodeURIComponent(portalId)}` : '';
  return request<{ authUrl: string }>(`/install${params}`);
}

export function startJournal(portalId: string): Promise<{ status: string }> {
  return request('/journal/start', {
    method: 'POST',
    body: JSON.stringify({ portalId }),
  });
}

export function stopJournal(): Promise<{ status: string }> {
  return request('/journal/stop', { method: 'POST' });
}

export function getJournalStatus(): Promise<{ polling: boolean }> {
  return request('/journal/status');
}

export function createBulkSnapshot(portalId: string): Promise<{ snapshotStatusId: string }> {
  return request('/snapshot/bulk', {
    method: 'POST',
    body: JSON.stringify({ portalId }),
  });
}

export function getSnapshotStatus(statusId: string): Promise<SnapshotStatus> {
  return request<SnapshotStatus>(`/snapshot/status/${statusId}`);
}

export function populateTestData(portalId: string): Promise<{ created: number; skipped: number }> {
  return request('/test-data', {
    method: 'POST',
    body: JSON.stringify({ portalId }),
  });
}

export function getPortals(): Promise<string[]> {
  return request<string[]>('/portals');
}

export function installPortal(): Promise<{ authUrl: string }> {
  return request<{ authUrl: string }>('/install');
}

export function getSubscriptions(): Promise<Subscription[]> {
  return request<Subscription[]>('/subscriptions');
}

export function updateSubscription(data: {
  portalId: string;
  actions: string[];
  properties: string[];
  objectIds?: number[];
}): Promise<Subscription> {
  return request<Subscription>('/subscriptions', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export interface FilterCondition {
  filterType: string;
  property: string;
  operator: string;
  value?: string;
}

export interface Filter {
  id: number;
  filter: { conditions: FilterCondition[] };
  createdAt: number;
}

export function getFilters(subscriptionId: number): Promise<Filter[]> {
  return request<Filter[]>(`/filters/${subscriptionId}`);
}

export function createFilter(
  subscriptionId: number,
  conditions: FilterCondition[]
): Promise<{ filterId: number }> {
  return request<{ filterId: number }>('/filters', {
    method: 'POST',
    body: JSON.stringify({ subscriptionId, conditions }),
  });
}

export function deleteFilter(filterId: number): Promise<void> {
  return request<void>(`/filters/${filterId}`, { method: 'DELETE' });
}
