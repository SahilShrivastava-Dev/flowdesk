import cron from 'node-cron';
import { runEscalation } from '../services/escalationService';
import { runOutreachFollowUps } from '../services/outreachFollowUpService';

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

    // Chasing external parties runs in its own try/catch on the same tick.
    // A second cron schedule would mean two answers to "what runs unattended?",
    // and a shared try would let one failure silently cancel the other.
    try {
      const summary = await runOutreachFollowUps();
      if (summary.chased || summary.escalated) {
        console.log(
          `[Scheduler] Outreach follow-ups: ${summary.chased} chased, `
          + `${summary.escalated} escalated, ${summary.skipped} skipped`,
        );
      }
    } catch (err) {
      console.error('[Scheduler] Outreach follow-up error:', err);
    }
  });

  console.log('[Scheduler] Cron started (*/15 * * * *)');
}
