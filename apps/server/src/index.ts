import http from 'node:http';
import fs from 'node:fs';
import { createApp } from './app.js';
import { config } from './config.js';
import { startBus, stopBus } from './cluster/bus.js';
import { startLeaderElection, stopLeaderElection } from './cluster/leader.js';
import { NODE_ID } from './cluster/node.js';
import { startNodeHeartbeat, stopNodeHeartbeat } from './cluster/nodes.js';
import { closeDb, initDb } from './db/index.js';
import { logger } from './lib/logger.js';
import { createSocketServer } from './realtime/io.js';
import { startPresenceReplication, stopPresenceReplication } from './realtime/presence.js';
import { startJobs, stopJobs } from './jobs/index.js';
import './jobs/register.js';

async function main() {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  // Migrations run under an advisory lock: N processes booting together migrate once.
  await initDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir });
  // Cluster membership (docs "Cluster"): heartbeat row first (other processes must see us
  // alive before we bind call sockets), then the bus and presence replication, then the
  // jobs leader election.
  await startNodeHeartbeat();
  await startBus(config.redisUrl);
  startPresenceReplication();
  await startLeaderElection();
  const app = createApp();
  const server = http.createServer(app);
  const io = await createSocketServer(server);
  startJobs();

  server.listen(config.port, config.host, () => {
    logger.info(
      { node: NODE_ID },
      `Enbox server listening on http://${config.host}:${config.port}`,
    );
  });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'shutting down');
    stopJobs();
    // Hand over leadership and presence first, so the other processes take over at once.
    await stopLeaderElection();
    stopPresenceReplication();
    io.close();
    server.close();
    // Our row goes last: the leader then moves our call participants into the reconnect
    // grace and their clients rejoin through another process.
    await stopNodeHeartbeat();
    await stopBus();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
