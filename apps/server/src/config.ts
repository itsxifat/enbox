import path from 'node:path';

function str(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}
function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Env ${name} must be an integer`);
  return n;
}
function list(name: string, fallback: string[] = []): string[] {
  const v = str(name);
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : fallback;
}

export interface Config {
  env: 'development' | 'production' | 'test';
  host: string;
  port: number;
  /** Public origin of the web app, used to build invite links. */
  publicUrl: string;
  /** PostgreSQL connection string. When unset, an embedded PGlite database is used. */
  databaseUrl: string | undefined;
  /** PGlite data dir, or 'memory' for an in-memory database. */
  pgliteDir: string;
  dataDir: string;
  uploadDir: string;
  /** Allowed CORS origins; ['*'] allows any origin. */
  corsOrigins: string[];
  redisUrl: string | undefined;
  sessionTtlDays: number;
  logLevel: string;
  /** Serve the built web client from this directory when it exists. */
  webDistDir: string;
  rateLimit: boolean;
  ice: {
    stunUrls: string[];
    turnUrls: string[];
    turnUsername: string | undefined;
    turnCredential: string | undefined;
    /** coturn `static-auth-secret` for time-limited REST credentials. */
    turnSecret: string | undefined;
    turnTtlSec: number;
  };
  vapid: {
    publicKey: string | undefined;
    privateKey: string | undefined;
    subject: string;
  };
  version: string;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const env = (str('NODE_ENV', 'development') as Config['env']) ?? 'development';
  const dataDir = path.resolve(str('DATA_DIR', './data')!);
  const base: Config = {
    env,
    host: str('HOST', '0.0.0.0')!,
    port: int('PORT', 4000),
    publicUrl: str('PUBLIC_URL', 'http://localhost:5173')!,
    databaseUrl: str('DATABASE_URL'),
    pgliteDir: str('PGLITE_DIR', path.join(dataDir, 'pglite'))!,
    dataDir,
    uploadDir: path.resolve(str('UPLOAD_DIR', path.join(dataDir, 'uploads'))!),
    corsOrigins: list('CORS_ORIGINS', ['*']),
    redisUrl: str('REDIS_URL'),
    sessionTtlDays: int('SESSION_TTL_DAYS', 90),
    logLevel: str('LOG_LEVEL', env === 'test' ? 'silent' : 'info')!,
    webDistDir: path.resolve(str('WEB_DIST_DIR', path.join(process.cwd(), '../web/dist'))!),
    rateLimit: str('RATE_LIMIT', env === 'test' ? 'off' : 'on') !== 'off',
    ice: {
      stunUrls: list('STUN_URLS', ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']),
      turnUrls: list('TURN_URLS'),
      turnUsername: str('TURN_USERNAME'),
      turnCredential: str('TURN_CREDENTIAL'),
      turnSecret: str('TURN_SECRET'),
      turnTtlSec: int('TURN_TTL_SEC', 24 * 60 * 60),
    },
    vapid: {
      publicKey: str('VAPID_PUBLIC_KEY'),
      privateKey: str('VAPID_PRIVATE_KEY'),
      subject: str('VAPID_SUBJECT', 'mailto:admin@enbox.local')!,
    },
    version: str('APP_VERSION', '0.1.0')!,
  };
  return { ...base, ...overrides, ice: { ...base.ice, ...overrides.ice }, vapid: { ...base.vapid, ...overrides.vapid } };
}

/** Process-wide config (set by `initConfig`, defaults to env). */
export let config: Config = loadConfig();

export function initConfig(overrides: Partial<Config> = {}): Config {
  config = loadConfig(overrides);
  return config;
}
