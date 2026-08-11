import os from 'node:os';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const bool = (v, fallback = false) => {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

const list = (v) =>
  String(v || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/**
 * How many workers this process is one of. Mirrors the calculation in index.js;
 * a limit meant for the whole machine has to be divided among them.
 */
function workerCount() {
  const configured = Number(process.env.WEB_CONCURRENCY || 0);
  if (configured > 0) return Math.max(1, configured);
  return Math.max(1, Math.min(os.cpus().length - 1, 16));
}

/** A machine-wide limit, expressed as this worker's share of it. Never zero. */
function perWorker(total) {
  return Math.max(1, Math.floor(Number(total) / workerCount()));
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',
  // API_PORT wins over PORT so a parent process (a dev-server supervisor, some
  // PaaS wrappers) cannot accidentally point the API at the frontend's port.
  port: Number(process.env.API_PORT || process.env.PORT || 4000),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',

  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/college_coding_app',

  jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 12),

  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  allowedEmailDomain: (process.env.ALLOWED_EMAIL_DOMAIN || '').trim().toLowerCase(),
  adminEmails: list(process.env.ADMIN_EMAILS),
  teacherEmails: list(process.env.TEACHER_EMAILS),
  allowDevLogin: bool(process.env.ALLOW_DEV_LOGIN, true),

  executor: (process.env.EXECUTOR || 'local').toLowerCase(),
  judge0Url: (process.env.JUDGE0_URL || '').replace(/\/+$/, ''),
  judge0Token: process.env.JUDGE0_TOKEN || '',
  judge0RapidApiKey: process.env.JUDGE0_RAPIDAPI_KEY || '',
  judge0RapidApiHost: process.env.JUDGE0_RAPIDAPI_HOST || 'judge0-ce.p.rapidapi.com',

/*
   * Concurrency limits below are PER WORKER.
   *
   * The API runs one worker per core (see index.js), and each keeps its own
   * queue, so a limit of 16 across 12 workers is 192 simultaneous requests at
   * the judge — enough to knock over the very thing the limit exists to
   * protect. These are divided by the worker count so the configured number
   * stays the whole-machine figure a deployer actually reasons about.
   */
  judge0MaxConcurrent: perWorker(process.env.JUDGE0_MAX_CONCURRENT || 16),
  // The dev fallback spawns real compilers on this host, so its ceiling is the
  // machine's, not the judge's. Roughly one per core, machine-wide.
  localMaxConcurrent: perWorker(process.env.LOCAL_MAX_CONCURRENT || 4),
  // Submissions waiting for a slot. Beyond this the API says "try again"
  // instead of letting the backlog grow without bound.
  gradingMaxQueue: Number(process.env.GRADING_MAX_QUEUE || 5000),

  // Database connections per worker. Multiplied by the worker count this is
  // the load mongod actually sees, so it is deliberately modest: exam queries
  // are small and indexed, and a deep pool buys queueing rather than speed.
  mongoPoolSize: Number(process.env.MONGO_POOL_SIZE || 25),

  // TCP accept queue. A whole hall opening the exam on the bell produces a
  // thousand near-simultaneous connects; anything past the backlog is refused
  // outright by the OS before Node ever sees it. Node's default is 511.
  listenBacklog: Number(process.env.LISTEN_BACKLOG || 2048),

  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  aiReviewModel: process.env.AI_REVIEW_MODEL || 'claude-opus-5',
};

/**
 * Fail fast on configurations that are unsafe in production. These correspond
 * directly to the non-negotiables: never run untrusted code unsandboxed, never
 * ship a guessable session secret, never leave a password-less login enabled.
 */
export function assertProductionSafety() {
  if (!env.isProd) return;

  const fatal = [];
  if (env.executor !== 'judge0') {
    fatal.push(
      'EXECUTOR must be "judge0" in production. The "local" executor runs untrusted student code on the host with no sandbox.'
    );
  }
  if (env.allowDevLogin) {
    fatal.push('ALLOW_DEV_LOGIN must be false in production.');
  }
  if (!env.googleClientId) {
    fatal.push('GOOGLE_CLIENT_ID is required in production.');
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    fatal.push('JWT_SECRET must be set to a random string of at least 32 characters in production.');
  }
  if (!process.env.CLIENT_ORIGIN) {
    fatal.push(
      'CLIENT_ORIGIN must be set in production (e.g. https://exams.kpriet.ac.in). It is the address printed into every share link and QR code, and the origin the session cookie is scoped to.'
    );
  } else if (!/^https?:\/\//.test(process.env.CLIENT_ORIGIN)) {
    fatal.push('CLIENT_ORIGIN must include the scheme, e.g. https://exams.kpriet.ac.in');
  } else if (/^http:\/\//.test(process.env.CLIENT_ORIGIN)) {
    fatal.push(
      'CLIENT_ORIGIN must be https in production — the session cookie is Secure, so a plain-http origin cannot hold a login.'
    );
  }

  if (fatal.length) {
    console.error('\nRefusing to start — unsafe production configuration:');
    for (const msg of fatal) console.error(`  • ${msg}`);
    console.error('');
    process.exit(1);
  }
}
