import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#ff7a59',
    },
    secondary: {
      main: '#00bda5',
    },
    background: {
      default: '#1a1a2e',
      paper: '#16213e',
    },
    text: {
      primary: '#e0e0e0',
      secondary: '#a0a0a0',
    },
    success: {
      main: '#00bda5',
    },
    warning: {
      main: '#f5c542',
    },
    error: {
      main: '#ff4444',
    },
    info: {
      main: '#7c8ce0',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
  },
});
