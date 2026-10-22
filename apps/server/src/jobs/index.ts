/**
 * Periodic background jobs. Each job runs on an interval; failures are logged and retried
 * on the next tick. Jobs are idempotent.
 *
 * Scope (docs "Cluster" → "Jobs"): a 'cluster' job (the default) runs only on the jobs
 * leader (cluster/leader.ts), so N processes do the work once; a 'node' job runs on every
 * process (work about this process's own sockets or timers).
 */
import { isLeader, onLeadershipChange } from '../cluster/leader.js';
import { logger } from '../lib/logger.js';

export interface Job {
  name: string;
  intervalMs: number;
  run: () => Promise<void>;
  /** 'cluster' (default): leader only. 'node': every process. */
  scope?: 'cluster' | 'node';
  /**
   * Also run once right away: a node job when jobs start (process boot), a cluster job when
   * this process becomes the leader (e.g. a sweep that recovers what a dead node left).
   */
  runOnStart?: boolean;
}

const jobs: Job[] = [];
const timers: NodeJS.Timeout[] = [];
let unsubscribe: (() => void) | undefined;

export function registerJob(job: Job) {
  jobs.push(job);
}

export function startJobs() {
  const ticks: { job: Job; tick: () => Promise<void> }[] = [];
  for (const job of jobs) {
    const cluster = (job.scope ?? 'cluster') === 'cluster';
    let running = false;
    const tick = async () => {
      if (running || (cluster && !isLeader())) return;
      running = true;
      try {
        await job.run();
      } catch (err) {
        logger.error({ err, job: job.name }, 'job failed');
      } finally {
        running = false;
      }
    };
    ticks.push({ job, tick });
    if (job.runOnStart && (!cluster || isLeader())) void tick();
    timers.push(setInterval(tick, job.intervalMs).unref());
  }
  unsubscribe = onLeadershipChange((leader) => {
    if (!leader) return;
    for (const { job, tick } of ticks)
      if (job.runOnStart && (job.scope ?? 'cluster') === 'cluster') void tick();
  });
}

export function stopJobs() {
  for (const t of timers.splice(0)) clearInterval(t);
  unsubscribe?.();
  unsubscribe = undefined;
}

/** Run every registered job once, whatever its scope (tests). */
export async function runJobsOnce() {
  for (const job of jobs) await job.run();
}
