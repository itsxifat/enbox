import http from 'node:http';
import fs from 'node:fs';
import { createApp } from './app.js';
import { config } from './config.js';
import { closeDb, initDb } from './db/index.js';
import { logger } from './lib/logger.js';
import { createSocketServer } from './realtime/io.js';
import { startJobs, stopJobs } from './jobs/index.js';
import './jobs/register.js';

async function main() {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  await initDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir });
  const app = createApp();
  const server = http.createServer(app);
  const io = await createSocketServer(server);
  startJobs();

  server.listen(config.port, config.host, () => {
    logger.info(`Enbox server listening on http://${config.host}:${config.port}`);
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    stopJobs();
    io.close();
    server.close();
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
