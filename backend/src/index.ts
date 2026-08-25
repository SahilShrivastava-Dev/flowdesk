import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import taskRoutes from './routes/tasks';
import webhookRoutes from './routes/webhook';
import notificationRoutes from './routes/notifications';
import whatsappRoutes from './routes/whatsapp';
import conversationRoutes from './routes/conversations';
import contactRoutes from './routes/contacts';
import invoiceRoutes from './routes/invoices';
import commandRoutes from './routes/commands';
import { errorHandler, installProcessGuards } from './middleware/errorHandler';
import { verifyTokenOnStartup } from './services/whatsappService';
import { startupSummary } from './services/commandExecutor';
import { startScheduler } from './workers/scheduler';

const app = express();
const PORT = process.env.PORT ?? 5000;

app.use(cors({
  origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  credentials: true,
}));

// Raw body needed for webhook signature verification
app.use('/api/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

/**
 * Health check, and the answer to "which commit is actually running?".
 *
 * Render injects RENDER_GIT_COMMIT at build time. Exposing it means the live
 * version is checkable in one request instead of inferred from dashboard
 * screenshots — which is how a service quietly sat three commits behind while
 * everyone assumed auto-deploy was working.
 */
app.get('/api/health', (_req, res) => res.json({
  ok: true,
  ts: new Date(),
  commit: (process.env.RENDER_GIT_COMMIT ?? 'unknown').slice(0, 7),
  branch: process.env.RENDER_GIT_BRANCH ?? 'unknown',
}));

installProcessGuards();

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/whatsapp',     whatsappRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/contacts',      contactRoutes);
app.use('/api/invoices',      invoiceRoutes);
app.use('/api/commands',      commandRoutes);

// LAST, and after every route. Express identifies error middleware by its four
// parameters, so this must stay four-argument and stay at the bottom — anywhere
// higher and the routes below it never see an error.
app.use(errorHandler);

// Tests import this module for supertest, which drives the app directly and
// needs no socket — binding one there would fight the dev server for the port
// and start the escalation cron inside the suite.
if (!process.env.VITEST) {
  app.listen(PORT, () => {
    console.log(`FlowDesk API running on port ${PORT}`);
    startScheduler();
    verifyTokenOnStartup(); // immediately warn if token is expired
    // WhatsApp commands ship disabled. Say so at boot, so a deployment that
    // meant to enable them and didn't is visible in the logs rather than
    // discovered by a manager whose message goes unanswered.
    console.log(startupSummary());
  });
}

export default app;
