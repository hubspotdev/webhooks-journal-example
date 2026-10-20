import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  IconButton,
  TextField,
  MenuItem,
  Select,
  FormControl,
  Paper,
  Divider,
  CircularProgress,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import {
  getFilters,
  createFilter,
  deleteFilter,
  Filter,
  FilterCondition,
} from '../utils/api';

interface FilterDialogProps {
  open: boolean;
  onClose: () => void;
  subscriptionId: number;
  subscribedProperties: string[];
  onToast: (message: string, severity: 'error' | 'success' | 'info') => void;
}

interface LocalCondition {
  property: string;
  operator: string;
  value: string;
}

interface LocalFilter {
  existingId?: number;
  conditions: LocalCondition[];
}

const ALL_OPERATORS: { value: string; label: string }[] = [
  { value: 'EQ', label: 'Equals' },
  { value: 'N_EQ', label: 'Not equals' },
  { value: 'LT', label: 'Less than' },
  { value: 'GT', label: 'Greater than' },
  { value: 'LTE', label: 'Less than or equal' },
  { value: 'GTE', label: 'Greater than or equal' },
  { value: 'IS_EMPTY', label: 'Is empty' },
  { value: 'IS_NOT_EMPTY', label: 'Is not empty' },
];

const NUMERIC_OPERATORS = new Set(['LT', 'GT', 'LTE', 'GTE']);
const NUMERIC_PROPERTIES = new Set(['id']);

function getOperatorsForProperty(property: string) {
  if (NUMERIC_PROPERTIES.has(property)) return ALL_OPERATORS;
  return ALL_OPERATORS.filter((op) => !NUMERIC_OPERATORS.has(op.value));
}

const VALUELESS_OPERATORS = ['IS_EMPTY', 'IS_NOT_EMPTY'];

const MAX_FILTERS = 5;
const MAX_CONDITIONS = 10;

const PROPERTY_LABELS: Record<string, string> = {
  id: 'Object ID',
  firstname: 'First Name',
  lastname: 'Last Name',
  email: 'Email',
};

function propertyLabel(prop: string): string {
  return PROPERTY_LABELS[prop] || prop.charAt(0).toUpperCase() + prop.slice(1);
}

const EXTRA_FILTERABLE_PROPERTIES = ['id'];

export default function FilterDialog({
  open,
  onClose,
  subscriptionId,
  subscribedProperties,
  onToast,
}: FilterDialogProps) {
  const [filters, setFilters] = useState<LocalFilter[]>([]);
  const [existingFilterIds, setExistingFilterIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadFilters = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getFilters(subscriptionId);
      const ids = data.map((f: Filter) => f.id);
      setExistingFilterIds(ids);
      if (data.length > 0) {
        setFilters(
          data.map((f: Filter) => ({
            existingId: f.id,
            conditions: f.filter.conditions.map((c: FilterCondition) => ({
              property: c.property,
              operator: c.operator,
              value: c.value ?? '',
            })),
          }))
        );
      } else {
        setFilters([]);
      }
    } catch {
      onToast('Failed to load filters', 'error');
    } finally {
      setLoading(false);
    }
  }, [subscriptionId, onToast]);

  useEffect(() => {
    if (open) {
      loadFilters();
    }
  }, [open, loadFilters]);

  const handleAddFilter = () => {
    if (filters.length >= MAX_FILTERS) return;
    setFilters((prev) => [
      ...prev,
      { conditions: [{ property: '', operator: 'EQ', value: '' }] },
    ]);
  };

  const handleRemoveFilter = (filterIndex: number) => {
    setFilters((prev) => prev.filter((_, i) => i !== filterIndex));
  };

  const handleAddCondition = (filterIndex: number) => {
    setFilters((prev) =>
      prev.map((f, i) => {
        if (i !== filterIndex) return f;
        if (f.conditions.length >= MAX_CONDITIONS) return f;
        return {
          ...f,
          conditions: [...f.conditions, { property: '', operator: 'EQ', value: '' }],
        };
      })
    );
  };

  const handleRemoveCondition = (filterIndex: number, conditionIndex: number) => {
    setFilters((prev) =>
      prev.map((f, i) => {
        if (i !== filterIndex) return f;
        return { ...f, conditions: f.conditions.filter((_, ci) => ci !== conditionIndex) };
      })
    );
  };

  const handleConditionChange = (
    filterIndex: number,
    conditionIndex: number,
    field: keyof LocalCondition,
    newValue: string
  ) => {
    setFilters((prev) =>
      prev.map((f, fi) => {
        if (fi !== filterIndex) return f;
        return {
          ...f,
          conditions: f.conditions.map((c, ci) => {
            if (ci !== conditionIndex) return c;
            const updated = { ...c, [field]: newValue };
            if (field === 'operator' && VALUELESS_OPERATORS.includes(newValue)) {
              updated.value = '';
            }
            if (field === 'property') {
              const validOps = getOperatorsForProperty(newValue);
              if (!validOps.some((op) => op.value === updated.operator)) {
                updated.operator = 'EQ';
              }
            }
            return updated;
          }),
        };
      })
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Delete all existing filters
      for (const id of existingFilterIds) {
        await deleteFilter(id);
      }

      // Create new filters for each non-empty group
      for (const filter of filters) {
        const validConditions = filter.conditions.filter((c) => c.property !== '');
        if (validConditions.length === 0) continue;

        const apiConditions: FilterCondition[] = validConditions.map((c) => {
          const condition: FilterCondition = {
            filterType: 'CRM_OBJECT_PROPERTY',
            property: c.property,
            operator: c.operator,
          };
          if (!VALUELESS_OPERATORS.includes(c.operator) && c.value) {
            condition.value = c.value;
          }
          return condition;
        });

        await createFilter(subscriptionId, apiConditions);
      }

      onToast('Filters saved', 'success');
      onClose();
    } catch (err) {
      onToast(
        err instanceof Error ? err.message : 'Failed to save filters',
        'error'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Manage Filters</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Filters control which subscription events reach your journal. Only properties included in
          the event's change data can be filtered on &mdash; the journal only sees
          property values that changed, not the full object. If an event occurs that
          does not include all the properties present in a condition, the filter is
          skipped and the event passes on to the journal.
        </Typography>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            {filters.map((filter, filterIndex) => (
              <Box key={filterIndex}>
                {filterIndex > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', my: 1.5 }}>
                    <Divider sx={{ flex: 1 }} />
                    <Typography
                      variant="caption"
                      sx={{
                        mx: 2,
                        px: 1.5,
                        py: 0.25,
                        bgcolor: 'info.main',
                        color: 'white',
                        borderRadius: 1,
                        fontWeight: 600,
                        fontSize: '0.7rem',
                      }}
                    >
                      OR
                    </Typography>
                    <Divider sx={{ flex: 1 }} />
                  </Box>
                )}

                <Paper
                  sx={{
                    p: 2,
                    bgcolor: 'rgba(124, 140, 224, 0.08)',
                    border: '1px solid',
                    borderColor: 'divider',
                  }}
                  elevation={0}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      mb: 1.5,
                    }}
                  >
                    <Typography variant="subtitle2" fontWeight={600}>
                      Filter {filterIndex + 1}
                    </Typography>
                    <IconButton
                      size="small"
                      onClick={() => handleRemoveFilter(filterIndex)}
                      color="error"
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>

                  {filter.conditions.map((condition, condIndex) => (
                    <Box key={condIndex}>
                      {condIndex > 0 && (
                        <Typography
                          variant="caption"
                          sx={{
                            display: 'block',
                            textAlign: 'center',
                            my: 0.5,
                            color: 'text.secondary',
                            fontWeight: 600,
                            fontSize: '0.65rem',
                          }}
                        >
                          AND
                        </Typography>
                      )}
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        <FormControl size="small" sx={{ minWidth: 140, flex: 1 }}>
                          <Select
                            value={condition.property}
                            onChange={(e) =>
                              handleConditionChange(
                                filterIndex,
                                condIndex,
                                'property',
                                e.target.value
                              )
                            }
                            displayEmpty
                          >
                            <MenuItem value="" disabled>
                              Property
                            </MenuItem>
                            {[...subscribedProperties, ...EXTRA_FILTERABLE_PROPERTIES.filter((p) => !subscribedProperties.includes(p))].map((prop) => (
                              <MenuItem key={prop} value={prop}>
                                {propertyLabel(prop)}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>

                        <FormControl size="small" sx={{ minWidth: 160, flex: 1 }}>
                          <Select
                            value={condition.operator}
                            onChange={(e) =>
                              handleConditionChange(
                                filterIndex,
                                condIndex,
                                'operator',
                                e.target.value
                              )
                            }
                          >
                            {getOperatorsForProperty(condition.property).map((op) => (
                              <MenuItem key={op.value} value={op.value}>
                                {op.label}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>

                        {!VALUELESS_OPERATORS.includes(condition.operator) && (
                          <TextField
                            size="small"
                            placeholder="Value"
                            value={condition.value}
                            onChange={(e) =>
                              handleConditionChange(
                                filterIndex,
                                condIndex,
                                'value',
                                e.target.value
                              )
                            }
                            sx={{ flex: 1 }}
                          />
                        )}
                        <IconButton
                          size="small"
                          onClick={() => handleRemoveCondition(filterIndex, condIndex)}
                          sx={{ color: 'text.secondary', flexShrink: 0 }}
                        >
                          <DeleteIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Box>
                    </Box>
                  ))}

                  {filter.conditions.length < MAX_CONDITIONS && (
                    <Button
                      size="small"
                      startIcon={<AddIcon />}
                      onClick={() => handleAddCondition(filterIndex)}
                      sx={{ mt: 1 }}
                    >
                      Add Condition
                    </Button>
                  )}
                </Paper>
              </Box>
            ))}

            {filters.length < MAX_FILTERS && (
              <Button
                startIcon={<AddIcon />}
                onClick={handleAddFilter}
                sx={{ mt: 2 }}
                variant="outlined"
                size="small"
              >
                Add Filter
              </Button>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || loading}
          startIcon={saving ? <CircularProgress size={18} color="inherit" /> : undefined}
        >
          {saving ? 'Saving...' : 'Save Filters'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
