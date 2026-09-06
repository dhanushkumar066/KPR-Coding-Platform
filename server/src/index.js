import http from 'node:http';
import cluster from 'node:cluster';
import os from 'node:os';
import { setupPrimary } from '@socket.io/cluster-adapter';
import { env, assertProductionSafety } from './config/env.js';
import { connectDb } from './config/db.js';
import { createApp } from './app.js';
import { initRealtime } from './services/realtime.js';
import { recoverPendingSubmissions } from './services/gradingQueue.js';

/**
 * One worker per core.
 *
 * Node runs JavaScript on one thread, so a single process serves an exam hall
 * from one core however many the machine has. Measured on a 32-core box: one
 * process took 2000 students to a ten-second wait on "Start test" and refused
 * several thousand connections outright, because the accept queue drains no
 * faster than that one thread turns requests around. This work is almost
 * entirely I/O and JSON, so it spreads across cores nearly linearly.
 *
 * Two things here are per-process, and both are handled rather than ignored:
 *
 *   The live proctor feed. An event emitted by the worker handling a student's
 *   submission has to reach a teacher connected to some other worker. The
 *   cluster adapter relays events between workers through the primary, and
 *   sticky sessions keep each socket on the worker that owns it — without that,
 *   a long-poll upgrade lands on a worker that has never heard of the session.
 *
 *   Grading. Each worker grades what it received, so load spreads by itself,
 *   but re-queueing submissions left pending by a restart must happen on
 *   exactly one worker or the same row is graded once per worker.
 */
const WORKERS = (() => {
  const configured = Number(process.env.WEB_CONCURRENCY || 0);
  if (configured > 0) return Math.max(1, configured);

  // Development stays a single process on purpose: `node --watch` restarts,
  // a readable log, and a debugger that attaches to the process actually
  // serving the request are all worth more than throughput on one person's
  // laptop. Set WEB_CONCURRENCY to load-test the clustered path locally.
  if (!env.isProd) return 1;

  // Leave a core for MongoDB and the OS. The ceiling is not really about cores
  // — past roughly this many, the database is the next thing to give.
  return Math.max(1, Math.min(os.cpus().length - 1, 16));
})();

/** The primary forks the workers and owns nothing else. */
function startPrimary() {
  /*
   * Round-robin, with every worker binding the port itself.
   *
   * This used to route through @socket.io/sticky, which pins a client IP to one
   * worker so Socket.IO's HTTP long-polling always reaches the process holding
   * that session. Correct for polling, and completely wrong here: a hall of
   * students sits behind one NAT gateway, so the entire class shares a single
   * public IP and every one of them is routed to the same worker. Measured on
   * this machine — 30 parallel connections, one worker, the rest idle. The
   * clustering did nothing in the one situation it was added for.
   *
   * Stickiness is only needed because of polling. A websocket is a single
   * persistent connection, so the proctor feed is websocket-only now (see
   * services/realtime.js) and plain round-robin can spread the load properly.
   */
  cluster.setupPrimary({
    schedulingPolicy: cluster.SCHED_RR,
    // Structured clone for the inter-worker channel, so the adapter can relay
    // payloads without re-encoding them.
    serialization: 'advanced',
  });
  setupPrimary();

  console.log(`[server] listening on http://localhost:${env.port} (${env.nodeEnv})`);
  console.log(`[server] ${WORKERS} workers on ${os.cpus().length} cores`);
  console.log(`[server] executor: ${env.executor}`);
  if (env.executor === 'local') {
    console.warn(
      '[server] WARNING: the "local" executor runs student code on this machine with no sandbox. Development only.'
    );
  }

  for (let i = 0; i < WORKERS; i += 1) cluster.fork();

  // A worker that dies mid-exam is replaced immediately. Losing one is
  // survivable — its students' requests are retried onto another — but losing
  // it permanently would quietly reduce capacity for the rest of the paper.
  cluster.on('exit', (worker, code, signal) => {
    console.warn(`[server] worker ${worker.process.pid} died (${signal || code}) — replacing`);
    cluster.fork();
  });

  const shutdown = (sig) => {
    console.log(`[server] ${sig} — shutting down`);
    for (const w of Object.values(cluster.workers || {})) w.kill();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/** Every worker binds the same port; the OS deals each connection to one. */
async function startWorker() {
  await connectDb();

  const app = createApp();
  const server = http.createServer(app);
  initRealtime(server, { clustered: true });

  if (cluster.worker.id === 1) {
    await recoverPendingSubmissions().catch((err) =>
      console.error('[grading] recovery failed:', err.message)
    );
  }

  server.keepAliveTimeout = 30_000;
  server.headersTimeout = 35_000;

  server.listen({ port: env.port, backlog: env.listenBacklog }, () => {
    console.log(`[server] worker ${process.pid} ready`);
  });
}

/** Single process: the old path, kept for development and small deployments. */
async function startSingle() {
  await connectDb();

  const app = createApp();
  const server = http.createServer(app);
  initRealtime(server, { clustered: false });

  await recoverPendingSubmissions().catch((err) =>
    console.error('[grading] recovery failed:', err.message)
  );

  server.keepAliveTimeout = 30_000;
  server.headersTimeout = 35_000;

  server.listen({ port: env.port, backlog: env.listenBacklog }, () => {
    console.log(`[server] listening on http://localhost:${env.port} (${env.nodeEnv})`);
    console.log(`[server] single process`);
    console.log(`[server] executor: ${env.executor}`);
    if (env.executor === 'local') {
      console.warn(
        '[server] WARNING: the "local" executor runs student code on this machine with no sandbox. Development only.'
      );
    }
  });

  const shutdown = (sig) => {
    console.log(`[server] ${sig} — shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function main() {
  assertProductionSafety();

  if (WORKERS <= 1) return startSingle();
  return cluster.isPrimary ? startPrimary() : startWorker();
}

main().catch((err) => {
  console.error('[server] failed to start:', err.message);
  process.exit(1);
});
