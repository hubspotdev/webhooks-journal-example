import { useState, useEffect } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import StartScreen from './components/StartScreen';
import DataView from './components/DataView';
import { startJournal } from './utils/api';

type Screen = 'start' | 'data' | 'loading';

export default function App() {
  const [screen, setScreen] = useState<Screen>('start');
  const [portalId, setPortalId] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('installed') !== 'true') return;

    const portalIdParam = params.get('portalId');
    window.history.replaceState({}, '', '/');

    if (!portalIdParam) {
      setScreen('start');
      return;
    }

    setScreen('loading');

    (async () => {
      try {
        await startJournal(portalIdParam);
        setPortalId(portalIdParam);
        setScreen('data');
      } catch {
        setScreen('start');
      }
    })();
  }, []);

  const handleStart = (id: string) => {
    setPortalId(id);
    setScreen('data');
  };

  const handleBack = () => {
    setScreen('start');
    setPortalId('');
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: 'background.default',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {screen === 'loading' && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            gap: 2,
          }}
        >
          <CircularProgress size={48} />
          <Typography color="text.secondary">
            Setting up journal processing...
          </Typography>
        </Box>
      )}
      {screen === 'start' && <StartScreen onStart={handleStart} />}
      {screen === 'data' && <DataView portalId={portalId} onBack={handleBack} />}
    </Box>
  );
}
