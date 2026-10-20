import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import { prisma } from './clients';
import { createJournalQueue, createJournalWorker, closeQueue } from './journal/queue';
import { processJournalJob } from './journal/processor';
import { startPolling, stopPolling } from './journal/poller';
import { subscribeToAppLifecycleEvents } from './hubspot/subscriptions';
import { backfillPortalsFromAuthorizations } from './portals';
import { swaggerSpec } from './swagger';
import { setupGracefulShutdown } from './utils/shutdown';
import { errorHandler } from './utils/error';
import { createLogger } from './utils/logger';
import { PORT } from './utils/utils';
import authRoutes from './routes/authRoutes';
import contactRoutes from './routes/contactRoutes';
import { createJournalRouter } from './routes/journalRoutes';

const logger = createLogger('App');
const app = express();

app.use(cors());
app.use(express.json());

// Serve built React frontend in production
const clientBuildPath = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientBuildPath));

// --- API Routes ---
app.use('/api', authRoutes);
app.use('/api', contactRoutes);

// OAuth callback at root level (not under /api)
app.get('/oauth-callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Missing authorization code' });
    return;
  }
  try {
    const { redeemCode } = await import('./auth');
    await redeemCode(code);
    logger.info('OAuth flow completed');
    const portalParam = state ? `&portalId=${encodeURIComponent(String(state))}` : '';
    res.redirect(`http://localhost:3000/?installed=true${portalParam}`);
  } catch (error) {
    logger.error('OAuth callback failed', error as Error);
    res.status(500).json({ error: 'OAuth flow failed' });
  }
});

// Swagger docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// --- Initialize Queue and Workers ---
const queue = createJournalQueue();
const worker = createJournalWorker(processJournalJob, 5);
const journalRouter = createJournalRouter(queue, worker);
app.use('/api', journalRouter);

app.use(errorHandler);

// --- Start Server ---
const server = app.listen(PORT, async () => {
  logger.info(`Server running on http://localhost:${PORT}`);
  logger.info(`API docs at http://localhost:${PORT}/api-docs`);

  try {
    await backfillPortalsFromAuthorizations();
    // Ensure the app-global lifecycle subscriptions exist, then start polling on
    // boot so install/uninstall events (and any contact events) are consumed
    // continuously — even before a portal is configured through the frontend.
    await subscribeToAppLifecycleEvents();
    startPolling(queue);
    logger.info('Journal polling started; listening for app-lifecycle and contact events');
  } catch (error) {
    logger.error('Startup initialization failed', error as Error);
  }
});

setupGracefulShutdown(server, prisma, async () => {
  stopPolling();
  await worker.close();
  await closeQueue(queue);
});

export default app;
