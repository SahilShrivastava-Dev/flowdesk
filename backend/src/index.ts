import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import taskRoutes from './routes/tasks';
import webhookRoutes from './routes/webhook';
import notificationRoutes from './routes/notifications';
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

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date() }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/notifications', notificationRoutes);

app.listen(PORT, () => {
  console.log(`FlowDesk API running on port ${PORT}`);
  startScheduler();
});

export default app;
