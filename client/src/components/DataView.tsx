import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import {
  Box,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Button,
  Chip,
  CircularProgress,
  ListItemText,
  Menu,
  MenuItem,
  Divider,
  Paper,
  Tooltip,
  Stack,
  Snackbar,
  Alert,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import AddIcon from '@mui/icons-material/Add';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import DeleteIcon from '@mui/icons-material/Delete';
import PersonIcon from '@mui/icons-material/Person';
import PeopleIcon from '@mui/icons-material/People';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import FilterListIcon from '@mui/icons-material/FilterList';
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import {
  getContacts,
  clearContacts,
  createBulkSnapshot,
  getSnapshotStatus,
  getSubscriptions,
  createSubscription,
  deleteSubscription,
  deletePortalSubscriptions,
  getFilters,
  getPortals,
  installPortal,
  populateTestData,
  startJournal,
  stopJournal,
  Contact,
  SnapshotStatus,
  Subscription,
  Filter,
} from '../utils/api';
import FilterDialog from './FilterDialog';
import SubscriptionDialog from './SubscriptionDialog';

interface DataViewProps {
  portalId: string;
  onBack: () => void;
}

const PAGE_SIZE = 50;

const STATUS_COLORS: Record<string, 'default' | 'warning' | 'info' | 'success' | 'error'> = {
  PENDING: 'warning',
  IN_PROGRESS: 'info',
  SUCCESS: 'success',
  FAILED: 'error',
  EXPIRED: 'error',
};

interface Toast {
  message: string;
  severity: 'error' | 'warning' | 'info' | 'success';
}

function ContactRow({ index, style, data }: ListChildComponentProps<Contact[]>) {
  const contact = data[index];
  if (!contact) return null;
  return (
    <div style={style}>
      <Paper sx={{ mx: 0, mb: 0.5, bgcolor: 'background.paper', height: 68 }} elevation={1}>
        <Box sx={{ display: 'flex', alignItems: 'center', px: 2, height: '100%' }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              bgcolor: 'primary.main',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              mr: 2,
              flexShrink: 0,
            }}
          >
            <Typography variant="body2" fontWeight="bold" color="white">
              {(contact.firstname?.[0] || contact.email?.[0] || '?').toUpperCase()}
            </Typography>
          </Box>
          <ListItemText
            primary={
              <Typography variant="body1" fontWeight={500}>
                {[contact.firstname, contact.lastname].filter(Boolean).join(' ') || 'Unknown'}
              </Typography>
            }
            secondary={
              <Stack direction="row" spacing={2} component="span">
                <Typography variant="body2" color="text.secondary" component="span">
                  {contact.email || 'No email'}
                </Typography>
                <Typography variant="caption" color="text.secondary" component="span">
                  ID: {contact.hsObjectId}
                </Typography>
                <Typography variant="caption" color="text.secondary" component="span">
                  Portal: {contact.portalId}
                </Typography>
              </Stack>
            }
          />
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            {new Date(contact.updatedAt).toLocaleTimeString()}
          </Typography>
        </Box>
      </Paper>
    </div>
  );
}

export default function DataView({ portalId, onBack }: DataViewProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [totalContacts, setTotalContacts] = useState(0);
  const [page, setPage] = useState(0);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [snapshotStatusId, setSnapshotStatusId] = useState<string | null>(null);
  const [snapshotStatus, setSnapshotStatus] = useState<SnapshotStatus | null>(null);
  const [exporting, setExporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [populatingTestData, setPopulatingTestData] = useState(false);
  const [deletingSubId, setDeletingSubId] = useState<number | null>(null);
  const [deletingAllSubs, setDeletingAllSubs] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [subscriptionDialogOpen, setSubscriptionDialogOpen] = useState(false);
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState<number | null>(null);
  const [selectedSubForEdit, setSelectedSubForEdit] = useState<Subscription | null>(null);
  const [filters, setFilters] = useState<Record<number, Filter[]>>({});
  const [installedPortals, setInstalledPortals] = useState<string[]>([]);
  const [selectedPortal, setSelectedPortal] = useState<string>(portalId);
  const [portalMenuAnchor, setPortalMenuAnchor] = useState<null | HTMLElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const snapshotPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Last-seen set of installed portals, used to detect installs/uninstalls
  // between polls. null until the first fetch so we don't toast pre-existing
  // portals on mount.
  const knownPortalsRef = useRef<Set<string> | null>(null);
  // Set when the user kicks off a manual OAuth install so the poller can
  // auto-select the portal once it appears.
  const pendingSelectRef = useRef(false);
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const [listHeight, setListHeight] = useState(400);

  const isAllPortals = selectedPortal === 'all';

  const showToast = useCallback((message: string, severity: Toast['severity'] = 'error') => {
    setToast({ message, severity });
  }, []);

  const fetchContacts = useCallback(async () => {
    try {
      const data = await getContacts(PAGE_SIZE, page * PAGE_SIZE, selectedPortal);
      setContacts(data.contacts);
      setTotalContacts(data.total);
    } catch {
      // silently retry on next interval
    }
  }, [page, selectedPortal]);

  const fetchFiltersForSubscriptions = useCallback(async (subs: Subscription[]) => {
    const result: Record<number, Filter[]> = {};
    for (const sub of subs) {
      try {
        result[sub.id] = await getFilters(sub.id);
      } catch {
        result[sub.id] = [];
      }
    }
    setFilters(result);
  }, []);

  const fetchSubscriptions = useCallback(async () => {
    try {
      const data = await getSubscriptions();
      // APP_LIFECYCLE_EVENT subscriptions are app-global plumbing (created once
      // at startup), not something the user manages per portal — hide them.
      const managed = data.filter((s) => s.subscriptionType !== 'APP_LIFECYCLE_EVENT');
      setSubscriptions(managed);
      await fetchFiltersForSubscriptions(managed);
    } catch {
      // non-critical, silently ignore
    }
  }, [fetchFiltersForSubscriptions]);

  // Polls the installed-portal registry and reconciles it against what we last
  // saw. Because the app has no push channel, this diff is how the UI learns
  // about APP_LIFECYCLE installs/uninstalls: a portal that appears fires a green
  // toast and joins the dropdown; one that disappears is dropped.
  const syncPortals = useCallback(async () => {
    let portals: string[];
    try {
      portals = await getPortals();
    } catch {
      return; // non-critical, retry next tick
    }

    const next = new Set(portals);
    const prev = knownPortalsRef.current;
    knownPortalsRef.current = next;
    setInstalledPortals(portals);

    if (prev === null) return; // first load — don't announce pre-existing portals

    const added = portals.filter((p) => !prev.has(p));
    const removed = [...prev].filter((p) => !next.has(p));

    if (added.length > 0) {
      added.forEach((p) => showToast(`New portal ${p} installed`, 'success'));
      if (pendingSelectRef.current) {
        pendingSelectRef.current = false;
        setSelectedPortal(added[0]);
        setPage(0);
      }
      fetchSubscriptions();
    }

    if (removed.length > 0) {
      if (removed.includes(selectedPortal)) {
        setSelectedPortal('all');
        setPage(0);
      }
      fetchSubscriptions();
    }
  }, [showToast, selectedPortal, fetchSubscriptions]);

  const updateListHeight = useCallback(() => {
    const el = listContainerRef.current;
    if (el) {
      setListHeight(Math.max(200, el.clientHeight));
    }
  }, []);

  useLayoutEffect(() => {
    updateListHeight();
  });

  useEffect(() => {
    window.addEventListener('resize', updateListHeight);
    return () => window.removeEventListener('resize', updateListHeight);
  }, [updateListHeight]);

  useEffect(() => {
    fetchContacts();
    fetchSubscriptions();
    pollRef.current = setInterval(fetchContacts, 1500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchContacts, fetchSubscriptions]);

  useEffect(() => {
    syncPortals();
    const id = setInterval(syncPortals, 3000);
    return () => clearInterval(id);
  }, [syncPortals]);

  useEffect(() => {
    if (!snapshotStatusId) return;

    const pollStatus = async () => {
      try {
        const status = await getSnapshotStatus(snapshotStatusId);
        setSnapshotStatus(status);
        if (['SUCCESS', 'FAILED', 'EXPIRED'].includes(status.status)) {
          if (snapshotPollRef.current) clearInterval(snapshotPollRef.current);
          setExporting(false);
          if (status.status === 'FAILED') {
            showToast(`Bulk export failed: ${status.message || status.errorCode || 'unknown error'}`);
          }
        }
      } catch {
        // retry on next interval
      }
    };

    pollStatus();
    snapshotPollRef.current = setInterval(pollStatus, 1000);

    return () => {
      if (snapshotPollRef.current) clearInterval(snapshotPollRef.current);
    };
  }, [snapshotStatusId, showToast]);

  const handleBulkExport = async () => {
    setExporting(true);
    setSnapshotStatus(null);
    try {
      const result = await createBulkSnapshot(selectedPortal);
      setSnapshotStatusId(result.snapshotStatusId);
    } catch (err) {
      setExporting(false);
      showToast(err instanceof Error ? err.message : 'Failed to create bulk snapshot');
    }
  };

  const handleClear = async () => {
    setClearing(true);
    try {
      await clearContacts();
      setContacts([]);
      setSnapshotStatus(null);
      setSnapshotStatusId(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to clear data');
    } finally {
      setClearing(false);
    }
  };

  const handlePopulateTestData = async () => {
    setPopulatingTestData(true);
    try {
      const result = await populateTestData(selectedPortal);
      showToast(
        `Created ${result.created} contacts, skipped ${result.skipped} duplicates`,
        'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to populate test data');
    } finally {
      setPopulatingTestData(false);
    }
  };

  const handleAddSubscription = async () => {
    setAddingSub(true);
    try {
      await createSubscription(selectedPortal);
      showToast('Subscription created', 'success');
      await fetchSubscriptions();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create subscription');
    } finally {
      setAddingSub(false);
    }
  };

  const handleDeleteSubscription = async (subscriptionId: number) => {
    setDeletingSubId(subscriptionId);
    try {
      await deleteSubscription(subscriptionId);
      showToast('Subscription deleted', 'success');
      await fetchSubscriptions();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete subscription');
    } finally {
      setDeletingSubId(null);
    }
  };

  const handleDeleteAllSubscriptions = async () => {
    setDeletingAllSubs(true);
    try {
      await deletePortalSubscriptions(selectedPortal);
      showToast('Deleted all subscriptions for this portal', 'success');
      await fetchSubscriptions();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete subscriptions');
    } finally {
      setDeletingAllSubs(false);
    }
  };

  const handleInstallPortal = async () => {
    setPortalMenuAnchor(null);
    try {
      const { authUrl } = await installPortal();
      // The portal will surface via the /api/portals poll once OAuth completes;
      // flag it so syncPortals auto-selects it (and shows the install toast).
      pendingSelectRef.current = true;
      window.open(authUrl, '_blank');

      // Ensure the newly installed portal gets its contact subscription. An
      // APP_INSTALL lifecycle event would also provision this, but the manual
      // flow shouldn't depend on that subscription being configured.
      const seen = new Set(installedPortals);
      const checkInterval = setInterval(async () => {
        try {
          const portals = await getPortals();
          const newPortal = portals.find((p) => !seen.has(p));
          if (newPortal) {
            clearInterval(checkInterval);
            await startJournal(newPortal);
            fetchSubscriptions();
          }
        } catch {
          // keep polling
        }
      }, 2000);

      setTimeout(() => clearInterval(checkInterval), 120000);
    } catch (err) {
      pendingSelectRef.current = false;
      showToast(err instanceof Error ? err.message : 'Failed to start installation');
    }
  };

  const handlePortalSelect = (portal: string) => {
    setPortalMenuAnchor(null);
    setSelectedPortal(portal);
    setPage(0);
  };

  const handleBack = async () => {
    try {
      await stopJournal();
      await clearContacts();
    } finally {
      onBack();
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <AppBar position="static" sx={{ bgcolor: 'background.paper' }} elevation={2}>
        <Toolbar>
          <Tooltip title="Back to start (clears data)">
            <IconButton edge="start" color="inherit" onClick={handleBack} sx={{ mr: 2 }}>
              <ArrowBackIcon />
            </IconButton>
          </Tooltip>

          <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center' }}>
            <Button
              color="inherit"
              onClick={(e) => setPortalMenuAnchor(e.currentTarget)}
              endIcon={<ArrowDropDownIcon />}
              sx={{ textTransform: 'none', fontSize: '1.25rem', fontWeight: 500 }}
            >
              {isAllPortals ? 'All Portals' : `Portal ${selectedPortal}`}
            </Button>
            <Menu
              anchorEl={portalMenuAnchor}
              open={Boolean(portalMenuAnchor)}
              onClose={() => setPortalMenuAnchor(null)}
            >
              {installedPortals.map((p) => (
                <MenuItem
                  key={p}
                  selected={p === selectedPortal}
                  onClick={() => handlePortalSelect(p)}
                >
                  Portal {p}
                </MenuItem>
              ))}
              <Divider />
              <MenuItem
                selected={isAllPortals}
                onClick={() => handlePortalSelect('all')}
              >
                All Portals
              </MenuItem>
              <Divider />
              <MenuItem onClick={handleInstallPortal}>
                <AddIcon sx={{ mr: 1, fontSize: 18 }} />
                Install Another Portal
              </MenuItem>
            </Menu>
            <Chip
              label={`${totalContacts} contacts`}
              size="small"
              color="secondary"
              sx={{ ml: 2 }}
            />
          </Box>

          <Stack direction="row" spacing={1} alignItems="center">
            {snapshotStatus && (
              <Chip
                label={snapshotStatus.status}
                color={STATUS_COLORS[snapshotStatus.status] || 'default'}
                size="small"
              />
            )}

            <Button
              variant="outlined"
              startIcon={populatingTestData ? <CircularProgress size={18} /> : <PeopleIcon />}
              onClick={handlePopulateTestData}
              disabled={populatingTestData || isAllPortals}
              size="small"
            >
              {populatingTestData ? 'Creating...' : 'CREATE TEST DATA IN HUBSPOT'}
            </Button>

            <Button
              variant="contained"
              startIcon={exporting ? <CircularProgress size={18} color="inherit" /> : <CloudDownloadIcon />}
              onClick={handleBulkExport}
              disabled={exporting || isAllPortals}
              size="small"
            >
              Bulk Export
            </Button>

            <Button
              variant="outlined"
              color="error"
              startIcon={clearing ? <CircularProgress size={18} /> : <DeleteSweepIcon />}
              onClick={handleClear}
              disabled={clearing}
              size="small"
            >
              CLEAR LOCAL DATA
            </Button>
          </Stack>
        </Toolbar>
      </AppBar>

      {(!isAllPortals || subscriptions.length > 0) && (() => {
        const OBJECT_TYPE_LABELS: Record<string, string> = { '0-1': 'Contact', '0-2': 'Company', '0-3': 'Deal', '0-5': 'Ticket' };
        const visibleSubs = isAllPortals
          ? subscriptions
          : subscriptions.filter((s) => String(s.portalId) === selectedPortal);
        if (isAllPortals && visibleSubs.length === 0) return null;
        const hasContactSub = visibleSubs.some((s) => s.objectTypeId === '0-1');
        return (
        <Box sx={{ px: 2, pt: 1.5, pb: 0.5, maxHeight: 240, overflowY: 'auto' }}>
          {!isAllPortals && (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mb: 1 }}>
              <Tooltip title={hasContactSub ? 'A contact subscription already exists for this portal' : 'Create a contact subscription for this portal'}>
                <span>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={addingSub ? <CircularProgress size={14} /> : <AddIcon sx={{ fontSize: 16 }} />}
                    onClick={handleAddSubscription}
                    disabled={addingSub || hasContactSub}
                    sx={{ fontSize: '0.7rem', py: 0.25 }}
                  >
                    Add Subscription
                  </Button>
                </span>
              </Tooltip>
              <Tooltip title="Remove every subscription for this portal">
                <span>
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    startIcon={
                      deletingAllSubs ? <CircularProgress size={14} /> : <DeleteSweepIcon sx={{ fontSize: 16 }} />
                    }
                    onClick={handleDeleteAllSubscriptions}
                    disabled={deletingAllSubs || visibleSubs.length === 0}
                    sx={{ fontSize: '0.7rem', py: 0.25 }}
                  >
                    Delete All Subscriptions
                  </Button>
                </span>
              </Tooltip>
            </Box>
          )}
          {!isAllPortals && visibleSubs.length === 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pb: 1 }}>
              No subscriptions for this portal. Click "Add Subscription" to create one.
            </Typography>
          )}
          {visibleSubs.map((sub) => {
            const typeLabel = (sub.objectTypeId && OBJECT_TYPE_LABELS[sub.objectTypeId]) || sub.subscriptionType;
            const subFilters = filters[sub.id] || [];
            return (
              <Box key={sub.id} sx={{ mb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <NotificationsActiveIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                  <Tooltip title="Delete subscription">
                    <span>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleDeleteSubscription(sub.id)}
                        disabled={deletingSubId === sub.id}
                        sx={{ p: 0.25 }}
                      >
                        {deletingSubId === sub.id ? (
                          <CircularProgress size={14} />
                        ) : (
                          <DeleteIcon sx={{ fontSize: 16 }} />
                        )}
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Chip
                    label={`${isAllPortals ? `Portal ${sub.portalId} · ` : ''}${typeLabel} — ${sub.actions.join(', ')}`}
                    size="small"
                    variant="outlined"
                    clickable
                    onClick={() => {
                      setSelectedSubForEdit(sub);
                      setSubscriptionDialogOpen(true);
                    }}
                    sx={{ fontSize: '0.7rem', cursor: 'pointer' }}
                  />
                  {(sub.properties ?? []).map((prop) => (
                    <Chip
                      key={prop}
                      label={prop}
                      size="small"
                      sx={{
                        fontSize: '0.65rem',
                        height: 20,
                        color: 'text.secondary',
                        borderColor: 'divider',
                      }}
                      variant="outlined"
                    />
                  ))}
                  {(sub.objectIds ?? []).length > 0 && (
                    <>
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                        IDs:
                      </Typography>
                      {sub.objectIds!.map((id) => (
                        <Chip
                          key={id}
                          label={String(id)}
                          size="small"
                          sx={{
                            fontSize: '0.65rem',
                            height: 20,
                            color: 'text.secondary',
                            borderColor: 'divider',
                          }}
                          variant="outlined"
                        />
                      ))}
                    </>
                  )}
                </Box>
                <Box sx={{ ml: 4, mt: 1, display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<FilterListIcon sx={{ fontSize: 14 }} />}
                    onClick={() => {
                      setSelectedSubscriptionId(sub.id);
                      setFilterDialogOpen(true);
                    }}
                    sx={{ fontSize: '0.7rem', py: 0.25 }}
                  >
                    Manage Advanced Filters
                  </Button>
                {subFilters.length > 0 && (
                  <>
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                      Active:
                    </Typography>
                    {subFilters.map((filter, fi) => (
                      <Box key={filter.id} sx={{ display: 'contents' }}>
                        {fi > 0 && (
                          <Typography variant="caption" sx={{ color: 'info.main', fontWeight: 600, mx: 0.5 }}>
                            OR
                          </Typography>
                        )}
                        {filter.filter.conditions.map((cond, ci) => (
                          <Box key={ci} sx={{ display: 'contents' }}>
                            {ci > 0 && (
                              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, mx: 0.25 }}>
                                AND
                              </Typography>
                            )}
                            <Chip
                              label={
                                cond.value
                                  ? `${cond.property} ${cond.operator} ${cond.value}`
                                  : `${cond.property} ${cond.operator}`
                              }
                              size="small"
                              sx={{ fontSize: '0.6rem', height: 18 }}
                            />
                          </Box>
                        ))}
                      </Box>
                    ))}
                  </>
                )}
                </Box>
              </Box>
            );
          })}
        </Box>
        );
      })()}

      <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {contacts.length === 0 ? (
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'text.secondary',
              p: 2,
            }}
          >
            <PersonIcon sx={{ fontSize: 64, mb: 2, opacity: 0.3 }} />
            <Typography variant="h6">No contacts yet</Typography>
            <Typography variant="body2">
              Create contacts in HubSpot, click Test Data, or click Bulk Export to backfill
            </Typography>
          </Box>
        ) : (
          <>
            <Box ref={listContainerRef} sx={{ flex: 1, minHeight: 0, overflow: 'hidden', mx: 2, mt: 1 }}>
              <FixedSizeList
                height={listHeight}
                width="100%"
                itemCount={contacts.length}
                itemSize={72}
                itemData={contacts}
              >
                {ContactRow}
              </FixedSizeList>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 1, gap: 1, zIndex: 1, bgcolor: 'background.default', borderTop: 1, borderColor: 'divider', flexShrink: 0 }}>
              <IconButton
                size="small"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                <ChevronLeftIcon />
              </IconButton>
              <Typography variant="body2" color="text.secondary">
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalContacts)} of {totalContacts} contacts
              </Typography>
              <IconButton
                size="small"
                onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) * PAGE_SIZE >= totalContacts}
              >
                <ChevronRightIcon />
              </IconButton>
            </Box>
          </>
        )}
      </Box>

      {selectedSubForEdit && (
        <SubscriptionDialog
          open={subscriptionDialogOpen}
          onClose={() => setSubscriptionDialogOpen(false)}
          subscription={selectedSubForEdit}
          portalId={String(selectedSubForEdit.portalId)}
          onToast={showToast}
          onSaved={() => {
            fetchSubscriptions();
            setSubscriptionDialogOpen(false);
          }}
        />
      )}

      {selectedSubscriptionId !== null && (
        <FilterDialog
          open={filterDialogOpen}
          onClose={() => {
            setFilterDialogOpen(false);
            fetchFiltersForSubscriptions(subscriptions);
          }}
          subscriptionId={selectedSubscriptionId}
          subscribedProperties={
            subscriptions.find((s) => s.id === selectedSubscriptionId)?.properties ?? []
          }
          onToast={showToast}
        />
      )}

      <Snackbar
        open={!!toast}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        {toast ? (
          <Alert
            onClose={() => setToast(null)}
            severity={toast.severity}
            variant="filled"
            sx={{ width: '100%' }}
          >
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}
