import { useState } from 'react';
import {
  Box,
  TextField,
  Button,
  Typography,
  Paper,
  CircularProgress,
  Alert,
  Stack,
} from '@mui/material';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { getAuthStatus, getInstallUrl, startJournal } from '../utils/api';

interface StartScreenProps {
  onStart: (portalId: string) => void;
}

export default function StartScreen({ onStart }: StartScreenProps) {
  const [portalId, setPortalId] = useState('');
  const [installed, setInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const handleInstall = async () => {
    if (!portalId.trim()) {
      setError('Please enter a Portal ID');
      return;
    }

    setInstalling(true);
    setError('');

    try {
      const { authUrl } = await getInstallUrl(portalId);
      window.open(authUrl, '_blank');

      const checkInstall = setInterval(async () => {
        try {
          const status = await getAuthStatus();
          if (status.installed) {
            clearInterval(checkInstall);
            setInstalled(true);
            setInstalling(false);
          }
        } catch {
          // keep polling
        }
      }, 2000);

      setTimeout(() => {
        clearInterval(checkInstall);
        setInstalling(false);
      }, 120000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start installation');
      setInstalling(false);
    }
  };

  const handleContinue = async () => {
    setStarting(true);
    setError('');

    try {
      await startJournal(portalId);
      onStart(portalId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start journal processing');
      setStarting(false);
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        p: 3,
      }}
    >
      <Paper
        elevation={8}
        sx={{
          p: 5,
          maxWidth: 500,
          width: '100%',
          borderRadius: 3,
          bgcolor: 'background.paper',
        }}
      >
        <Stack spacing={3} alignItems="center">
          <RocketLaunchIcon sx={{ fontSize: 48, color: 'primary.main' }} />

          <Typography variant="h4" fontWeight="bold" textAlign="center">
            Webhooks Journal
          </Typography>

          <Typography variant="body1" color="text.secondary" textAlign="center">
            Enter the Portal ID of the HubSpot account you want to sync contacts from
          </Typography>

          <TextField
            fullWidth
            label="Portal ID"
            value={portalId}
            onChange={(e) => setPortalId(e.target.value)}
            placeholder="e.g. 12345678"
            disabled={installed || installing}
            variant="outlined"
            slotProps={{ htmlInput: { inputMode: 'numeric', pattern: '[0-9]*' } }}
          />

          {error && (
            <Alert severity="error" sx={{ width: '100%' }}>
              {error}
            </Alert>
          )}

          {!installed ? (
            <Button
              fullWidth
              variant="contained"
              size="large"
              onClick={handleInstall}
              disabled={installing || !portalId.trim()}
              startIcon={installing ? <CircularProgress size={20} /> : undefined}
            >
              {installing ? 'Waiting for installation...' : 'Install App on Portal'}
            </Button>
          ) : (
            <Stack spacing={2} sx={{ width: '100%' }}>
              <Alert
                severity="success"
                icon={<CheckCircleIcon />}
                sx={{ width: '100%' }}
              >
                App installed successfully
              </Alert>

              <Button
                fullWidth
                variant="contained"
                size="large"
                onClick={handleContinue}
                disabled={starting}
                startIcon={starting ? <CircularProgress size={20} /> : undefined}
              >
                {starting ? 'Starting...' : 'View Live Data'}
              </Button>
            </Stack>
          )}

          {installing && (
            <Typography variant="body2" color="text.secondary" textAlign="center">
              Complete the authorization in the browser tab that just opened.
              This page will update automatically.
            </Typography>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}
