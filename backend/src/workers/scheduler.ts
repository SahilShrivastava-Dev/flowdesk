import cron from 'node-cron';
import { runEscalation } from '../services/escalationService';

export function startScheduler(): void {
  // Run every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    console.log('[Scheduler] Running escalation check…');
    try {
      await runEscalation();
      console.log('[Scheduler] Escalation check complete');
    } catch (err) {
      console.error('[Scheduler] Escalation error:', err);
    }
  });

  console.log('[Scheduler] Cron started (*/15 * * * *)');
}
