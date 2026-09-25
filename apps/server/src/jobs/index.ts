/**
 * Periodic background jobs. Each job runs on an interval; failures are logged and retried
 * on the next tick. Jobs are idempotent and safe to run on every instance.
 */
import { logger } from '../lib/logger.js';

export interface Job {
  name: string;
  intervalMs: number;
  run: () => Promise<void>;
}

const jobs: Job[] = [];
const timers: NodeJS.Timeout[] = [];

export function registerJob(job: Job) {
  jobs.push(job);
}

export function startJobs() {
  for (const job of jobs) {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await job.run();
      } catch (err) {
        logger.error({ err, job: job.name }, 'job failed');
      } finally {
        running = false;
      }
    };
    timers.push(setInterval(tick, job.intervalMs).unref());
  }
}

export function stopJobs() {
  for (const t of timers.splice(0)) clearInterval(t);
}

/** Run every registered job once (tests). */
export async function runJobsOnce() {
  for (const job of jobs) await job.run();
}
