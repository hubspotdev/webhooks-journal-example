import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  TextField,
  Select,
  MenuItem,
  FormControl,
  Chip,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import { updateSubscription, Subscription } from '../utils/api';

interface SubscriptionDialogProps {
  open: boolean;
  onClose: () => void;
  subscription: Subscription;
  portalId: string;
  onToast: (message: string, severity: 'error' | 'success' | 'info') => void;
  onSaved: () => void;
}

const ALL_ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'MERGE', 'RESTORE'];

export default function SubscriptionDialog({
  open,
  onClose,
  subscription,
  portalId,
  onToast,
  onSaved,
}: SubscriptionDialogProps) {
  const [selectedActions, setSelectedActions] = useState<string[]>([]);
  const [properties, setProperties] = useState<string[]>([]);
  const [objectIds, setObjectIds] = useState<number[]>([]);
  const [objectIdInput, setObjectIdInput] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedActions([...subscription.actions]);
      setProperties([...(subscription.properties || [])]);
      setObjectIds([...(subscription.objectIds || [])]);
      setObjectIdInput('');
      setSaving(false);
    }
  }, [open, subscription]);

  const toggleAction = (action: string) => {
    setSelectedActions((prev) =>
      prev.includes(action) ? prev.filter((a) => a !== action) : [...prev, action]
    );
  };

  const handleAddObjectId = (value: string) => {
    const trimmed = value.trim();
    const num = Number(trimmed);
    if (trimmed && !isNaN(num) && Number.isInteger(num) && !objectIds.includes(num)) {
      setObjectIds((prev) => [...prev, num]);
    }
    setObjectIdInput('');
  };

  const handleRemoveObjectId = (id: number) => {
    setObjectIds((prev) => prev.filter((oid) => oid !== id));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSubscription({
        portalId,
        actions: selectedActions,
        properties,
        objectIds: objectIds.length > 0 ? objectIds : undefined,
      });
      onToast('Subscription updated', 'success');
      onSaved();
      onClose();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to update subscription', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Edit Subscription</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Changes to subscriptions may take up to 60 seconds to take effect.
        </Typography>

        {/* Row 1: Object Type + Actions */}
        <Box sx={{ display: 'flex', gap: 3, mb: 3 }}>
          {/* Object Type */}
          <Box sx={{ minWidth: 160 }}>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
              Object Type
            </Typography>
            <Tooltip title="Only contact OBJECT subscriptions are supported for this example">
              <FormControl size="small" fullWidth disabled>
                <Select value="0-1">
                  <MenuItem value="0-1">Contact</MenuItem>
                </Select>
              </FormControl>
            </Tooltip>
          </Box>

          {/* Actions */}
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
              Actions
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {ALL_ACTIONS.map((action) => {
                const selected = selectedActions.includes(action);
                return (
                  <Button
                    key={action}
                    size="small"
                    variant={selected ? 'contained' : 'outlined'}
                    onClick={() => toggleAction(action)}
                    sx={{
                      fontSize: '0.7rem',
                      minWidth: 0,
                      px: 1.5,
                      py: 0.5,
                    }}
                  >
                    {action}
                  </Button>
                );
              })}
            </Box>
          </Box>
        </Box>

        {/* Row 2: Properties */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
            Properties
          </Typography>
          <Tooltip title="This example only supports firstname, lastname, and email properties">
            <TextField
              size="small"
              fullWidth
              placeholder="firstname, lastname, email"
              disabled
            />
          </Tooltip>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
            {properties.map((prop) => (
              <Chip
                key={prop}
                label={prop}
                size="small"
              />
            ))}
          </Box>
        </Box>

        {/* Row 3: Object IDs */}
        <Box>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
            Object IDs (optional)
          </Typography>
          <TextField
            size="small"
            fullWidth
            placeholder="Add an object ID..."
            value={objectIdInput}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '' || /^\d+$/.test(val)) {
                setObjectIdInput(val);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddObjectId(objectIdInput);
              }
            }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            Filter events to specific object IDs. Leave empty to receive events for all objects.
          </Typography>
          {objectIds.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
              {objectIds.map((id) => (
                <Chip
                  key={id}
                  label={String(id)}
                  size="small"
                  onDelete={() => handleRemoveObjectId(id)}
                />
              ))}
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={18} color="inherit" /> : undefined}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
